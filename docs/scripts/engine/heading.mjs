/** Heading helpers. Headings are "left" | "right" but all logic goes through direction() so more can be added later. */
export function direction(heading) {
  return heading === "left" ? -1 : 1;
}
export function oppositeHeading(heading) {
  return heading === "left" ? "right" : "left";
}
export function clampZone(zone, zoneCount) {
  return Math.min(Math.max(1, Math.round(zone)), zoneCount);
}
/** Move along a heading by up to `zones` zones, clamped to the map. */
export function moveAlongHeading(zone, heading, zones, zoneCount) {
  return clampZone(zone + direction(heading) * zones, zoneCount);
}
/**
 * A starship is off-guard to attacks made from the opposite direction of its heading.
 * Starships in the same zone always treat each other as being in the direction of their heading.
 */
export function isAttackFromBehind(attackerZone, targetZone, targetHeading) {
  if (attackerZone === targetZone) return false;
  const attackerSide = attackerZone < targetZone ? -1 : 1; // which side of the target the attacker is on
  return attackerSide === -direction(targetHeading);
}
