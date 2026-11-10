/** Stable combatant anchors. Arbitrary conditions and sustaining are explicitly confirmed by the GM. */
export function timingFromDuration(duration, combat, creatorTurn) {
  if (!duration || !combat) return null;
  const cb = combat.turns?.[creatorTurn ?? combat.turn];
  if (!cb?.id) return null;
  const unit = duration.unit;
  if (!["round", "until-turn-end", "until-next-turn-end", "until-turn-start"].includes(unit)) return null;
  return {
    combatId: combat.id,
    combatantId: cb.id,
    mode: unit.includes("end") ? "turn-end" : "turn-start",
    createdTurn: { id: combat.combatant?.id ?? combat.turns?.[combat.turn]?.id, round: combat.round, turn: combat.turn },
    round: (combat.round ?? 0) + (unit === "until-turn-end" ? 0 : unit === "round" ? Math.max(1, duration.value ?? 1) : 1)
  };
}
export function timingExpired(timing, combat, previous = null) {
  if (!timing || !combat || timing.combatId !== combat.id || timing.mode === "condition") return false;
  previous ??= timing.createdTurn ?? null;
  const round = combat.round ?? 0;
  if (round < timing.round) return false;
  const currentId = combat.combatant?.id ?? combat.turns?.[combat.turn]?.id;
  if (timing.mode === "turn-start") return currentId === timing.combatantId || round > timing.round;
  // Only an actual forward transition out of the anchored turn can end it. No index arithmetic at round rollover.
  return (
    !!previous &&
    previous.id === timing.combatantId &&
    previous.round >= timing.round &&
    (round > previous.round || (round === previous.round && currentId !== previous.id && (combat.turn ?? 0) > previous.turn))
  );
}
export function sanitizeTiming(input, combat) {
  if (!input || !combat || !["turn-start", "turn-end", "rounds", "condition"].includes(input.mode))
    throw new Error("Invalid effect timing");
  const cb = combat.turns?.find((c) => c.id === input.combatantId);
  if (input.mode !== "condition" && !cb) throw new Error("Combatant not found");
  const rounds = Math.max(0, Math.min(100, Math.trunc(Number(input.rounds) || 0)));
  const condition = typeof input.condition === "string" ? input.condition.trim().slice(0, 240) : "";
  if (input.mode === "condition" && !condition) throw new Error("Condition is required");
  let dueRound = (combat.round ?? 0) + (input.mode === "rounds" ? Math.max(1, rounds) : rounds);
  const idx = combat.turns?.findIndex((c) => c.id === cb?.id) ?? -1;
  if (
    dueRound === combat.round &&
    ((input.mode === "turn-start" && idx <= combat.turn) || (input.mode === "turn-end" && idx < combat.turn))
  )
    dueRound++;
  return {
    combatId: combat.id,
    combatantId: cb?.id ?? null,
    mode: input.mode === "rounds" ? "turn-start" : input.mode,
    round: dueRound,
    condition,
    createdTurn: { id: combat.combatant?.id ?? combat.turns?.[combat.turn]?.id, round: combat.round, turn: combat.turn },
    sustain: input.sustain === true,
    lastReminderRound: combat.round ?? 0
  };
}
export function advanceEffects(effects, combat, previous) {
  const removed = [],
    reminders = [];
  const keep = effects
    .filter((e) => {
      if (e.timing && timingExpired(e.timing, combat, previous)) {
        removed.push(e);
        return false;
      }
      return true;
    })
    .map((e) => {
      const t = e.timing;
      if (!t?.sustain || t.combatId !== combat.id || (combat.round ?? 0) <= (t.lastReminderRound ?? -1)) return e;
      reminders.push(e);
      return { ...e, timing: { ...t, lastReminderRound: combat.round } };
    });
  return { keep, removed, reminders };
}
