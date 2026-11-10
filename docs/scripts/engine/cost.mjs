/** Action cost parsing and turn identity (the module never counts or limits actions: see rules-decisions.md §9). */

/** "reaction" | "free" | 1..3 -> { actions, reaction, free } */
export function normalizeCost(cost) {
  if (cost === "reaction" || cost === "free") return { actions: 0, reaction: cost === "reaction", free: cost === "free" };
  const n = Number(cost);
  return { actions: Number.isFinite(n) ? n : 0, reaction: false, free: false };
}

/** Identity of the current turn: "<round>:<combatantId>" (null without a combatant). Pure; used for turn guards. */
export function turnKey(combat) {
  const cb = combat?.combatant;
  return cb ? `${combat.round}:${cb.id}` : null;
}
