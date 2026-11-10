import { DEGREE } from "../constants.mjs";
/**
 * Fallback degree-of-success calculation (used by unit tests and flat checks when the system helper is unavailable).
 * The runtime prefers the native roll.degreeOfSuccess exposed by SF2e.
 */
export function degreeOfSuccess(total, dc, natural = null) {
  let degree;
  if (total >= dc + 10) degree = DEGREE.CRITICAL_SUCCESS;
  else if (total >= dc) degree = DEGREE.SUCCESS;
  else if (total <= dc - 10) degree = DEGREE.CRITICAL_FAILURE;
  else degree = DEGREE.FAILURE;
  if (natural === 20) degree = Math.min(DEGREE.CRITICAL_SUCCESS, degree + 1);
  else if (natural === 1) degree = Math.max(DEGREE.CRITICAL_FAILURE, degree - 1);
  return degree;
}
