import { HOOK_EVENTS, DEGREE } from "../constants.mjs";
import { findObject, setHeading, updateObject, objectsInZone, setDetection, assignDesignation } from "../engine/sensor-ops.mjs";
import { oppositeHeading } from "../engine/heading.mjs";
import { resolveHullRestored } from "../engine/compromised.mjs";
import { resolveSeek, detectionTargetability, seekDC } from "../engine/detection.mjs";
import { effectiveDetection } from "../engine/sensor-ops.mjs";
import { readStarship, isStarship } from "../starship/starship-state.mjs";
import { shipSkillValue } from "../starship/stats.mjs";
import { hazardStealthDC } from "../hazards/hazard-stealth.mjs";
import { calculateZoneDistance } from "../engine/range.mjs";
import { makeEffect } from "../starship/effects.mjs";
import { computeShipStats, shipStatistic, rollNativeCheck, crewStatistic } from "../starship/stats.mjs";
import { applyDamageInDraft } from "../damage/damage-service.mjs";
import { rollSpec, basicSaveMultiplier } from "./dice.mjs";
import { fromUuidSafe, T, moduleSetting } from "../utils/foundry.mjs";
import { turnIndexOf, combatantForActor } from "../combat/tsc-state.mjs";
import { ct } from "../content/content-i18n.mjs";

const modelKeyOf = (data) => data.sourceId ?? data.name ?? "unknown";

function creatorTurn(ctx) {
  const c = ctx.combat;
  if (!c) return null;
  const cb = combatantForActor(c, ctx.crew ?? ctx.ship);
  return cb ? turnIndexOf(c, cb.id) : null;
}

async function targetEntry(ctx, which) {
  if (which === "self") return { uuid: ctx.shipUuid, ...(await ctx.draft.ship(ctx.shipUuid)) };
  if (!ctx.target) throw new Error(T("SF2eTSC.errors.needTarget"));
  return { uuid: ctx.target.uuid, ...(await ctx.draft.ship(ctx.target.uuid)) };
}

const EXEC = {
  async moveAlongHeading(fx, ctx) {
    // no automatic movement on the sensor map — the action only reports the allowed distance; the GM/pilot
    // moves the ship token on the sensor map manually (drag & drop or arrows).
    const speed = fx.zones === "speed" ? ctx.stats.speed : Number(fx.zones);
    const o = findObject(ctx.draft.tsc, ctx.shipUuid);
    ctx.reports.push(game.i18n.format("SF2eTSC.ui.moveManual", { speed, zone: o?.zone ?? "—" }));
    ctx.draft.log(`${ctx.ship.name}: ${T("SF2eTSC.ui.speed")} ${speed}`, "move");
  },
  async reverseHeading(fx, ctx) {
    const { data } = await targetEntry(ctx, "self");
    const o = findObject(ctx.draft.tsc, ctx.shipUuid);
    const next = oppositeHeading(o?.heading ?? data.heading);
    data.heading = next;
    if (o) ctx.draft.tsc = setHeading(ctx.draft.tsc, ctx.shipUuid, next);
    ctx.reports.push(`${T("SF2eTSC.ui.heading")}: ${T(`SF2eTSC.heading.${next}`)}`);
    ctx.draft.event(HOOK_EVENTS.headingChanged, ctx.ship, next);
  },
  async clearOffKilter(fx, ctx) {
    const { data } = await targetEntry(ctx, "self");
    if (data.offKilter) ctx.reports.push(T("SF2eTSC.chat.offKilterEnded"));
    data.offKilter = false;
    data.effects = data.effects.filter((e) => !e.conditions?.includes("off-kilter"));
  },
  async setOffKilter(fx, ctx) {
    const { data } = await targetEntry(ctx, fx.target === "target" ? "target" : "self");
    data.offKilter = !!fx.value;
  },
  async applyEffect(fx, ctx) {
    const entry = await targetEntry(ctx, fx.target === "target" ? "target" : "self");
    const def = { ...fx.effect };
    if (fx.target === "station") def.station = ctx.options.stationId ?? ctx.station?.id ?? null;
    const e = makeEffect(def, {
      combat: ctx.combat,
      creatorTurn: creatorTurn(ctx),
      actions: ctx.options.actions ?? 1,
      sourceUuid: ctx.shipUuid
    });
    if (def.conditions?.includes("off-kilter")) entry.data.offKilter = true;
    entry.data.effects = [...entry.data.effects.filter((x) => !(x.slug === e.slug && x.sourceUuid === e.sourceUuid)), e];
    ctx.reports.push(`${entry.actor.name}: ${ct(e.label)}`);
  },
  async restoreShields(fx, ctx) {
    const { data, actor } = await targetEntry(ctx, ctx.target && ctx.action.targeting?.type === "starship" ? "target" : "self");
    const { total } = await rollSpec(fx.dice, ctx, `${ct(ctx.action.name)}: ${T("SF2eTSC.ui.shieldPoints")}`);
    const before = data.sp.value;
    data.sp.value = Math.min(data.sp.max, data.sp.value + total);
    ctx.reports.push(`${actor.name}: ${T("SF2eTSC.ui.shieldPoints")} +${data.sp.value - before} (${data.sp.value}/${data.sp.max})`);
  },
  async restoreHull(fx, ctx) {
    const which = ctx.target && ctx.action.targeting?.type === "starship" ? "target" : "self";
    const { data, actor } = await targetEntry(ctx, which);
    const { total } = await rollSpec(fx.dice, ctx, `${ct(ctx.action.name)}: ${T("SF2eTSC.ui.hullPoints")}`);
    const before = data.hp.value;
    data.hp.value = Math.min(data.hp.max, data.hp.value + total);
    const r = resolveHullRestored(
      { compromised: data.compromised, wrecked: data.wrecked, inoperable: data.inoperable },
      before,
      data.hp.value
    );
    if (r.lostCompromised) {
      ctx.reports.push(T("SF2eTSC.chat.lostCompromised"));
      ctx.draft.afterCommit(async () => {
        const { Initiative } = await import("../combat/initiative.mjs");
        if (ctx.combat) await Initiative.leaveCompromised(ctx.combat, actor);
      });
    }
    data.compromised = r.compromised;
    data.wrecked = r.wrecked;
    data.inoperable = r.inoperable;
    ctx.reports.push(`${actor.name}: ${T("SF2eTSC.ui.hullPoints")} +${data.hp.value - before} (${data.hp.value}/${data.hp.max})`);
  },
  async damage(fx, ctx) {
    const targets = ctx.areaTargets?.length ? ctx.areaTargets : ctx.target ? [ctx.target] : [];
    if (!targets.length) throw new Error(T("SF2eTSC.errors.needTarget"));
    const { total } = await rollSpec(fx.dice, ctx, `${ct(ctx.action.name)}: ${T("SF2eTSC.chat.damage")}`);
    for (const t of targets) {
      let amount = total,
        crit = false;
      if (fx.save) {
        const targetActor = t.actor;
        const stat = shipStatistic(targetActor, fx.save.type);
        const dcStat = crewStatistic(ctx.crew ?? ctx.ship, fx.save.dcSkill ?? "crafting");
        const dc = dcStat?.dc?.value ?? 10 + (ctx.level ?? 1) + 5;
        const res = await rollNativeCheck({
          statistic: stat,
          dc,
          label: `${targetActor.name}: ${fx.save.type}`,
          actor: targetActor,
          modifierOnly: computeShipStats(targetActor)[fx.save.type]
        });
        const mult = res ? basicSaveMultiplier(res.degree) : 1;
        amount = Math.floor(total * mult);
        crit = res?.degree === DEGREE.CRITICAL_FAILURE;
        ctx.reports.push(
          `${targetActor.name}: ${T(`SF2eTSC.degree.${["criticalFailure", "failure", "success", "criticalSuccess"][res?.degree ?? 1]}`)} (×${mult})`
        );
      }
      await applyDamageInDraft(ctx.draft, t.uuid, {
        amount,
        damageType: fx.damageType ?? "untyped",
        traits: fx.traits ?? [],
        criticalHit: crit,
        source: ct(ctx.action.name)
      });
    }
  },
  async malfunction(fx, ctx) {
    const { data, actor } = await targetEntry(ctx, "target");
    const stationId = ctx.options.targetStationId;
    const stations = fx.target === "all" ? data.stations : data.stations.filter((s) => s.id === stationId);
    const list = stations.length ? stations : data.stations.slice(0, 1);
    for (const st of list) {
      if (st.malfunctionImmuneUntil && ctx.combat && st.malfunctionImmuneUntil.round >= ctx.combat.round) continue;
      st.malfunctioning = true;
      if (fx.until === "target-turn-start") st.malfunctionUntilTurnOf = actor.uuid;
    }
    ctx.reports.push(`${actor.name}: ${list.map((s) => s.name).join(", ")} — ${T("SF2eTSC.ui.malfunctioning")}`);
    ctx.draft.event(HOOK_EVENTS.stationMalfunctioned, actor, list);
  },
  async clearMalfunction(fx, ctx) {
    const { data } = await targetEntry(ctx, "self");
    const list =
      fx.target === "all"
        ? data.stations
        : fx.target === "own-station" && ctx.station
          ? data.stations.filter((s) => s.id === ctx.station.id)
          : data.stations.filter((s) => s.id === (ctx.options.stationId ?? ctx.station?.id));
    for (const st of list) {
      st.malfunctioning = false;
      if (fx.immuneRounds && ctx.combat) st.malfunctionImmuneUntil = { round: ctx.combat.round + fx.immuneRounds };
    }
    ctx.reports.push(`${list.map((s) => s.name).join(", ") || "—"}: ${T("SF2eTSC.chat.repaired")}`);
  },
  async repairLockout(fx, ctx) {
    const { data } = await targetEntry(ctx, "self");
    const st = data.stations.find((s) => s.id === ctx.station?.id);
    if (st) st.repairLockedUntilTurnOf = ctx.crewUuid;
  },
  async identify(fx, ctx) {
    if (!ctx.target) throw new Error(T("SF2eTSC.errors.needTarget"));
    const t = ctx.target;
    const k = ctx.draft.tsc.knowledge[t.modelKey] ?? { model: false, stations: [] };
    k.model = true;
    const ids = t.data.stations.map((s) => s.id);
    if (fx.scope === "all") k.stations = ids;
    else {
      const unknown = ids.filter((x) => !k.stations.includes(x));
      if (unknown.length) k.stations = [...k.stations, unknown[Math.floor(Math.random() * unknown.length)]];
    }
    ctx.draft.tsc.knowledge[t.modelKey] = k;
    ctx.draft.tsc = setDetection(ctx.draft.tsc, t.key, ctx.shipUuid, "identified");
    ctx.draft.tsc = setDetection(ctx.draft.tsc, t.key, "party", "identified");
    ctx.reports.push(T("SF2eTSC.chat.identified", { name: t.actor.name }));
    ctx.draft.event(HOOK_EVENTS.targetIdentified, ctx.ship, t.actor);
  },
  async manual(fx, ctx) {
    ctx.manual.push(ct(fx.text));
  }
};

export async function executeEffects(effects, ctx) {
  for (const fx of effects ?? []) {
    const fn = EXEC[fx.type];
    if (!fn) {
      ctx.manual.push(`${fx.type}: ${JSON.stringify(fx)}`);
      continue;
    }
    await fn(fx, ctx);
  }
}

/** Stealth DC of a sensor object for Seek Starships (ship Stealth skill / hazard Stealth / level DC). */
async function seekTargetDC(o) {
  const a = o.actorUuid ? await fromUuidSafe(o.actorUuid) : null;
  if (a && isStarship(a)) {
    const d = readStarship(a);
    const mod = shipSkillValue(d.skills, "stealth") ?? a.skills?.stealth?.mod ?? null;
    return seekDC({ stealthDC: o.stealthDC, stealthMod: mod, level: d.level ?? o.level });
  }
  if (a) return seekDC({ stealthDC: hazardStealthDC(a) ?? o.stealthDC, level: a.system?.details?.level?.value ?? o.level });
  return seekDC({ stealthDC: o.stealthDC, level: o.level });
}

/** Seek Starships: compare one (secret) check to every concealed object within sensor range. */
export async function resolveSeekBuiltin(ctx, rollResult) {
  const tsc = ctx.draft.tsc;
  const me = findObject(tsc, ctx.shipUuid);
  if (!me) throw new Error(T("SF2eTSC.errors.notPlaced"));
  const observer = ctx.shipUuid;
  const range = ctx.stats.sensorRange;
  const style = moduleSetting("contactDesignation");
  for (const o of [...tsc.objects]) {
    if (o.key === me.key) continue;
    if (calculateZoneDistance(me.zone, o.zone) > range) continue;
    const current = effectiveDetection(o, [observer]);
    if (current === "observed" || current === "identified") continue;
    const dcValue = await seekTargetDC(o);
    const degree =
      rollResult.total >= dcValue + 10
        ? DEGREE.CRITICAL_SUCCESS
        : rollResult.total >= dcValue
          ? DEGREE.SUCCESS
          : rollResult.total <= dcValue - 10
            ? DEGREE.CRITICAL_FAILURE
            : DEGREE.FAILURE;
    const next = resolveSeek(current, degree);
    if (next !== current) {
      // the party shares sensor data: the GM detail panel and every player view read "party"
      ctx.draft.tsc = setDetection(setDetection(ctx.draft.tsc, o.key, observer, next), o.key, "party", next);
      if (next === "observed" && !o.designation) ctx.draft.tsc = assignDesignation(ctx.draft.tsc, o.key, style);
      ctx.reports.push(`${T("SF2eTSC.chat.contactUpdated")}: ${T("SF2eTSC.ui.zone")} ${o.zone} → ${T(`SF2eTSC.detection.${next}`)}`);
    }
  }
  if (!ctx.reports.length) ctx.reports.push(T("SF2eTSC.chat.nothingFound"));
}
export { modelKeyOf, detectionTargetability, objectsInZone, updateObject, fromUuidSafe };
