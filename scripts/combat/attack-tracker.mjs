import { mapProfile, mapSummary, mapTurnKey } from "../engine/map.mjs";
import { activeStarshipCombat, combatantForActor } from "./tsc-state.mjs";

/** Domains / options used to evaluate MAP rule elements for a starship weapon attack. */
export const STARSHIP_ATTACK_DOMAINS = Object.freeze([
  "attack",
  "attack-roll",
  "ranged-attack-roll",
  "strike-attack-roll",
  "starship-strike"
]);

/**
 * MAP profile of an acting creature right now (agile trait, the attacker's rule elements). The module never counts
 * attacks: the attacker picks 1st / 2nd / 3rd+ manually, so `attacksMade` is always 0 and `current` is 0.
 * @returns {{enabled:boolean, ownTurn:boolean, key:string|null, attacksMade:number, current:number, next:number, profile:object}}
 */
export function mapStateFor({ combat = activeStarshipCombat(), attacker, weapon = null, extraOptions = [] }) {
  const traits = (weapon?.traits ?? []).map((t) => String(t).toLowerCase());
  const agile = traits.some((t) => t === "agile");
  let own;
  try {
    own = attacker?.getRollOptions?.(STARSHIP_ATTACK_DOMAINS) ?? [];
  } catch {
    own = [];
  }
  const options = [...own, "starship-strike", ...traits.map((t) => `item:trait:${t.replace(/\s+/g, "-")}`), ...extraOptions];
  const profile = mapProfile({
    agile,
    synthetics: attacker?.synthetics?.multipleAttackPenalties ?? {},
    domains: STARSHIP_ATTACK_DOMAINS,
    options
  });
  const cb = combat && attacker ? combatantForActor(combat, attacker) : null;
  const key = combat
    ? mapTurnKey({
        round: combat.round,
        currentCombatantId: combat.combatant?.id ?? null,
        attackerCombatantId: cb?.id ?? null,
        ownTurnOnly: true
      })
    : null;
  const sum = mapSummary(0, profile);
  return {
    enabled: true,
    ownTurn: !!cb && cb.id === combat?.combatant?.id,
    key,
    attacksMade: 0,
    current: sum.current,
    next: sum.next,
    profile
  };
}
