/**
 * Encounter budget for tactical starship encounters (Starfinder Tech Core p.208 "Building and Running Encounters").
 * Starships are treated as creatures for XP; hazards and non-starship enemies count toward the same budget.
 * XP tables and per-character adjustment follow the PF2e/SF2e GM rules (GM Core). Small crews (3 or fewer PCs)
 * use the Tech Core rule instead: the budget is 20 lower for moderate or harder threats and 10 lower for low/trivial.
 */
export const CREATURE_XP = { "-4": 10, "-3": 15, "-2": 20, "-1": 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 };
export const SIMPLE_HAZARD_XP = { "-4": 2, "-3": 3, "-2": 4, "-1": 6, 0: 8, 1: 12, 2: 16, 3: 24, 4: 32 };
export const THREAT_ORDER = ["trivial", "low", "moderate", "severe", "extreme"];
export const BASE_BUDGET = { trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160 };
export const CHARACTER_ADJUSTMENT = { trivial: 10, low: 20, moderate: 20, severe: 30, extreme: 40 };
export const SMALL_CREW_REDUCTION = { trivial: 10, low: 10, moderate: 20, severe: 20, extreme: 20 };

export function entryXP(entry, partyLevel) {
  const diff = Number(entry.level) - Number(partyLevel);
  const table = entry.kind === "simpleHazard" ? SIMPLE_HAZARD_XP : CREATURE_XP;
  if (!Number.isFinite(diff) || diff < -4) return 0;
  if (diff > 4) return table["4"]; // beyond +4 the tables stop; such enemies are far too dangerous
  return table[String(diff)] ?? 0;
}

export function budgetFor(threat, partySize = 4) {
  const size = Math.max(1, Math.round(Number(partySize) || 4));
  const base = BASE_BUDGET[threat] ?? BASE_BUDGET.moderate;
  if (size <= 3) return base - SMALL_CREW_REDUCTION[threat];
  return base + (size - 4) * CHARACTER_ADJUSTMENT[threat];
}
export const budgetsFor = (partySize) => Object.fromEntries(THREAT_ORDER.map((t) => [t, budgetFor(t, partySize)]));

/** Threat = the highest threat whose budget the XP reaches (PF2e convention); above extreme sets `beyond`. */
export function rateXP(xp, partySize = 4) {
  const b = budgetsFor(partySize);
  // PF2e convention: the threat is the highest budget the XP reaches.
  let threat = "trivial";
  for (const t of THREAT_ORDER) if (xp >= b[t]) threat = t;
  return { threat, beyond: xp > b.extreme };
}

export function estimateEncounter({ partyLevel, partySize = 4, entries = [] }) {
  const xp = entries.reduce((n, e) => n + entryXP(e, partyLevel), 0);
  const budgets = budgetsFor(partySize);
  const { threat, beyond } = rateXP(xp, partySize);
  return { xp, threat, beyond, budgets, small: partySize <= 3, count: entries.length };
}

/**
 * Suggest enemy starships that fill the remaining budget of a target threat.
 * Each suggestion is "N × ship" (1–4 ships of the same type); the total lands inside the target band
 * (reaches the target budget, below the next threat's budget).
 */
export function suggestShips({ partyLevel, partySize = 4, threat = "moderate", ships = [], currentXP = 0, limit = 8, maxCount = 4 }) {
  const b = budgetsFor(partySize);
  const idx = THREAT_ORDER.indexOf(threat);
  if (idx < 0) return [];
  const next = THREAT_ORDER[idx + 1];
  // Band: reaches the target budget, stays below the next one (extreme: up to its budget).
  const lo = b[threat] - currentXP;
  const hi = (next ? b[next] - 1 : b.extreme) - currentXP;
  if (hi <= 0) return [];
  const out = [];
  for (const s of ships) {
    const xp = entryXP({ kind: "ship", level: s.level }, partyLevel);
    if (!xp) continue;
    for (let n = 1; n <= maxCount; n++) {
      const total = n * xp;
      if (total > hi) break;
      if (total >= lo) out.push({ id: s.id, name: s.name, level: s.level, faction: s.faction ?? null, count: n, xp, total });
    }
  }
  out.sort((a, c) => c.total - a.total || a.count - c.count || c.level - a.level || String(a.name).localeCompare(String(c.name)));
  return out.slice(0, limit);
}

/**
 * threat of a single enemy on its own (ship, hazard or creature) against the party budget.
 * `threat` is "minor" when it does not reach the trivial budget; `share` = % of the target-threat budget.
 */
export function rateEntry(entry, { partyLevel, partySize = 4, target = "moderate" } = {}) {
  const xp = entryXP(entry, partyLevel);
  const b = budgetsFor(partySize);
  const { threat, beyond } = rateXP(xp, partySize);
  const share = b[target] ? Math.round((xp / b[target]) * 100) : 0;
  return { xp, threat: xp < b.trivial ? "minor" : threat, beyond, share, tooHigh: Number(entry.level) - Number(partyLevel) > 4 };
}

/** Kind of a hazard content entry for the XP tables. */
export const hazardKind = (h) => (h?.isComplex || h?.complexity === "complex" ? "complexHazard" : "simpleHazard");

/**
 * suggest compendium hazards for the remaining budget of a target threat.
 * Unlike starships, a hazard fills only part of an encounter, so a suggestion is any single hazard that
 * fits the remaining budget (does not push the total above the target band); best fit first.
 */
export function suggestHazards({ partyLevel, partySize = 4, threat = "moderate", hazards = [], currentXP = 0, limit = 8 }) {
  const b = budgetsFor(partySize);
  const idx = THREAT_ORDER.indexOf(threat);
  if (idx < 0) return [];
  const next = THREAT_ORDER[idx + 1];
  const hi = (next ? b[next] - 1 : b.extreme) - currentXP;
  if (hi <= 0) return [];
  const want = Math.max(1, b[threat] - currentXP);
  const out = [];
  for (const h of hazards) {
    const kind = hazardKind(h);
    const xp = entryXP({ kind, level: h.level }, partyLevel);
    if (!xp || xp > hi) continue;
    out.push({ id: h.id, name: h.name, level: h.level, kind, xp, fills: xp >= want, needsReview: !!h.needsReview });
  }
  // Hazards that close the gap first (smallest overshoot), then the largest that still fit.
  out.sort(
    (a, c) =>
      Number(c.fills) - Number(a.fills) ||
      (a.fills ? a.xp - c.xp : c.xp - a.xp) ||
      a.level - c.level ||
      String(a.name).localeCompare(String(c.name))
  );
  return out.slice(0, limit);
}
