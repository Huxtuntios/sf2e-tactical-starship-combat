/** RangeEngine: zone-based distance and range classification. Pure functions, no Foundry dependency. */

/** Distance in zones between two zone numbers. Same zone = 0. */
export function calculateZoneDistance(sourceZone, targetZone) {
  return Math.abs(Number(sourceZone) - Number(targetZone));
}

/**
 * Classify a target relative to a range limit.
 * @returns {{distance:number, range:number, inRange:boolean, sameZone:boolean, status:string}}
 */
export function classifyRange(sourceZone, targetZone, rangeZones) {
  const distance = calculateZoneDistance(sourceZone, targetZone);
  const range = rangeZones === Infinity ? Infinity : Number(rangeZones);
  const inRange = distance <= range;
  return {
    distance,
    range,
    inRange,
    sameZone: distance === 0,
    status: inRange ? (distance === 0 ? "same-zone" : "valid") : "out-of-range"
  };
}

/**
 * Attack penalty from range increments / volley. `rangeIncrement` is in zones.
 * PF2e convention: -2 per increment beyond the first (max 6 increments).
 */
export function rangePenalty({ distance, rangeIncrement = null, volley = null }) {
  let penalty = 0;
  const notes = [];
  if (rangeIncrement && rangeIncrement > 0 && distance > rangeIncrement) {
    const increments = Math.ceil(distance / rangeIncrement);
    penalty -= 2 * (increments - 1);
    notes.push({ key: "rangeIncrement", value: -2 * (increments - 1) });
  }
  if (volley && distance <= volley) {
    penalty -= 2;
    notes.push({ key: "volley", value: -2 });
  }
  return {
    penalty,
    notes,
    maxIncrements: rangeIncrement ? 6 : null,
    tooFar: rangeIncrement ? Math.ceil(distance / rangeIncrement) > 6 : false
  };
}
