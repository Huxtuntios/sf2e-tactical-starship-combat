import { DEGREE } from "../constants.mjs";

export const COMPROMISED_DESTROYED_AT = 10;

/** DC of the hull integrity flat check. */
export function calculateHullIntegrityDC(compromised) {
  return 10 + Math.max(0, compromised);
}

/** Change of the compromised value for a hull integrity check result. */
export function hullIntegrityDelta(degree) {
  switch (degree) {
    case DEGREE.CRITICAL_SUCCESS:
      return -2;
    case DEGREE.SUCCESS:
      return -1;
    case DEGREE.FAILURE:
      return 1;
    case DEGREE.CRITICAL_FAILURE:
      return 2;
    default:
      return 0;
  }
}

/**
 * Apply a change to compromised/wrecked. Losing the compromised condition (reaching 0) grants wrecked +1 and removes inoperable.
 * @returns {{compromised:number, wrecked:number, inoperable:boolean, destroyed:boolean, lostCompromised:boolean}}
 */
export function resolveCompromisedChange({ compromised, wrecked = 0, inoperable = true }, delta) {
  let value = Math.max(0, compromised + delta);
  const destroyed = value >= COMPROMISED_DESTROYED_AT;
  let lost = false;
  let newWrecked = wrecked;
  let newInoperable = inoperable;
  if (compromised > 0 && value === 0) {
    lost = true;
    newWrecked = wrecked + 1;
    newInoperable = false;
  }
  return {
    compromised: Math.min(value, COMPROMISED_DESTROYED_AT),
    wrecked: newWrecked,
    inoperable: newInoperable,
    destroyed,
    lostCompromised: lost
  };
}

/** Called when Hull Points are restored. Gaining 1+ HP while compromised removes the condition. */
export function resolveHullRestored({ compromised, wrecked = 0, inoperable = false }, hpBefore, hpAfter) {
  if (compromised > 0 && hpBefore <= 0 && hpAfter >= 1) {
    return { compromised: 0, wrecked: wrecked + 1, inoperable: false, lostCompromised: true };
  }
  if (inoperable && compromised === 0 && hpBefore <= 0 && hpAfter >= 1) {
    return { compromised, wrecked, inoperable: false, lostCompromised: false };
  }
  return { compromised, wrecked, inoperable, lostCompromised: false };
}

/** Initial compromised value when a player starship reaches 0 HP. */
export function initialCompromised({ wrecked = 0, criticalHit = false }) {
  return (criticalHit ? 2 : 1) + (wrecked > 0 ? wrecked : 0);
}
