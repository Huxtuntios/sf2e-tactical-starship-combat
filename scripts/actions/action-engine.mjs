import { ct } from "../content/content-i18n.mjs";
import { DEGREE, DEGREE_KEYS, HOOK_EVENTS } from "../constants.mjs";
import { getAction } from "../content/loader.mjs";
import { gradeAtLeast } from "../engine/advancement.mjs";
import { normalizeCost } from "../engine/cost.mjs";
import { mapPenaltyForChoice, MAP_CHOICES } from "../engine/map.mjs";
import { mapStateFor } from "../combat/attack-tracker.mjs";
import { serialize } from "../utils/serial.mjs";
import { isFrequencyAvailable, recordUse, frequencyKey } from "../engine/frequency.mjs";
import { findObject } from "../engine/sensor-ops.mjs";
import { evaluateTarget, TARGET_REASON_ERRORS } from "../engine/target-rules.mjs";
import { Draft } from "./draft.mjs";
import { buildNpcAction, slugifyName } from "./npc-inline.mjs";
import { bindNpcStrikeTemplate } from "./npc-rows.mjs";
import { readStarship } from "../starship/starship-state.mjs";
import { evaluateRequirements } from "./requirements.mjs";
import { executeEffects, resolveSeekBuiltin, modelKeyOf } from "./effects-exec.mjs";
import { resolveStrike, resolveAreaFire, resolveSpellAttack, resolveWeapon } from "./strike.mjs";
import { computeShipStats, shipDC, shipStatistic, crewStatistic, rollNativeCheck } from "../starship/stats.mjs";
import { effectModifiers } from "../starship/effects.mjs";
import { isStarship } from "../starship/starship-state.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { can } from "../crew/permissions.mjs";
import { postActionCard } from "../chat/chat-cards.mjs";
import { registerHandler } from "../socket.mjs";
import { fromUuidSafe, fromUuidSync_, T, moduleSetting, levelDC } from "../utils/foundry.mjs";
import { stationRowFor } from "../starship/station-rows.mjs";

export const actionLabel = (a) => (game.i18n.has(`SF2eTSC.actions.${a.id}`) ? T(`SF2eTSC.actions.${a.id}`) : ct(a.name));
const REPAIR_IDS = ["repair-station", "jump-start"];
const fail = (key, data) => {
  throw new Error(T(`SF2eTSC.errors.${key}`, data));
};
/** Rule enforcement mode (world setting): "warn" (default) never blocks a rule, "strict" refuses like before. */
export const strictRulesFor = (gmOverride) => !gmOverride && moduleSetting("ruleEnforcement") === "strict";

function resolveCost(action, options) {
  if (Array.isArray(action.cost)) {
    const c = options.actions ?? action.cost[0];
    if (!action.cost.includes(c)) fail("badCost");
    return c;
  }
  return action.cost;
}

/** Range used for targeting by an action (sensor / weapon / fixed zones). */
export function targetingRange(ctx) {
  const t = ctx.action.targeting ?? { type: "none" };
  let range = t.range ?? "sensor";
  if (range === "sensor") range = ctx.stats.sensorRange;
  if (range === "weapon") range = ctx.weapon?.range ?? resolveWeapon(ctx)?.range ?? 99;
  return Number(range);
}
export function rangeIncrementFor(weapon) {
  for (const tr of weapon?.traits ?? []) {
    const m = /range increment (\d+) zones?/i.exec(String(tr));
    if (m) return Number(m[1]);
  }
  return null;
}
/** Shared target rule input for a context (also used by the attack declaration card). */
export function targetRuleInput(ctx) {
  const t = ctx.action.targeting ?? { type: "none" };
  return {
    tsc: ctx.tsc,
    shipKey: ctx.shipUuid,
    range: targetingRange(ctx),
    rangeIncrement: ["strike", "npc-strike"].includes(ctx.action.builtin) ? rangeIncrementFor(ctx.weapon) : null,
    allowSelf: !!t.allowSelf,
    enforceDetection: ctx.data.role === "player" && ctx.action.builtin !== "seek",
    override: !!ctx.gmOverride,
    soft: !ctx.strictRules,
    isDestroyed: (key) => {
      const a = fromUuidSync_(findObject(ctx.tsc, key)?.actorUuid ?? key);
      return !!(a && isStarship(a) && readStarship(a).destroyed);
    }
  };
}

async function resolveTarget(ctx) {
  const t = ctx.action.targeting ?? { type: "none" };
  if (t.type !== "starship") return null;
  const key = ctx.options.targetKey;
  if (!key) fail("needTarget");
  const obj = findObject(ctx.tsc, key);
  if (!obj) fail("targetNotFound");
  const ev = evaluateTarget({ ...targetRuleInput(ctx), obj });
  if (!ev.available) fail(TARGET_REASON_ERRORS[ev.reason] ?? "badTarget");
  if (ev.warning) ctx.rule(TARGET_REASON_ERRORS[ev.warning] ?? "badTarget");
  const entry = await ctx.draft.ship(obj.actorUuid ?? obj.key);
  return {
    key,
    uuid: entry.actor.uuid,
    actor: entry.actor,
    data: entry.data,
    obj,
    modelKey: modelKeyOf(entry.data),
    distance: ev.distance
  };
}

function pickSkill(ctx) {
  const c = ctx.action.check;
  if (ctx.options.skill) return ctx.options.skill;
  if (c.skillsByStation) return (c.skillsByStation[ctx.station?.type] ?? Object.values(c.skillsByStation)[0])[0];
  return c.skills?.[0] ?? "perception";
}
function checkDC(ctx, spec) {
  switch (spec?.type) {
    case "fixed":
      return spec.value;
    case "targetPerception":
      return shipDC(computeShipStats(ctx.target.actor), "perception");
    case "targetReflex":
      return shipDC(computeShipStats(ctx.target.actor), "reflex");
    case "targetWill":
      return shipDC(computeShipStats(ctx.target.actor), "will");
    case "targetFortitude":
      return shipDC(computeShipStats(ctx.target.actor), "fortitude");
    case "levelBased":
      return ctx.options.manualDC ?? levelDC(ctx.options.dcLevel ?? ctx.data.level);
    case "manualReflexDC": {
      if (ctx.options.pendingStrike) {
        const a = fromUuidSync(ctx.options.pendingStrike.attackerUuid);
        if (a) return shipDC(computeShipStats(a), "reflex");
      }
      return ctx.options.manualDC ?? 10 + (ctx.level + 5);
    }
    default:
      return null;
  }
}

/** Roll the action's check through the native pipeline. Fills ctx.degree / ctx.checkBonus / ctx.lines. */
async function runCheck(ctx) {
  const c = ctx.action.check;
  if (!c || c.kind === "none") return;
  if (c.kind === "targetSave") {
    if (!ctx.target) fail("needTarget");
    const dcStat = crewStatistic(ctx.crew ?? ctx.ship, c.dcSkill);
    const dc = dcStat?.dc?.value ?? 10 + ctx.level + 5;
    const stat = shipStatistic(ctx.target.actor, c.save);
    const res = await rollNativeCheck({
      statistic: stat,
      dc,
      label: `${ctx.target.actor.name}: ${T(`SF2eTSC.ui.${c.save}`)}`,
      actor: ctx.target.actor,
      modifierOnly: computeShipStats(ctx.target.actor)[c.save]
    });
    ctx.degree = res.degree;
    ctx.rollResult = res;
    return;
  }
  const skill = pickSkill(ctx);
  let dc = checkDC(ctx, c.dc);
  if (c.dcOptions && ctx.options.dcChoice != null) {
    const o = c.dcOptions[ctx.options.dcChoice];
    if (o) {
      dc = o.dc;
      ctx.checkBonus = o.bonus;
    }
  }
  const roller = ctx.crew ?? ctx.ship;
  let statistic = c.kind === "perception" ? roller.perception : crewStatistic(roller, skill);
  let fallbackMod = 0;
  if (!statistic && ctx.data.role !== "player")
    fallbackMod = skill === "perception" ? ctx.stats.perception : (ctx.data.skills?.[skill] ?? 0);
  else if (!statistic) fail("noSkill", { skill });
  const boost = effectModifiers(
    ctx.data.effects.filter((e) => !e.station || e.station === ctx.station?.id),
    "station-check"
  ).map((m) => ({ label: m.slug, type: m.type, value: m.value }));
  const res = await rollNativeCheck({
    statistic,
    dc: dc ?? (ctx.action.builtin === "seek" ? undefined : 0),
    label: `${actionLabel(ctx.action)} (${game.i18n.has(`SF2eTSC.skills.${String(skill).toLowerCase()}`) ? T(`SF2eTSC.skills.${String(skill).toLowerCase()}`) : skill})`,
    actor: roller,
    extraModifiers: boost,
    secret: !!c.secret,
    modifierOnly: fallbackMod,
    extraRollOptions: [`action:${ctx.action.slug}`]
  });
  ctx.degree = res.degree;
  ctx.rollResult = res;
  ctx.dc = dc;
  if (dc != null) ctx.lines.push({ label: T("SF2eTSC.chat.check"), value: T("SF2eTSC.chat.vsDC", { total: res.total, dc }) });
}

function reactionResultFor(ctx) {
  const id = ctx.action.id;
  if (id === "reposition-shield")
    return ctx.degree === DEGREE.CRITICAL_SUCCESS
      ? { shieldAbsorb: "full" }
      : ctx.degree === DEGREE.SUCCESS
        ? { shieldAbsorb: "half" }
        : ctx.degree === DEGREE.CRITICAL_FAILURE
          ? { bypassHull: true }
          : {};
  if (id === "drone-block") return { resistance: Math.ceil(ctx.level / 2) };
  return {};
}

/**
 * Authoritative action execution (GM client). Pipeline:
 * validate -> permission -> turn -> station -> malfunction -> requirements -> cost -> frequency -> target -> check
 * -> effects -> state transition (cost + frequency + effects in ONE commit) -> chat -> hooks.
 */
export async function executeAction(params) {
  // top-level executions are serialized on the GM: two near-simultaneous requests can't both read the same
  // budget/MAP/target state (nested reaction executions share the parent's draft and run inline)
  if (params.draft) return executeActionNow(params);
  return serialize("tsc", () => executeActionNow(params));
}

/** Structured result used by attack result cards (no Foundry objects). */
function attackSummaryOf(ctx) {
  return {
    degree: ctx.degree,
    degreeLabel: ctx.degreeLabel,
    lines: ctx.lines,
    reports: ctx.reports,
    manual: ctx.manual,
    attack: ctx.attackResult ?? null,
    damage: ctx.damageResults ?? [],
    map: ctx.mapState ? { before: ctx.mapState.current, choice: String(ctx.mapState.manualIndex ?? 0) } : null,
    weapon: ctx.weapon ? { id: ctx.weapon.id, name: ctx.weapon.name } : null,
    targetName: ctx.target?.actor?.name ?? null,
    pendingDamage: ctx.pendingDamage ?? null
  };
}

async function executeActionNow(params) {
  const { userId, shipUuid, crewUuid = null, options = {}, draft: parent = null } = params;
  const user = params.user ?? game.users.get(userId) ?? null;
  if (!user) fail("noPermission");
  const ship = await fromUuidSafe(shipUuid);
  if (!ship || !isStarship(ship)) fail("shipNotFound");
  // catalogue action, or an NPC statblock action rebuilt from the ship's own data (never trusted from the client)
  let action = getAction(params.actionId) ?? buildNpcAction(readStarship(ship), params.actionId);
  if (!action && String(params.actionId ?? "").startsWith("npc-strike:")) fail("npcStrikeInvalid");
  if (!action) fail("unknownAction");
  // catalogue Strike templates (Engaged Strike) carry no Strike: bind the ship's own Strike, never fall back to player weapons
  if (action.builtin === "npc-strike" && !action.strike) {
    action = bindNpcStrikeTemplate(action, readStarship(ship)).action;
    if (!action) fail("npcStrikeUnbound");
  }
  if (action.builtin === "npc-strike") options.npcStrike = action.strike;
  if (action.passive) fail("passiveAbility");
  const combat = activeStarshipCombat();
  const draft = parent ?? new Draft(combat);
  const entry = await draft.ship(shipUuid);
  const data = entry.data;
  const isGM = user.isGM;
  const gmOverride = isGM && !!options.gmOverride;
  const crew = crewUuid ? await fromUuidSafe(crewUuid) : null;
  const hasCrewRole = data.role === "player" || (data.crew?.length ?? 0) > 0;

  const strictRules = strictRulesFor(gmOverride);
  const warnings = [];
  /** A rule problem: refused in strict mode, a warning on the chat card otherwise (nothing is ever blocked silently). */
  const rule = (key, data) => {
    const msg = T(`SF2eTSC.errors.${key}`, data);
    if (strictRules) throw new Error(msg);
    if (!warnings.includes(msg)) warnings.push(msg);
  };
  if (data.destroyed && !gmOverride) rule("shipDestroyed");
  if (!isGM) {
    if (!can(user, ship, "operateStation")) fail("noPermission");
    if (crew && !crew.testUserPermission?.(user, "OWNER")) fail("noPermission");
  }
  if (!combat && !gmOverride && !action.builtin?.startsWith?.("seek") && !isGM) fail("noCombat");

  const ctx = {
    user,
    isGM,
    gmOverride,
    strictRules,
    rule,
    warnings,
    combat,
    draft,
    ship,
    shipUuid,
    data,
    crew,
    crewUuid,
    action,
    options,
    level: data.level,
    reports: [],
    lines: [],
    manual: [],
    degree: null,
    degreeLabel: null,
    areaTargets: [],
    suppressActionCard: false,
    get tsc() {
      return draft.tsc;
    },
    stats: computeShipStats(ship),
    station: null,
    stationRow: null,
    target: null,
    weapon: null
  };
  if (!ctx.tsc && !isGM) fail("noCombat");
  if (!ctx.tsc) draft.tsc = (await import("../engine/sensor-ops.mjs")).defaultSensorState();

  // --- station & helm
  if (!action.npcOnly && action.station !== "npc") {
    ctx.station = crew
      ? (data.stations.find((s) => s.helmedBy === crewUuid) ?? null)
      : (data.stations.find((s) => s.type === action.station) ?? null);
    if (action.station !== "any") {
      if (!ctx.station || ctx.station.type !== action.station) {
        if (!gmOverride) rule("notHelming", { station: T(`SF2eTSC.stations.${action.station}`) });
      } else if (!gradeAtLeast(ctx.station.grade, action.minGrade ?? "commercial") && !gmOverride) rule("gradeTooLow");
    } else if (!ctx.station && !gmOverride && hasCrewRole && !REPAIR_IDS.includes(action.id)) rule("notHelming", { station: "" });
    if (ctx.station) ctx.stationRow = stationRowFor(ctx.station);
  } else if (action.npcOnly) {
    // NPC statblock action: the battle station(s) listing it. Shared actions (*) are blocked if ANY of them malfunctions.
    const owners = npcOwnerStations(data, action);
    ctx.station = owners[0] ?? null;
    if (owners.some((s) => s.malfunctioning) && !gmOverride) rule("malfunctioning");
  } else if (action.station === "generator") ctx.station = data.stations.find((s) => s.type === "generator") ?? null;
  if (ctx.station?.malfunctioning && !REPAIR_IDS.includes(action.id) && !gmOverride) rule("malfunctioning");
  if (action.id === "repair-station" && ctx.station?.repairLockedUntilTurnOf && !gmOverride) rule("repairLocked");

  if (!gmOverride && crew && (action.traits ?? []).includes("manipulate") && crew.handsFree === 0) rule("noFreeHand");

  // --- requirements
  if (
    action.builtin === "strike" ||
    action.builtin === "area-fire" ||
    action.builtin === "auto-fire" ||
    action.builtin === "spell-attack" ||
    action.builtin === "npc-strike"
  )
    ctx.weapon = resolveWeapon(ctx);
  ctx.target = params.dryRun ? null : await resolveTarget(ctx);
  const failed = evaluateRequirements(action, ctx, strictRules);
  if (failed.length) rule("requirementFailed", { reqs: failed.map((k) => T(`SF2eTSC.requirements.${k}`)).join(", ") });

  // --- cost, frequency (0.6.0): the module no longer counts or limits actions/reactions per turn, has no shared
  // action pool and no turn gate. The GM and players track the 3 actions + reaction themselves, as at the table.
  const sheetRoll = options.sheetRoll === true && ["strike", "npc-strike"].includes(action.builtin);
  if (!sheetRoll) delete options.sheetRoll;
  const costValue = resolveCost(action, options);
  const cost = normalizeCost(costValue);
  if (action.frequency && !gmOverride && !sheetRoll) {
    const now = { round: combat?.round ?? 0, turn: combat?.turn ?? 0, time: game.time.worldTime };
    if (!isFrequencyAvailable(action.frequency, data.frequencyUsed?.[frequencyKey(action, ctx.station)], now)) rule("frequencyUsed");
  }
  options.actions = cost.actions || options.actions || 1;

  // --- multiple attack penalty (0.6.0): manual only. The attacker picks 1st / 2nd / 3rd+ attack (default: 1st, no
  // penalty); the profile (agile, rule elements of the attacker) is honoured; the value is applied exactly once and
  // nothing is counted between attacks.
  const isAttack = ["strike", "npc-strike", "spell-attack"].includes(action.builtin) || (action.traits ?? []).includes("attack");
  if (isAttack && !options.reaction) {
    const ms = mapStateFor({ combat, attacker: crew ?? ship, weapon: ctx.weapon });
    const choice = mapPenaltyForChoice(options.mapChoice ?? "0", ms);
    ctx.mapPenalty = choice.penalty;
    ctx.mapState = { ...ms, current: choice.penalty, manual: true, manualIndex: choice.index };
  }

  // warn mode: every rule problem found above leads the report list of the chat card (nothing was blocked)
  ctx.reports.unshift(...warnings.map((w) => `⚠ ${w}`));

  // dry run (attack declaration card): every validation above ran, nothing was rolled, spent or written
  if (params.dryRun) return { ok: true, dryRun: true, ctx, costValue };
  ctx.cardMode = !!params.cardMode;
  if (ctx.cardMode) ctx.suppressActionCard = true;

  // --- check / builtin resolution / effects
  if (action.builtin === "strike" || action.builtin === "npc-strike") await resolveStrike(ctx);
  else if (action.builtin === "area-fire") await resolveAreaFire(ctx, "area-fire");
  else if (action.builtin === "auto-fire") await resolveAreaFire(ctx, "auto-fire");
  else if (action.builtin === "spell-attack") await resolveSpellAttack(ctx);
  else {
    await runCheck(ctx);
    if (ctx.degree != null) ctx.degreeLabel = T(`SF2eTSC.degree.${DEGREE_KEYS[ctx.degree]}`);
    if (action.builtin === "seek") await resolveSeekBuiltin(ctx, ctx.rollResult);
    const fx = action.outcomes && ctx.degree != null ? (action.outcomes[DEGREE_KEYS[ctx.degree]] ?? []) : (action.effects ?? []);
    await executeEffects(fx, ctx);
  }

  if (ctx.moved)
    draft.afterCommit(async () => {
      const { HazardEngine } = await import("../hazards/hazard-engine.mjs");
      await HazardEngine.onShipMoved(draft, shipUuid);
    });

  // --- state transition (cost + frequency + log in the same commit as the effects)
  if (action.frequency && !sheetRoll) {
    const fk = frequencyKey(action, ctx.station);
    data.frequencyUsed = {
      ...(data.frequencyUsed ?? {}),
      [fk]: recordUse(data.frequencyUsed?.[fk], { round: combat?.round ?? 0, turn: combat?.turn ?? 0, time: game.time.worldTime })
    };
  }
  draft.log(`${ship.name}: ${actionLabel(action)}${ctx.degreeLabel ? ` — ${ctx.degreeLabel}` : ""}`, "action", {
    actionId: action.id,
    crewUuid,
    degree: ctx.degree
  });
  draft.event(HOOK_EVENTS.actionExecuted, ship, action, ctx.degree);
  if (!ctx.suppressActionCard)
    draft.afterCommit(() =>
      postActionCard({
        actor: ship,
        action: { ...action, name: actionLabel(action) },
        crewName: crew?.name,
        stationName: ctx.station?.name,
        degreeLabel: ctx.degreeLabel,
        lines: ctx.lines,
        reports: ctx.reports,
        manual: ctx.manual
      })
    );
  const reactionResult = action.cost === "reaction" ? reactionResultFor(ctx) : {};
  if (!parent) await draft.commit();
  return { ok: true, degree: ctx.degree, reports: ctx.reports, reactionResult, summary: attackSummaryOf(ctx) };
}

/** Stations of an NPC ship whose statblock list contains the action (by name/slug). */
export function npcOwnerStations(data, action) {
  const slug = slugifyName(action.name ?? action.slug);
  return (data.stations ?? []).filter((s) => (s.actions ?? []).some((n) => slugifyName(n) === slug));
}

/**
 * Options a client may send with an action request. Everything else (draft, npcStrike, pendingStrike, reaction,
 * skipReactions, …) is internal and is rebuilt on the GM side; gmOverride is honoured only for GM senders.
 */
export const CLIENT_OPTION_KEYS = Object.freeze([
  "actions",
  "rank",
  "skill",
  "dcChoice",
  "manualDC",
  "dcLevel",
  "targetKey",
  "targetStationId",
  "stationId",
  "areaOrigin",
  "weaponId",
  "gmOverride",
  "sheetRoll",
  "mapChoice",
  "areaExcludeKeys"
]);
const NUMERIC_OPTIONS = ["actions", "rank", "dcChoice", "manualDC", "dcLevel", "areaOrigin"];
export function sanitizeActionRequest(payload, user) {
  const p = payload && typeof payload === "object" ? payload : {};
  const options = {};
  for (const k of CLIENT_OPTION_KEYS) {
    const v = p.options?.[k];
    if (v === undefined || v === null || v === "") continue;
    if (NUMERIC_OPTIONS.includes(k)) {
      const n = Number(v);
      if (Number.isFinite(n)) options[k] = Math.trunc(n);
    } else if (k === "gmOverride") {
      if (user?.isGM && v === true) options.gmOverride = true;
    } else if (k === "sheetRoll") {
      if (v === true) options.sheetRoll = true;
    } else if (k === "mapChoice") {
      if (MAP_CHOICES.includes(String(v))) options.mapChoice = String(v);
    } else if (k === "areaExcludeKeys") {
      if (Array.isArray(v))
        options.areaExcludeKeys = v
          .filter((x) => typeof x === "string" && x)
          .slice(0, 50)
          .map((x) => x.slice(0, 300));
    } else if (typeof v === "string") options[k] = v.slice(0, 200);
  }
  const str = (v) => (typeof v === "string" && v ? v.slice(0, 300) : null);
  return { shipUuid: str(p.shipUuid), actionId: str(p.actionId), crewUuid: str(p.crewUuid), stationId: str(p.stationId), options };
}

export function registerActionHandlers() {
  registerHandler("executeAction", ({ user, payload }) =>
    executeAction({ ...sanitizeActionRequest(payload, user), user, userId: user.id })
  );
}
