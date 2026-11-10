import { GRADES } from "../constants.mjs";

const SLOW = [1, 2, 4, 10, 12, 16, 19]; // drone console, gunnery
const FAST = [1, 2, 5, 8, 11, 14, 18]; // generator, magic conduit, pilot's console, scanners
const THRESHOLDS = { gunnery: SLOW, "drone-console": SLOW, generator: FAST, "magic-conduit": FAST, pilot: FAST, scanners: FAST };

/** Grade a station type has at a starship level. */
export function stationGradeForLevel(stationType, level) {
  const th = THRESHOLDS[stationType] ?? FAST;
  let grade = GRADES[0];
  th.forEach((lv, i) => {
    if (level >= lv) grade = GRADES[i];
  });
  return grade;
}
export function gradeIndex(grade) {
  return Math.max(0, GRADES.indexOf(grade));
}
export function gradeAtLeast(grade, minimum) {
  return gradeIndex(grade) >= gradeIndex(minimum);
}
/** Frame statistics for a level from the frame table (array of per-level rows). */
export function frameStatsAtLevel(frame, level) {
  const rows = frame?.table ?? [];
  const lv = Math.min(Math.max(1, Math.floor(level)), rows.length || 1);
  const row = rows.find((r) => r.level === lv) ?? rows[rows.length - 1] ?? null;
  return row ? { ...row } : null;
}

/** Sensor range = frame base + scanners increase for the scanners grade (if installed). */
export function sensorRange(frameBase, scannersAdvancement) {
  return frameBase + (scannersAdvancement?.sensorIncrease ?? 0);
}

/** Heightened formula helper: dice that scale every `step` levels from `from` level (e.g. Generate Shields 1d4 at 1, +1d4 at 3, 5...). */
export function scaledDiceCount({ base = 1, from = 3, step = 2 }, level) {
  if (level < from) return base;
  return base + 1 + Math.floor((level - from) / step);
}
