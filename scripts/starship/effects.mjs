import { timingFromDuration, timingExpired } from "./effect-timing.mjs";
import { randomId } from "../utils/ids.mjs";
import { applicableEffects } from "./effect-scopes.mjs";
import { deriveConditionModifiers, modifierSelectorMatches, manualModifierSlug } from "./native-effect-adapter.mjs";

/**
 * Starship effects live in flags.<module>.starship.effects as plain data:
 * { id, slug, label, modifiers:[{selector,type,value}], conditions:[], expire:{round,turn}|null, sourceUuid, station? }
 * expire = the (round, turn index) at/after which the effect is gone. null = until removed.
 */
export function makeEffect(def, { combat = null, creatorTurn = null, actions = 1, sourceUuid = null } = {}) {
  const e = {
    id: randomId("fx"),
    slug: def.slug,
    label: def.label ?? def.slug,
    modifiers: [],
    conditions: def.conditions ?? [],
    sourceUuid,
    rider: def.rider ?? null,
    station: def.station ?? null
  };
  e.modifiers = (def.modifiers ?? []).map((m) => ({
    selector: m.selector,
    type: m.type,
    value: m.value === "actions" ? actions : m.value,
    label: e.label
  }));
  e.actionsSpent = Math.max(1, Math.min(3, Math.trunc(Number(actions) || 1)));
  e.timing = timingFromDuration(def.duration, combat, creatorTurn);
  e.expire = computeExpiry(def.duration, combat, creatorTurn);
  // against: "source" → the effect only applies against the starship that created it (e.g. Target Lock, Lock On).
  e.against = def.against === "source" ? sourceUuid : (def.against ?? null);
  // consumeOn: "strike" → removed after the next Strike it applies to (e.g. Target Lock success).
  e.consumeOn = def.consumeOn ?? null;
  e.until =
    def.duration?.unit && ["until-moved", "until-station-repaired", "until-cover-lost"].includes(def.duration.unit)
      ? def.duration.unit
      : null;
  return e;
}

export function effectiveEffectStates(data, context = {}) {
  const effects = applicableEffects(data.effects, context);
  const valued = (slug, physical) =>
    Math.max(
      physical ?? 0,
      ...effects.filter((e) => e.manual && e.conditions?.includes(slug)).map((e) => e.stateValue ?? e.conditionValue ?? 1)
    );
  const compromised = valued("compromised", data.compromised);
  return {
    ...data,
    compromised,
    wrecked: valued("wrecked", data.wrecked),
    inoperable: !!(data.inoperable || compromised > 0 || effects.some((e) => e.conditions?.includes("inoperable"))),
    offKilter: !!(data.offKilter || effects.some((e) => e.conditions?.includes("off-kilter"))),
    destroyed: !!data.destroyed,
    stations: (data.stations ?? []).map((station) => ({
      ...station,
      malfunctioning: !!(
        station.malfunctioning ||
        effects.some((effect) => effect.manual && effect.conditions?.includes("compromised")) ||
        applicableEffects(data.effects, { ...context, selector: "station-check", stationId: station.id }).some((e) =>
          e.conditions?.includes("malfunctioning")
        )
      )
    }))
  };
}

/** Convert a duration to an expiry point. */
export function computeExpiry(duration, combat, creatorTurn) {
  if (!duration || !combat) return null;
  const round = combat.round ?? 0;
  const turn = creatorTurn ?? combat.turn ?? 0;
  switch (duration.unit) {
    case "round":
      return { round: round + (duration.value ?? 1), turn }; // until the creator's turn comes around again
    case "until-turn-end":
      return { round, turn: turn + 1 }; // end of the creator's current turn
    case "until-next-turn-end":
      return { round: round + 1, turn: turn + 1 }; // end of the creator's next turn
    case "until-turn-start":
      return { round: round + 1, turn }; // start of the creator's next turn
    default:
      return null;
  }
}

export function isExpired(effect, combat, previous = null) {
  if (effect.timing) return timingExpired(effect.timing, combat, previous);
  if (!effect.expire || !combat) return false;
  const { round, turn } = effect.expire;
  return combat.round > round || (combat.round === round && combat.turn >= turn);
}

export function pruneExpired(effects, combat, previous = null) {
  const keep = effects.filter((e) => !isExpired(e, combat, previous));
  return { keep, removed: effects.filter((e) => !keep.includes(e)) };
}

/** Station-scoped Boosts must never leak to another station or a later combat. Legacy unscoped boosts remain stored but inactive. */
export function stationEffects(effects, stationId, combat, context = {}) {
  return applicableEffects(effects, { selector: "station-check", ...context, stationId }).filter((e) => {
    if (e.slug !== "boost-battle-station") return !e.station || e.station === stationId;
    if (!stationId || e.station !== stationId || !combat || e.timing?.combatId !== combat.id) return false;
    const timing = e.timing;
    const anchor = combat.turns?.findIndex((c) => c.id === timing.combatantId) ?? -1;
    if (anchor < 0 || !Number.isFinite(timing.round)) return false;
    if (combat.round > timing.round || (combat.round === timing.round && combat.turn >= anchor)) return false;
    return true;
  });
}

/** Replace a Boost on the same station, but keep boosts on other stations. */
export function replaceStationBoost(effects, effect) {
  return [...(effects ?? []).filter((x) => !(x.slug === effect.slug && x.station === effect.station)), effect];
}

/** Effects that apply a given selector. */
export function effectModifiers(effects, selector, context = {}) {
  if (selector === "station-check" && context.statistic === "dc") return [];
  return applicableEffects(effects, { ...context, selector }).flatMap((e) => {
    const actor = context.actor ?? (e.shipUuid ? globalThis.fromUuidSync?.(e.shipUuid) : null);
    const modifiers =
      e.manual && e.kind === "condition" && actor
        ? deriveConditionModifiers(e.slug, e.conditionValue, { ...context, actor, selector, applicationId: e.id })
        : (e.modifiers ?? []);
    return modifiers.flatMap((m, index) =>
      (e.manual ? modifierSelectorMatches(m.selector, selector, context) : m.selector === selector)
        ? [{ ...m, selector, slug: e.manual ? (m.slug ?? manualModifierSlug(e.id, index)) : e.slug }]
        : []
    );
  });
}
export function hasCondition(effects, condition, context = {}) {
  return applicableEffects(effects, context).some((e) => !e.against && e.conditions?.includes(condition));
}
/** Effects on a target that apply to an attack from `attackerUuid` (global ones + those restricted to that attacker). */
export function effectsAgainst(effects, attackerUuid, context = {}) {
  return applicableEffects(effects, { selector: "ac", ...context, againstUuid: attackerUuid });
}
/** Effects that are used up by a Strike from `attackerUuid`. */
export function consumedByStrike(effects, attackerUuid) {
  return (effects ?? []).filter((e) => e.consumeOn === "strike" && (!e.against || e.against === attackerUuid));
}
/** Effective off-guard against an attacker: global off-guard or an off-guard effect restricted to that attacker. */
export function offGuardAgainst(effects, attackerUuid, context = {}) {
  return effectsAgainst(effects, attackerUuid, context).some((e) => e.conditions?.includes("off-guard"));
}
