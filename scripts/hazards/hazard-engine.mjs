import { MODULE_ID, FLAGS, HOOK_EVENTS } from "../constants.mjs";
import { parseHazardEffect, parseReset, parseRoutineActions, isResetReady } from "../engine/hazard-rules.mjs";
import { addObject, findObject, objectsInZone } from "../engine/sensor-ops.mjs";
import { calculateEmanationZones } from "../engine/areas.mjs";
import { activeStarshipCombat, saveTsc, getTsc } from "../combat/tsc-state.mjs";
import { postHazardCard } from "../chat/chat-cards.mjs";
import { Draft } from "../actions/draft.mjs";
import { applyDamageInDraft } from "../damage/damage-service.mjs";
import { shipStatistic, rollNativeCheck, computeShipStats } from "../starship/stats.mjs";
import { basicSaveMultiplier } from "../actions/dice.mjs";
import { fromUuidSafe, T, moduleSetting } from "../utils/foundry.mjs";
import { DEGREE } from "../constants.mjs";
import { hazardStealthDC } from "./hazard-stealth.mjs";

export const hazardFlags = (actor) => actor?.flags?.[MODULE_ID]?.[FLAGS.HAZARD] ?? null;
export const isStarshipHazard = (actor) => !!hazardFlags(actor)?.isStarshipHazard;

/** Add a hazard actor to the sensor map and/or mark it for the ship map. */
export async function placeHazard(hazardActor, { zone = 1, span = 1, map = "sensor", detection = null } = {}) {
  const combat = activeStarshipCombat();
  if (!combat) throw new Error(T("SF2eTSC.errors.noCombat"));
  const flags = hazardFlags(hazardActor) ?? {};
  const state = foundry.utils.deepClone(getTsc(combat));
  if (map === "sensor" || map === "both") {
    const stealth = hazardStealthDC(hazardActor) ?? flags.stealthDC ?? null;
    const next = addObject(state, {
      key: hazardActor.uuid,
      actorUuid: hazardActor.uuid,
      type: "hazard",
      name: hazardActor.name,
      zone,
      span,
      level: hazardActor.system?.details?.level?.value ?? flags.level ?? 0,
      stealthDC: stealth,
      icon: "⚠",
      detection: { party: detection ?? (stealth ? "undetected" : "observed") }
    });
    Object.assign(state, next);
  }
  state.hazardState[hazardActor.uuid] = { ...(state.hazardState[hazardActor.uuid] ?? {}), disabled: false, placement: map };
  await saveTsc(combat, state);
  await hazardActor.setFlag(MODULE_ID, FLAGS.HAZARD, { ...flags, isStarshipHazard: true, placement: map });
  return true;
}

function zonesOfHazard(tsc, uuid) {
  const o = findObject(tsc, uuid);
  if (!o) return [];
  return calculateEmanationZones(o.zone, Math.max(0, (o.span ?? 1) - 1), tsc.zones);
}

/** Apply parsed damage (with basic save) to every starship in the hazard's zones. */
async function applyAutomatedEffect(hazardActor, text, draft) {
  const parsed = parseHazardEffect(text);
  if (!parsed.damage) return { applied: false, parsed };
  const zones = zonesOfHazard(draft.tsc, hazardActor.uuid);
  const targets = draft.tsc.objects.filter((o) => o.type === "starship" && zones.includes(o.zone));
  if (!targets.length) return { applied: true, parsed, targets: 0 };
  const roll = await new Roll(parsed.damage).evaluate();
  await roll.toMessage({ speaker: { alias: hazardActor.name }, flavor: `${hazardActor.name}: ${T("SF2eTSC.chat.damage")}` });
  for (const o of targets) {
    const entry = await draft.ship(o.key);
    let amount = roll.total,
      crit = false;
    if (parsed.save && parsed.dc) {
      const res = await rollNativeCheck({
        statistic: shipStatistic(entry.actor, parsed.save),
        dc: parsed.dc,
        label: `${entry.actor.name}: ${parsed.save}`,
        actor: entry.actor,
        modifierOnly: computeShipStats(entry.actor)[parsed.save]
      });
      amount = Math.floor(roll.total * basicSaveMultiplier(res.degree));
      crit = res.degree === DEGREE.CRITICAL_FAILURE;
    }
    if (amount > 0)
      await applyDamageInDraft(draft, o.key, { amount, damageType: parsed.damageType, criticalHit: crit, source: hazardActor.name });
  }
  return { applied: true, parsed, targets: targets.length };
}

export const HazardEngine = {
  /** Trigger: detect -> validate -> execute -> chat -> update state. */
  async trigger(hazardUuid, { reason = null, automate = true } = {}) {
    const hazard = await fromUuidSafe(hazardUuid);
    if (!hazard) throw new Error(T("SF2eTSC.errors.actorNotFound"));
    const combat = activeStarshipCombat();
    const draft = new Draft(combat);
    if (!draft.tsc) throw new Error(T("SF2eTSC.errors.noCombat"));
    const hs = draft.tsc.hazardState[hazardUuid] ?? {};
    if (hs.disabled) return { skipped: true };
    const flags = hazardFlags(hazard) ?? {};
    const effectText = flags.effectText ?? flags.actions?.[0]?.text ?? hazard.system?.details?.routine ?? "";
    const o = findObject(draft.tsc, hazardUuid);
    const res = automate ? await applyAutomatedEffect(hazard, effectText, draft) : { applied: false };
    draft.event(HOOK_EVENTS.hazardTriggered, hazard, reason);
    draft.log(`${hazard.name}: ${T("SF2eTSC.chat.hazardTriggered")}`, "hazard", { hazardUuid });
    draft.afterCommit(() => postHazardCard({ hazard, zone: o?.zone, effectText, title: reason ?? T("SF2eTSC.chat.hazardTriggered") }));
    await draft.commit();
    return res;
  },

  /** Execute a complex hazard's Routine (on its initiative turn). */
  async executeRoutine(hazardUuid) {
    const hazard = await fromUuidSafe(hazardUuid);
    const flags = hazardFlags(hazard) ?? {};
    const routine = flags.routine ?? { cost: "1 action", text: hazard?.system?.details?.routine ?? "" };
    const combat = activeStarshipCombat();
    const draft = new Draft(combat);
    const hs = draft.tsc?.hazardState?.[hazardUuid] ?? {};
    if (hs.disabled) return { skipped: true };
    const n = parseRoutineActions(routine.cost);
    const res = await applyAutomatedEffect(hazard, routine.text, draft);
    draft.log(`${hazard.name}: Routine (${n})`, "hazard", { hazardUuid });
    draft.event(HOOK_EVENTS.hazardTriggered, hazard, "routine");
    draft.afterCommit(() =>
      postHazardCard({
        hazard,
        zone: findObject(draft.tsc, hazardUuid)?.zone,
        title: `${T("SF2eTSC.hazards.routine")} (${n})`,
        effectText: routine.text
      })
    );
    await draft.commit();
    return res;
  },

  async disable(hazardUuid, mode = "disable") {
    const combat = activeStarshipCombat();
    const hazard = await fromUuidSafe(hazardUuid);
    const draft = new Draft(combat);
    const prev = draft.tsc.hazardState[hazardUuid] ?? {};
    draft.tsc.hazardState[hazardUuid] = {
      ...prev,
      disabled: true,
      mode,
      disabledAt: { round: combat?.round ?? 0, time: game.time.worldTime }
    };
    draft.event(HOOK_EVENTS.hazardDisabled, hazard, mode);
    draft.log(`${hazard?.name}: ${T(`SF2eTSC.hazards.mode.${mode}`)}`, "hazard");
    await draft.commit();
  },

  async enable(hazardUuid) {
    const combat = activeStarshipCombat();
    const draft = new Draft(combat);
    draft.tsc.hazardState[hazardUuid] = { ...(draft.tsc.hazardState[hazardUuid] ?? {}), disabled: false, mode: null, disabledAt: null };
    await draft.commit();
  },

  /** Called on every turn change (GM): re-enable hazards whose reset time has elapsed. */
  async processResets(combat) {
    const tsc = getTsc(combat);
    let changed = false;
    for (const [uuid, hs] of Object.entries(tsc.hazardState)) {
      if (!hs.disabled || hs.mode === "permanent" || hs.mode === "destroy") continue;
      const hazard = fromUuidSync(uuid);
      const reset = parseReset(hazardFlags(hazard)?.reset ?? hazard?.system?.details?.reset);
      if (isResetReady(reset, hs.disabledAt, { round: combat.round, time: game.time.worldTime })) {
        tsc.hazardState[uuid] = { ...hs, disabled: false, mode: null, disabledAt: null };
        changed = true;
      }
    }
    if (changed) await saveTsc(combat, tsc);
  },

  /** After ships move, fire simple-hazard triggers in the zones they entered. */
  async onShipMoved(draft, shipUuid) {
    const me = findObject(draft.tsc, shipUuid);
    if (!me) return;
    for (const o of objectsInZone(draft.tsc, me.zone)) {
      if (o.type !== "hazard") continue;
      const hs = draft.tsc.hazardState[o.key] ?? {};
      if (hs.disabled) continue;
      const hazard = fromUuidSync(o.key);
      if (hazardFlags(hazard)?.isComplex) continue; // complex hazards act on their own turn
      draft.afterCommit(async () => {
        const setting = moduleSetting("autoRoutine");
        if (setting === "automatic")
          await HazardEngine.trigger(o.key, { reason: T("SF2eTSC.chat.enteredZone", { ship: fromUuidSync(shipUuid)?.name ?? "" }) });
        else if (setting === "prompt" && game.user.isGM) {
          const go = await foundry.applications.api.DialogV2.confirm({
            window: { title: T("SF2eTSC.hazards.triggerPromptTitle") },
            content: `<p>${T("SF2eTSC.hazards.triggerPrompt", { hazard: foundry.utils.escapeHTML(o.name), zone: o.zone })}</p>`,
            rejectClose: false
          }).catch(() => false);
          if (go)
            await HazardEngine.trigger(o.key, { reason: T("SF2eTSC.chat.enteredZone", { ship: fromUuidSync(shipUuid)?.name ?? "" }) });
        }
      });
    }
  },

  /** Complex hazard initiative turn. */
  async onHazardTurn(combatant) {
    const hazard = combatant.actor;
    if (!isStarshipHazard(hazard)) return;
    const mode = moduleSetting("autoRoutine");
    if (mode === "off") return;
    if (mode === "automatic") return this.executeRoutine(hazard.uuid);
    const go = await foundry.applications.api.DialogV2.confirm({
      window: { title: T("SF2eTSC.hazards.routinePromptTitle") },
      content: `<p>${T("SF2eTSC.hazards.routinePrompt", { hazard: foundry.utils.escapeHTML(hazard.name) })}</p>`,
      rejectClose: false
    }).catch(() => false);
    if (go) await this.executeRoutine(hazard.uuid);
  }
};
