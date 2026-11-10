// node tools/validate-content.mjs  — validates shipped content (starships, hazards, stations, actions, weapons, frames)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStarships, validateHazards, validateStations, validateActions, validateWeapons } from "../scripts/engine/validation.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
export function loadAll() {
  const index = read("index.json");
  const ships = index.starships.flatMap((f) => {
    const d = read(f);
    return d.ships.map((s) => ({ ...s, faction: d.faction }));
  });
  return {
    index,
    ships,
    hazards: read(index.hazards).hazards,
    stations: read(index.stations).stations,
    actions: read(index.actions).actions,
    weapons: read(index.weapons).weapons,
    frames: read(index.frames).frames,
    upgrades: read(index.upgrades).upgrades
  };
}
export function validateAll() {
  const c = loadAll();
  const results = {
    "validate-starships": validateStarships(c.ships),
    "validate-hazards": validateHazards(c.hazards),
    "validate-stations": validateStations(c.stations),
    "validate-actions": validateActions(c.actions, c.stations.map((s) => s.id).concat("npc")),
    "validate-weapons": validateWeapons(c.weapons)
  };
  // references: ship stations must be known station types; action ids referenced by frames etc. must exist
  const refs = { errors: [], warnings: [] };
  const stationIds = new Set(c.stations.map((s) => s.id));
  for (const s of c.ships)
    for (const st of s.stations ?? []) if (!stationIds.has(st.type)) refs.errors.push(`${s.id}: unknown station type ${st.type}`);
  for (const f of c.frames) {
    if (f.table.length !== 20) refs.errors.push(`frame ${f.id}: expected 20 table rows`);
    for (const d of f.defaultStations) if (!stationIds.has(d.type)) refs.errors.push(`frame ${f.id}: unknown default station ${d.type}`);
  }
  const dupUp = new Set();
  for (const u of c.upgrades) {
    if (dupUp.has(u.id)) refs.errors.push(`duplicate upgrade ${u.id}`);
    dupUp.add(u.id);
  }
  // 0.9.1: upgrade catalog — station from the Usage line, escape pods at ship level, unique variant keys, levels, pages
  const ST = new Set(["pilot", "generator", "gunnery", "scanners", "magic-conduit", "drone-console"]);
  const keys = new Set();
  for (const u of c.upgrades) {
    const err = (m) => refs.errors.push(`upgrade ${u.id}: ${m}`);
    if (u.slot === "station" ? !ST.has(u.station) : u.slot !== "escape-pods" || u.station !== null)
      err(`bad station/slot ${u.station}/${u.slot}`);
    if (!Number.isInteger(u.level) || !(u.source?.page > 0) || !Array.isArray(u.text) || !u.text.length || !u.usage)
      err("missing level/page/text/usage");
    for (const v of u.variants?.length ? u.variants : [{ grade: null }]) {
      const k = v.grade ? `${u.id}:${v.grade}` : u.id;
      if (keys.has(k)) err(`duplicate key ${k}`);
      keys.add(k);
      if (v.grade && !(v.level >= u.level && v.page > 0 && v.name)) err(`variant ${k} incomplete`);
    }
    for (const a of [...(u.activations ?? []), ...(u.variants ?? []).flatMap((v) => v.activations ?? [])])
      if (!a.name || !(a.details ?? []).every((d) => d && typeof d.text === "string")) err(`activation ${a.name} malformed`);
  }
  results["validate-references"] = refs;
  return {
    results,
    counts: {
      ships: c.ships.length,
      hazards: c.hazards.length,
      actions: c.actions.length,
      weapons: c.weapons.length,
      upgrades: c.upgrades.length,
      frames: c.frames.length
    }
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { results, counts } = validateAll();
  let bad = 0;
  for (const [name, r] of Object.entries(results)) {
    console.log(`${name}: ${r.errors.length} errors, ${r.warnings.length} warnings`);
    r.errors.forEach((e) => console.log("  ERROR ", e));
    r.warnings.slice(0, 40).forEach((w) => console.log("  warn  ", w));
    bad += r.errors.length;
  }
  console.log(JSON.stringify(counts));
  process.exit(bad ? 1 : 0);
}
