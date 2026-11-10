// В неопределённом или изменившемся порядке ходов не угадываем срок действия.
export function mineModificationStatus(mine, combat, operatorUuid) {
  const m = mine.tscMineModification;
  if (m == null) return null;
  const turns = combat?.turns;
  if (
    !m ||
    typeof m !== "object" ||
    !["smart", "targeting"].includes(m.type) ||
    m.operatorUuid !== operatorUuid ||
    !combat ||
    m.combatId !== combat.id ||
    !Array.isArray(turns) ||
    !Array.isArray(m.turnOrder) ||
    !Number.isInteger(combat.round) ||
    !Number.isInteger(combat.turn) ||
    !Number.isInteger(m.createdRound) ||
    !Number.isInteger(m.expiresRound) ||
    m.expiresRound !== m.createdRound + 1 ||
    combat.round < m.createdRound ||
    turns.length !== m.turnOrder.length ||
    turns.some((c, i) => !c?.id || c.id !== m.turnOrder[i]) ||
    new Set(m.turnOrder).size !== m.turnOrder.length ||
    combat.turn < 0 ||
    combat.turn >= turns.length
  )
    throw new Error("timing");
  const anchor = m.turnOrder.indexOf(m.combatantId);
  if (anchor < 0 || turns[anchor]?.actor?.uuid !== operatorUuid || (combat.round === m.createdRound && combat.turn < anchor))
    throw new Error("timing");
  if (combat.round > m.expiresRound || (combat.round === m.expiresRound && combat.turn > anchor)) return null;
  return m.type;
}
