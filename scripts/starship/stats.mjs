import { stackModifiers } from "../engine/stacking.mjs";
import { effectModifiers, hasCondition } from "./effects.mjs";
import { readStarship } from "./starship-state.mjs";
import { Content } from "../content/loader.mjs";
import { log } from "../utils/logging.mjs";
import { DEGREE } from "../constants.mjs";
import { degreeOfSuccess } from "../engine/degree.mjs";
/** Localized label with an English fallback (stats are also used by pure unit tests without i18n). */
const L = (key, fallback) => (globalThis.game?.i18n?.has?.(`SF2eTSC.${key}`) ? globalThis.game.i18n.localize(`SF2eTSC.${key}`) : fallback);

const mod = (type, value, label) => ({ type, value, label });

/** Item bonuses granted by helmed stations (passive benefits remain even while a station is malfunctioning). */
function helmedBonuses(data) {
  const out = { ac: [], fortitude: [], reflex: [], will: [], sensorRange: 0 };
  for (const st of data.stations) {
    const def = Content.stations.get(st.type);
    const row = def?.advancement?.find((r) => r.grade === st.grade);
    if (!row) continue;
    if (st.type === "scanners") out.sensorRange += row.sensorIncrease ?? 0; // scanners always add to sensor range
    if (!st.helmedBy) continue;
    if (row.helmedAC) out.ac.push(mod("item", row.helmedAC, def.name));
    if (row.helmedReflex) out.reflex.push(mod("item", row.helmedReflex, def.name));
    if (row.helmedFortitude) out.fortitude.push(mod("item", row.helmedFortitude, def.name));
    if (row.helmedWill) out.will.push(mod("item", row.helmedWill, def.name));
  }
  return out;
}

/**
 * Piloting DC of the crew member helming the pilot's console: 10 + the pilot's Piloting modifier (starship AC equals it
 * if higher). null while nobody helms the console or the pilot has no Piloting skill.
 */
export function pilotingDC(data) {
  const st = data.stations.find((s) => s.type === "pilot" && s.helmedBy);
  if (!st) return null;
  const crew = fromUuidSync(st.helmedBy);
  const m = crew?.skills?.piloting?.mod ?? crew?.skills?.piloting?.check?.mod;
  return Number.isFinite(m) ? 10 + m : null;
}

/** Effective combat statistics of a starship including helmed bonuses, effects and conditions. */
export function computeShipStats(actor) {
  const data = readStarship(actor);
  const helm = helmedBonuses(data);
  const fx = data.effects ?? [];
  const inop = data.inoperable || data.compromised > 0;
  const penalties = (sel) =>
    inop && ["ac", "perception", "reflex"].includes(sel) ? [mod("status", -4, L("mods.inoperable", "Inoperable"))] : [];
  const offKilter = data.offKilter || hasCondition(fx, "off-kilter");
  const kilter = (sel) =>
    offKilter && ["attack", "reflex", "area-dc"].includes(sel) ? [mod("circumstance", -2, L("mods.offKilter", "Off-Kilter"))] : [];
  const total = (sel, base, extra = []) =>
    stackModifiers([
      ...extra,
      ...penalties(sel),
      ...kilter(sel),
      ...effectModifiers(fx, sel),
      ...(data.customModifiers ?? []).filter((m) => m.selector === sel)
    ]);
  const piloting = pilotingDC(data);
  const acBase = Math.max(data.ac, piloting ?? 0);
  const ac = total("ac", acBase, helm.ac);
  const fort = total("fortitude", data.fort, helm.fortitude);
  const ref = total("reflex", data.reflex, helm.reflex);
  const will = total("will", data.will, helm.will);
  const per = total("perception", data.perception, []);
  const speed = total("speed", data.speed, []);
  const atk = total("attack", 0, []);
  const area = total("area-dc", 0, []);
  return {
    ac: acBase + ac.total,
    pilotingDC: piloting,
    fortitude: data.fort + fort.total,
    reflex: data.reflex + ref.total,
    will: data.will + will.total,
    perception: data.perception + per.total,
    speed: Math.max(0, data.speed + speed.total),
    sensorRange: data.sensorRange + helm.sensorRange,
    attackModifier: atk.total,
    areaDCModifier: area.total,
    offGuard: hasCondition(fx, "off-guard") || inop,
    offKilter,
    inoperable: inop,
    breakdown: { ac: ac.applied, fortitude: fort.applied, reflex: ref.applied, will: will.applied }
  };
}
export const shipDC = (stats, slug) => (slug === "ac" ? stats.ac : 10 + (stats[slug] ?? 0));

/* ------------------------------------------------------------------ rolling helpers (native SF2e pipeline first) */
/**
 * Chat visibility of a secret check. Foundry v14 calls the modes `messageMode` ("gm"), older code and systems still read
 * `rollMode` ("gmroll"): both are passed so a secret roll is never published by accident. A normal roll passes nothing,
 * so it follows the player's own chat roll-mode selector.
 */
export const secretVisibility = (secret) => (secret ? { messageMode: "gm", rollMode: "gmroll" } : {});

function statisticCtor(actor) {
  return actor?.saves?.fortitude?.constructor ?? actor?.skills?.acrobatics?.constructor ?? actor?.perception?.constructor ?? null;
}
function newModifier(data) {
  return new game.pf2e.Modifier(data);
}

/**
 * Roll a check using the native Statistic.check.roll pipeline. Falls back to a plain d20 roll + chat message only if the
 * native pipeline is unavailable for that actor (kept deliberately small).
 * @returns {Promise<{degree:number,total:number,natural:number|null,roll:Roll|null,native:boolean}|null>}
 */
export async function rollNativeCheck({
  statistic,
  dc,
  label,
  extraModifiers = [],
  extraRollOptions = [],
  secret = false,
  actor = null,
  modifierOnly = null,
  skipDialog = true
}) {
  try {
    if (statistic) {
      const stat = extraModifiers.length
        ? statistic.clone({
            modifiers: extraModifiers.map((m) =>
              newModifier({
                slug: m.slug ?? `tsc-${m.label ?? "mod"}`.toLowerCase().replace(/\s+/g, "-"),
                label: m.label ?? L("mods.modifier", "Modifier"),
                modifier: m.value,
                type: m.type ?? "untyped"
              })
            )
          })
        : statistic;
      const roll = await stat.check.roll({
        dc: typeof dc === "number" ? { value: dc } : (dc ?? undefined),
        extraRollOptions: ["starship", ...extraRollOptions],
        createMessage: true,
        skipDialog,
        label,
        ...secretVisibility(secret)
      });
      if (roll)
        return {
          degree: roll.degreeOfSuccess ?? (dc == null ? null : degreeOfSuccess(roll.total, dc?.value ?? dc)),
          total: roll.total,
          natural: roll.dice?.[0]?.total ?? null,
          roll,
          native: true
        };
    }
  } catch (err) {
    log.warn("native check failed, using fallback", err);
  }
  // fallback: plain roll
  const mod_ = modifierOnly ?? 0;
  const roll = await new Roll(`1d20 + ${mod_}`).evaluate();
  const natural = roll.dice[0].total;
  const dcv = typeof dc === "number" ? dc : dc?.value;
  const degree = dcv == null ? null : degreeOfSuccess(roll.total, dcv, natural);
  const degreeText = degree == null ? "" : ` — ${L(`degree.${["criticalFailure", "failure", "success", "criticalSuccess"][degree]}`, "")}`;
  const dcText = dcv == null ? "" : ` (${L("ui.dcShort", "DC")} ${dcv})`;
  await roll.toMessage(
    { speaker: ChatMessage.getSpeaker({ actor }), flavor: `${label ?? L("ui.check", "Check")}${dcText}${degreeText}` },
    { create: true, ...secretVisibility(secret) }
  );
  return { degree, total: roll.total, natural, roll, native: false };
}

/** Flat check (hull integrity). Uses the system's flat check pipeline when possible. */
export async function rollFlatCheck({ actor, dc, label }) {
  const Ctor = statisticCtor(actor);
  if (Ctor) {
    try {
      const stat = new Ctor(actor, {
        slug: "hull-integrity",
        label,
        domains: ["flat-check"],
        modifiers: [],
        check: { type: "flat-check" }
      });
      const roll = await stat.check.roll({
        dc: { value: dc },
        createMessage: true,
        skipDialog: true,
        label,
        extraRollOptions: ["starship", "hull-integrity"]
      });
      if (roll)
        return {
          degree: roll.degreeOfSuccess ?? degreeOfSuccess(roll.total, dc, roll.dice?.[0]?.total),
          total: roll.total,
          roll,
          native: true
        };
    } catch (err) {
      log.warn("native flat check failed", err);
    }
  }
  const roll = await new Roll("1d20").evaluate();
  const degree = degreeOfSuccess(roll.total, dc, roll.total);
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${label} (${L("ui.dcShort", "DC")} ${dc})` });
  return { degree, total: roll.total, roll, native: false };
}

const SHIP_SAVE_SLUGS = ["fortitude", "reflex", "will"];
const skillSlug = (k) =>
  String(k ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
/** Numeric value of a stored ship skill entry (statblock values are FINAL modifiers, not bonuses). */
export function shipSkillValue(skills, slug) {
  for (const [k, v] of Object.entries(skills ?? {})) {
    if (skillSlug(k) !== slug) continue;
    const n = v && typeof v === "object" ? Number(v.base ?? v.mod ?? v.value) : Number(v);
    return v === null || v === "" || !Number.isFinite(n) ? null : n;
  }
  return null;
}
/** Module-owned value of a ship statistic: saves/perception include module effects; skills are statblock finals. */
export function shipModuleValue(actor, slug) {
  if (slug === "perception" || SHIP_SAVE_SLUGS.includes(slug)) return computeShipStats(actor)[slug] ?? 0;
  return shipSkillValue(readStarship(actor).skills, slug);
}
/** Value stored in the actor's own system data (before system effects), used to compute the module delta. */
function nativeSourceBase(actor, slug) {
  const s = actor?._source?.system;
  if (!s) return null;
  const v = slug === "perception" ? s.perception?.mod : SHIP_SAVE_SLUGS.includes(slug) ? s.saves?.[slug]?.value : s.skills?.[slug]?.base;
  return Number.isFinite(v) ? v : null;
}

/**
 * The one adapter for ship saves / Perception / skills.
 *  - NPC actors (native sf2e statistics): the native Statistic is used, so sf2e item effects / rule elements stay
 *    applied; only the delta between the module value and the *source* value is added (0.4.x compared against the
 *    final native modifier and thereby cancelled every system effect on the NPC actor).
 *  - Vehicles (no native save/skill statistics): a Statistic is built from the module value.
 * Returns null when the ship has no such statistic (no fake checks).
 */
export function shipStatistic(actor, slug) {
  const isSave = SHIP_SAVE_SLUGS.includes(slug),
    isSkill = !isSave && slug !== "perception";
  const value = shipModuleValue(actor, slug);
  if (value == null) return null;
  const native = slug === "perception" ? actor.perception : isSave ? actor.saves?.[slug] : actor.skills?.[slug];
  const Ctor = statisticCtor(actor);
  if (native && actor.type === "npc") {
    const base = nativeSourceBase(actor, slug);
    const delta = value - (base ?? native.mod ?? 0);
    return delta
      ? native.clone({
          modifiers: [newModifier({ slug: "tsc-ship-adjust", label: L("mods.starship", "Starship"), modifier: delta, type: "untyped" })]
        })
      : native;
  }
  if (!Ctor) return null;
  const label = isSkill ? L(`skills.${slug}`, slug) : L(`ui.${slug}`, slug.charAt(0).toUpperCase() + slug.slice(1));
  const domains = isSave ? [slug, "saving-throw", "all"] : isSkill ? [slug, "skill-check", "all"] : [slug, "perception", "all"];
  const type = isSave ? "saving-throw" : isSkill ? "skill-check" : "perception-check";
  return new Ctor(actor, {
    slug,
    label,
    domains,
    modifiers: [newModifier({ slug: "base", label: L("mods.starship", "Starship"), modifier: value, type: "untyped" })],
    check: { type }
  });
}

/** Resolve a skill/perception Statistic of a crew member (or of an NPC ship). */
export function crewStatistic(actor, skill) {
  if (!actor) return null;
  if (skill === "perception") return actor.perception ?? null;
  return actor.skills?.[skill] ?? actor.getStatistic?.(skill) ?? null;
}
export function crewClassDC(actor) {
  return (
    actor?.classDC?.dc?.value ??
    actor?.getStatistic?.("class-dc")?.dc?.value ??
    actor?.getStatistic?.("class")?.dc?.value ??
    10 + (actor?.level ?? 1) + 4
  );
}
export function bestSpellStatistic(actor) {
  const entry = actor?.spellcasting?.contents?.find((e) => e.statistic) ?? actor?.spellcasting?.find?.((e) => e.statistic);
  return entry?.statistic ?? null;
}
export { DEGREE };
