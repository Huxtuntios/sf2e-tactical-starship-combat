import { rollTypedDamage, typedDamageFormula } from "./typed-damage.mjs";
/**
 * Rolls from the starship sheet (0.5.0): checks, saves, skills, attacks with MAP and damage.
 *
 * Design (see docs/audit-0.5.0.md):
 *  - checks/saves/skills go through the ONE adapter `shipStatistic` (native sf2e Statistic when the actor has it), so
 *    sf2e modifiers, roll options, degree of success and the chat card are the system's own;
 *  - attacks are NOT a parallel engine: the sheet only builds rows and sends `declareAttack` with `sheetRoll: true`;
 *    validation, targeting (Sensor Map), MAP and the result card are the existing attack-card / action-engine code;
 *  - nothing here spends, counts or blocks actions or reactions.
 */
import { readStarship } from "../starship/starship-state.mjs";
import { computeShipStats, shipStatistic, rollNativeCheck, shipSkillValue } from "../starship/stats.mjs";
import { resolveWeapon, damageFormula, sheetAttackBonus } from "../actions/strike.mjs";
import { stationRowFor } from "../starship/station-rows.mjs";
import { slugifyName } from "../actions/npc-inline.mjs";
import { MAP_BASE } from "../engine/map.mjs";
import { T, fromUuidSync_ } from "../utils/foundry.mjs";
import { checkChatContent } from "../content/inline-checks.mjs";
import { ct } from "../content/content-i18n.mjs";
import { traitsText, damageTypeLabel, zonesText } from "../utils/labels.mjs";

export const SHIP_SAVES = Object.freeze(["fortitude", "reflex", "will"]);
const FLAG_KEY = { perception: "perception", fortitude: "fort", reflex: "reflex", will: "will" };
const slugOf = (k) =>
  String(k ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const numeric = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const has = (k) => !!globalThis.game?.i18n?.has?.(k);

/**
 * Pure: which checks the ship actually has. Perception/saves only when the statblock stores a number; skills only
 * for stored skill entries (statblock FINAL modifiers — never added to anything else). No fake checks.
 */
export function shipCheckList(data, stats) {
  const out = [];
  if (numeric(data?.[FLAG_KEY.perception])) out.push({ slug: "perception", kind: "perception", mod: stats.perception });
  for (const s of SHIP_SAVES) if (numeric(data?.[FLAG_KEY[s]])) out.push({ slug: s, kind: "save", mod: stats[s] });
  const seen = new Set();
  for (const k of Object.keys(data?.skills ?? {})) {
    const slug = slugOf(k);
    if (!slug || seen.has(slug) || slug === "perception" || SHIP_SAVES.includes(slug)) continue;
    const v = shipSkillValue(data.skills, slug);
    if (v == null) continue;
    seen.add(slug);
    out.push({ slug, kind: "skill", mod: v });
  }
  return out;
}

export function skillLabel(slug) {
  return has(`SF2eTSC.skills.${slug}`) ? T(`SF2eTSC.skills.${slug}`) : slug.replace(/-/g, " ");
}
function checkLabel(row) {
  return row.kind === "skill" ? skillLabel(row.slug) : T(`SF2eTSC.ui.${row.slug}`);
}

/** Rows for the sheet. The shown modifier is the final one of the native Statistic when available. */
export function shipCheckRows(actor) {
  const data = readStarship(actor),
    stats = computeShipStats(actor);
  return shipCheckList(data, stats).map((r) => {
    let mod = r.mod;
    try {
      const st = shipStatistic(actor, r.slug);
      const m = st?.check?.mod ?? st?.mod;
      if (Number.isFinite(m)) mod = m;
    } catch {
      /* keep module value */
    }
    return { ...r, mod, modText: signed(mod), label: checkLabel(r), kindLabel: T(`SF2eTSC.rolls.kind.${r.kind}`) };
  });
}

/**
 * Pure: the four statistic cells of the Overview grid (Perception + the three saves). A cell is rollable when the ship
 * really has that statistic (no fake checks) and the user may roll for the ship.
 */
export function statCells(rows, { canRoll = true } = {}) {
  const bySlug = new Map((rows ?? []).map((r) => [r.slug, r]));
  return ["perception", ...SHIP_SAVES].map((slug) => {
    const r = bySlug.get(slug);
    return { slug, label: T(`SF2eTSC.ui.${slug}`), modText: r?.modText ?? "—", rollable: !!r && canRoll };
  });
}

/** The three Fort / Ref / Will buttons next to the Piloting DC. */
export function pilotingSaveButtons(actor) {
  const dc = computeShipStats(actor).pilotingDC;
  return SHIP_SAVES.map((slug) => ({
    slug,
    short: T(`SF2eTSC.ui.saveShort.${slug}`),
    title: T("SF2eTSC.rolls.pilotingSave", { save: T(`SF2eTSC.ui.${slug}`), dc: Number.isFinite(dc) ? dc : "—" })
  }));
}

/** Checks list of the sheet: skill checks only (Perception and the saves live in the stat grid). */
export const skillCheckRows = (rows) => (rows ?? []).filter((r) => r.kind === "skill");

/**
 * Post a save check against the ship's Piloting DC to the chat (@Check enricher: whoever clicks it rolls their own
 * save). The DC is computed from the helming pilot's Piloting skill; without a pilot nothing is posted.
 */
export async function postPilotingSave(actor, save) {
  if (!SHIP_SAVES.includes(save)) throw new Error(T("SF2eTSC.rolls.noSuchCheck", { slug: String(save) }));
  const dc = computeShipStats(actor).pilotingDC;
  if (!Number.isFinite(dc)) throw new Error(T("SF2eTSC.ui.noPilot"));
  const label = T("SF2eTSC.rolls.pilotingSaveLabel", { save: T(`SF2eTSC.ui.${save}`), dc });
  return ChatMessage.create({
    content: checkChatContent(`${save}|dc:${dc}|showDC:all`, label, actor.name),
    speaker: ChatMessage.getSpeaker({ actor })
  });
}

/** Roll a ship check / save / skill. dc is optional; without it no degree is computed or shown. */
export async function rollShipCheck(actor, slug, { dc = null } = {}) {
  const row = shipCheckRows(actor).find((r) => r.slug === slug);
  if (!row) throw new Error(T("SF2eTSC.rolls.noSuchCheck", { slug: String(slug) }));
  const n = Number(dc);
  const dcv = dc !== null && dc !== "" && Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  const label = T("SF2eTSC.rolls.checkLabel", { ship: actor.name, kind: row.kindLabel, name: row.label });
  return rollNativeCheck({
    statistic: shipStatistic(actor, slug),
    dc: dcv,
    label,
    actor,
    modifierOnly: row.mod,
    extraRollOptions: ["starship", `starship-check:${slug}`]
  });
}

/* ------------------------------------------------------------------------------------------------------- attacks */
export function weaponStation(data, w) {
  return data.stations.find((s) => s.weaponId === w.id) ?? data.stations.find((s) => s.id === w.stationId) ?? null;
}
function mapLabels(traits) {
  const agile = (traits ?? []).some((t) => String(t).toLowerCase() === "agile");
  const p = agile ? MAP_BASE.agile : MAP_BASE.normal;
  return { map1: signed(p.map1), map2: signed(p.map2) };
}

/**
 * Pure: one button per MAP step (1st / 2nd / 3rd+ attack) showing the final attack modifier and the penalty.
 * `bonus` null (unknown) still yields buttons, then only the penalty is shown.
 */
export function attackButtons(bonus, traits) {
  const agile = (traits ?? []).some((t) => String(t).toLowerCase() === "agile");
  const p = agile ? MAP_BASE.agile : MAP_BASE.normal;
  const keys = ["SF2eTSC.rolls.mapFirst", "SF2eTSC.rolls.mapSecond", "SF2eTSC.rolls.mapThird"];
  return [0, p.map1, p.map2].map((pen, i) => ({
    choice: String(i),
    penaltyValue: pen,
    penalty: pen ? signed(pen) : "",
    total: Number.isFinite(bonus) ? signed(bonus + pen) : pen ? signed(pen) : "—",
    label: has(keys[i]) ? T(keys[i]) : keys[i].split(".").pop()
  }));
}

/** Attack rows: installed player weapons (through their battle station and its crew) and NPC statblock Strikes. */
export function sheetAttackRows(actor) {
  const data = readStarship(actor),
    stats = computeShipStats(actor);
  const rows = [];
  for (const w of data.weapons ?? []) {
    const station = weaponStation(data, w);
    const ctx = { options: { weaponId: w.id }, data, station, stationRow: station ? stationRowFor(station) : null, stats };
    const weapon = resolveWeapon(ctx);
    if (!weapon) continue;
    const crew = station?.helmedBy ? fromUuidSync_(station.helmedBy) : null;
    const bonus = crew ? sheetAttackBonus(crew, weapon) : null;
    rows.push({
      key: `w:${w.id}`,
      kind: "weapon",
      weaponId: w.id,
      actionId: "strike",
      stationId: station?.id ?? null,
      crewUuid: station?.helmedBy ?? null,
      crewName: crew?.name ?? null,
      name: ct(weapon.name),
      bonusText: bonus == null ? "—" : signed(bonus),
      typeLabel: T("SF2eTSC.rolls.ranged"),
      rangeText: zonesText(`${weapon.range} zones`),
      traitsText: traitsText(weapon.traits),
      damageText: `${damageFormula(ctx, weapon, false)} ${damageTypeLabel(weapon.damageType)}`.trim(),
      ...mapLabels(weapon.traits),
      attackButtons: attackButtons(bonus, weapon.traits),
      enabled: !!station && !!station.helmedBy && !station.malfunctioning,
      reason: !station
        ? T("SF2eTSC.rolls.noStation")
        : !station.helmedBy
          ? T("SF2eTSC.rolls.noGunner")
          : station.malfunctioning
            ? T("SF2eTSC.rolls.malfunctioning")
            : ""
    });
  }
  (data.strikes ?? []).forEach((s, index) => {
    if (!s || typeof s !== "object" || !s.name) return;
    const ctx = { options: { npcStrike: s }, data, stats };
    const weapon = resolveWeapon(ctx);
    const actionId = `npc-strike:${slugifyName(s.name)}`;
    const station = data.stations.find((st) => (st.actions ?? []).includes(s.name) || (st.actions ?? []).includes(actionId)) ?? null;
    rows.push({
      key: `s:${index}`,
      kind: "strike",
      strikeIndex: index,
      actionId,
      stationId: station?.id ?? null,
      crewUuid: null,
      crewName: null,
      name: ct(s.name),
      bonusText: Number.isFinite(s.attack) ? signed(s.attack) : "—",
      typeLabel: T(s.kind === "melee" ? "SF2eTSC.rolls.melee" : "SF2eTSC.rolls.ranged"),
      rangeText: zonesText(`${weapon.range} zones`),
      traitsText: traitsText(s.traits),
      damageText: (weapon.damageParts ?? []).map((p) => `${p.formula} ${damageTypeLabel(p.type)}`.trim()).join(" + "),
      ...mapLabels(s.traits),
      attackButtons: attackButtons(Number.isFinite(s.attack) ? s.attack : null, s.traits),
      enabled: Number.isFinite(s.attack),
      reason: Number.isFinite(s.attack) ? "" : T("SF2eTSC.rolls.noAttackBonus")
    });
  });
  return rows;
}

/** Pure: the payload the sheet sends to the GM (validated again there). */
export function sheetAttackRequest(actor, row, mapChoice = "0") {
  return {
    shipUuid: actor.uuid,
    actionId: row.actionId,
    crewUuid: row.crewUuid ?? null,
    stationId: row.stationId ?? null,
    options: {
      ...(row.weaponId ? { weaponId: row.weaponId } : {}),
      sheetRoll: true,
      mapChoice: ["auto", "0", "1", "2"].includes(String(mapChoice)) ? String(mapChoice) : "auto"
    }
  };
}

/** Damage formula of a sheet row (normal or critical), using the same code as the strike resolution. */
export function sheetDamageFormula(actor, key, crit = false) {
  const data = readStarship(actor),
    stats = computeShipStats(actor);
  let ctx;
  if (String(key).startsWith("s:")) {
    const s = data.strikes?.[Number(String(key).slice(2))];
    if (!s) return null;
    ctx = { options: { npcStrike: s }, data, stats };
  } else {
    const w = data.weapons.find((x) => `w:${x.id}` === key);
    if (!w) return null;
    const station = weaponStation(data, w);
    ctx = { options: { weaponId: w.id }, data, station, stationRow: station ? stationRowFor(station) : null, stats };
  }
  const weapon = resolveWeapon(ctx);
  if (!weapon) return null;
  return { formula: damageFormula(ctx, weapon, crit), weapon };
}

/** Free-standing damage roll from the sheet: only rolls and posts; never applies damage to anyone. */
export async function rollSheetDamage(actor, key, { crit = false } = {}) {
  const r = sheetDamageFormula(actor, key, crit);
  if (!r) throw new Error(T("SF2eTSC.rolls.noSuchWeapon"));
  const parts = r.weapon.npc
    ? r.weapon.damageParts.map((part) => ({ ...part, formula: crit ? `(${part.formula})*2` : part.formula }))
    : [{ formula: r.formula, type: r.weapon.damageType }];
  const types = (r.weapon.damageParts?.map((p) => p.type) ?? [r.weapon.damageType]).map(damageTypeLabel).join(" + ");
  const roll = await rollTypedDamage(typedDamageFormula(parts), {
    actor,
    flavor: T("SF2eTSC.rolls.damageFlavor", {
      ship: actor.name,
      weapon: ct(r.weapon.name),
      type: types,
      crit: crit ? ` (${T("SF2eTSC.rolls.critical")})` : ""
    })
  });
  return { formula: r.formula, total: roll.total };
}
