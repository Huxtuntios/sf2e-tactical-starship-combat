/**
 * Multiple attack penalty (Player Core p. 402 / SF2e): pure helpers, no Foundry globals.
 *
 *  - counted per acting creature (crew member, or the NPC starship when it attacks without crew), never per ship;
 *  - only during that creature's own turn ("the multiple attack penalty applies only during your turn"):
 *    off-turn attacks (reactions) neither suffer nor add MAP;
 *  - base −5 / −10, agile −4 / −8;
 *  - actor rule elements (synthetics.multipleAttackPenalties[domain] = [{label, penalty, predicate}]) may improve
 *    it exactly like sf2e's calculateMAPs(): the least severe applicable map1 wins, map2 = penalty × 2;
 *  - an item with subjectToMAP === false (NPC melee option) is exempt.
 */
export const MAP_BASE = Object.freeze({ normal: { map1: -5, map2: -10 }, agile: { map1: -4, map2: -8 } });

const defaultPredicateTest = (entry, options) => {
  const p = entry?.predicate;
  if (!p) return true;
  if (typeof p.test === "function") return p.test(options);
  if (Array.isArray(p)) return p.every((term) => (typeof term === "string" ? options.has(term) : true));
  return true;
};

/**
 * @param {object} p
 * @param {boolean} [p.agile]
 * @param {boolean} [p.exempt]          subjectToMAP === false
 * @param {object}  [p.synthetics]       actor.synthetics.multipleAttackPenalties
 * @param {string[]} [p.domains]         e.g. ["attack", "attack-roll", "ranged-attack-roll", "starship-strike"]
 * @param {Iterable<string>} [p.options] roll options used to test predicates
 * @returns {{map1:number, map2:number, label:string|null, source:"base"|"agile"|"rule-element"|"exempt"}}
 */
export function mapProfile({
  agile = false,
  exempt = false,
  synthetics = {},
  domains = [],
  options = [],
  predicateTest = defaultPredicateTest
} = {}) {
  if (exempt) return { map1: 0, map2: 0, label: null, source: "exempt" };
  const base = agile ? { ...MAP_BASE.agile, label: null, source: "agile" } : { ...MAP_BASE.normal, label: null, source: "base" };
  const set = options instanceof Set ? options : new Set(options);
  const candidates = domains
    .flatMap((d) => synthetics?.[d] ?? [])
    .filter((e) => Number.isFinite(e?.penalty) && predicateTest(e, set))
    .map((e) => ({ map1: e.penalty, map2: e.penalty * 2, label: e.label ?? null, source: "rule-element" }));
  return [base, ...candidates].reduce((best, c) => (c.map1 > best.map1 ? c : best));
}

export const MAP_CHOICES = Object.freeze(["0", "1", "2"]);
/**
 * Penalty for a roll from the starship sheet. (0.6.0) always chosen manually: "0" 1st, "1" 2nd, "2" 3rd+ attack;
 * "0"/"1"/"2" = the player's choice (1st / 2nd / 3rd+ attack) using the SAME profile (agile, rule elements).
 * Exactly one value is returned and applied once; disabled MAP setting → 0.
 */
export function mapPenaltyForChoice(choice, { enabled = true, current = 0, profile = MAP_BASE.normal } = {}) {
  if (!enabled) return { penalty: 0, manual: false, index: null };
  const c = MAP_CHOICES.includes(String(choice)) ? String(choice) : "0";
  const index = Number(c);
  return { penalty: mapFor(index, profile), manual: true, index };
}

/** Penalty for the next attack after `attacksMade` attacks this turn. */
export function mapFor(attacksMade, profile = MAP_BASE.normal) {
  if (!attacksMade || attacksMade <= 0) return 0;
  return attacksMade === 1 ? profile.map1 : profile.map2;
}

/** Attack record { key, count, entries:[{source,label}] }; resets when the turn key changes. */
export function attacksMadeIn(record, key) {
  return record && key && record.key === key ? (record.count ?? 0) : 0;
}
/** Turn key used for MAP: own turn → "<round>:<combatantId>", otherwise null (no MAP, not counted). */
export function mapTurnKey({ round, currentCombatantId, attackerCombatantId, ownTurnOnly = true }) {
  if (!currentCombatantId) return null;
  if (attackerCombatantId && attackerCombatantId === currentCombatantId) return `${round}:${currentCombatantId}`;
  return ownTurnOnly ? null : `${round}:${currentCombatantId}`;
}

/** Summary for cards: attacks made, current penalty, next penalty. */
export function mapSummary(attacksMade, profile) {
  return { attacksMade, current: mapFor(attacksMade, profile), next: mapFor(attacksMade + 1, profile), profile };
}
