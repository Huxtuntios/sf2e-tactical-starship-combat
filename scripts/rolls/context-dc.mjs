/** Contextual DCs belong to the station's current operator, not automatically to the pilot. */
import { T } from "../utils/foundry.mjs";
import { computeShipStats } from "../starship/stats.mjs";
const numeric = (n) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);
export function contextDCs(crew, ship = null) {
  const values = {};
  for (const [slug, stat] of Object.entries(crew?.skills ?? {})) {
    const value = numeric(stat.dc?.value) ?? (Number.isFinite(stat.mod) ? 10 + stat.mod : null);
    if (value !== null) values[slug] = value;
  }
  values.class = numeric(crew?.classDC?.dc?.value) ?? numeric(crew?.getStatistic?.("class-dc")?.dc?.value);
  const entries = crew?.spellcasting?.contents ?? [];
  const spellDCs = [...new Set(entries.map((entry) => numeric(entry.statistic?.dc?.value)).filter((n) => n !== null))];
  // Multiple spell traditions/entries may have different DCs: do not silently choose one.
  values.spell = spellDCs.length === 1 ? spellDCs[0] : null;
  if (ship) {
    const fort = computeShipStats(ship).fortitude;
    if (typeof fort === "number" && Number.isFinite(fort)) values.shipFortitude = 10 + fort;
  }
  for (const slug of ["mechanic", "solarian", "mystic", "technomancer", "witchwarper"]) {
    values[slug] = numeric(crew?.classDCs?.[slug]?.dc?.value) ?? numeric(crew?.getStatistic?.(slug)?.dc?.value);
  }
  return values;
}
const SOURCES = [
  ["crafting", /your Crafting DC|ваш(?:его|ему|ей|им) КС Ремесла/giu],
  ["piloting", /your Piloting DC|ваш(?:его|ему|ей|им) КС Пилотирования/giu],
  ["computers", /your Computers DC|ваш(?:его|ему|ей|им) КС Компьютеров/giu],
  ["mechanic", /your mechanic (?:class )?DC|ваш(?:его|ему|ей|им) КС механика/giu],
  ["solarian", /your solarian (?:class )?DC|ваш(?:его|ему|ей|им) КС солариана/giu],
  ["class", /your class DC|ваш(?:его|ему|ей|им) КС класса/giu],
  ["spell", /your spell DC|ваш(?:его|ему|ей|им) КС заклинаний/giu],
  ["shipFortitude", /your starship[’']s Fortitude DC|КС Стойкости вашего звездолёта/giu]
];
/** Adds the actual DC, and a save link only where the clause explicitly calls for that save. */
export function linkContextDCs(text, { crew = null, ship = null } = {}) {
  const values = contextDCs(crew, ship);
  const protectedTokens = [];
  let result = String(text ?? "").replace(
    /@(?:Check|Damage|UUID|TscCondition)\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?|<[^>]*>/g,
    (token) => {
      protectedTokens.push(token);
      return `\uE000${protectedTokens.length - 1}\uE001`;
    }
  );
  for (const [key, pattern] of SOURCES) {
    const dc = values[key];
    if (dc == null) continue;
    result = result.replace(pattern, (label, offset, source) => {
      // Never reinterpret target skill DCs, existing enrichers, or another sentence's saving throw.
      const prefix = source
        .slice(0, offset)
        .split(/[.!?;\n]/)
        .at(-1)
        .slice(-200);
      const save =
        /(?:basic )?(Fortitude|Reflex|Will) save\s+(?:against|vs\.?)\s*$/i.exec(prefix) ??
        /(?:прост\p{L}*\s+)?спасброс\p{L}*\s+(Стойкости|Рефлекса|Воли)[^]*против\s*$/iu.exec(prefix);
      const slug = save
        ? { fortitude: "fortitude", reflex: "reflex", will: "will", стойкости: "fortitude", рефлекса: "reflex", воли: "will" }[
            save[1].toLowerCase()
          ]
        : null;
      const display = `${label} (${dc})`;
      return slug ? `@Check[${slug}|dc:${dc}${/basic|прост/iu.test(save[0]) ? "|basic" : ""}]{${display}}` : display;
    });
  }
  return result.replace(/\uE000(\d+)\uE001/g, (_, index) => protectedTokens[Number(index)]);
}
export function stationDCRows(crew) {
  const values = contextDCs(crew);
  const rows = Object.entries(values)
    .filter(([, value]) => value !== null)
    .map(([slug, value]) => ({
      slug,
      value,
      label:
        slug === "class" || slug === "spell"
          ? T(`SF2eTSC.rolls.${slug}DC`)
          : ["mechanic", "solarian", "mystic", "technomancer", "witchwarper"].includes(slug)
            ? T(`SF2eTSC.classes.${slug}`)
            : (crew?.skills?.[slug]?.label ?? (game.i18n.has(`SF2eTSC.skills.${slug}`) ? T(`SF2eTSC.skills.${slug}`) : slug))
    }));
  if (values.spell === null)
    for (const entry of crew?.spellcasting?.contents ?? []) {
      const value = numeric(entry.statistic?.dc?.value);
      if (value !== null) rows.push({ slug: "spell", label: `${T("SF2eTSC.rolls.spellDC")} (${entry.name})`, value });
    }
  return rows;
}
