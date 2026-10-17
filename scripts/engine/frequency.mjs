/**
 * Frequency tracking. `used` is a map { [actionKey]: { round, turn, at } } stored per ship (flags).
 * `now` = { round, turn, time }  (time = game.time.worldTime in seconds).
 */
const SECONDS = { "10min": 600, hour: 3600, day: 86400, minute: 60 };

export function isFrequencyAvailable(freq, used, now) {
  if (!freq || !used) return true;
  const { per } = freq;
  const uses = freq.uses ?? 1;
  const entries = Array.isArray(used) ? used : [used];
  switch (per) {
    case "turn":
      return entries.filter((u) => u.round === now.round && u.turn === now.turn).length < uses;
    case "round":
      return entries.filter((u) => u.round === now.round).length < uses;
    default: {
      const span = SECONDS[per];
      if (!span) return true;
      return entries.filter((u) => now.time - u.at < span).length < uses;
    }
  }
}

export function recordUse(existing, now) {
  const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
  return [...list, { round: now.round, turn: now.turn, at: now.time }].slice(-8);
}

/**
 * Key under which a use is recorded. Tech Core: the frequency of a station action applies to the battle station
 * that grants it, so two gunnery stations each have their own "once per round". Actions without a station
 * (NPC abilities, builtins, frequency scope "ship") are tracked per ship.
 */
export function frequencyKey(action, station = null) {
  if (!station || action?.frequencyScope === "ship" || action?.station === "npc" || action?.npcOnly) return action.id;
  return `${station.id}:${action.id}`;
}
