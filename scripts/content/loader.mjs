import { MODULE_ID } from "../constants.mjs";
import { log } from "../utils/logging.mjs";
import { versionedUrl } from "./content-i18n.mjs";
import { upgradeEntries } from "../engine/upgrades.mjs";
import { validateActions, validateHazards, validateStarships, validateStations, validateWeapons } from "../engine/validation.mjs";

/** In-memory content registry. Source: data/*.json (shipped) merged with GM custom content (world setting). */
export const Content = {
  loaded: false,
  stations: new Map(),
  actions: new Map(),
  frames: new Map(),
  weapons: new Map(),
  upgrades: new Map(),
  ships: [],
  hazards: [],
  drones: [],
  expansionBays: [],
  index: null,
  problems: []
};

const base = () => `modules/${MODULE_ID}/data`;
async function getJSON(path) {
  const res = await fetch(versionedUrl(`${base()}/${path}`), { cache: "no-cache" }); // never a stale catalog after an update
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export async function loadContent() {
  Content.problems = [];
  try {
    const index = await getJSON("index.json");
    Content.index = index;
    const [stations, actions, frames, weapons, upgrades, misc, hazards] = await Promise.all([
      getJSON(index.stations),
      getJSON(index.actions),
      getJSON(index.frames),
      getJSON(index.weapons),
      getJSON(index.upgrades),
      getJSON(index.misc),
      getJSON(index.hazards)
    ]);
    Content.stations = new Map(stations.stations.map((s) => [s.id, s]));
    Content.actions = new Map(actions.actions.map((a) => [a.id, a]));
    Content.frames = new Map(frames.frames.map((f) => [f.id, f]));
    Content.weapons = new Map(weapons.weapons.map((w) => [w.id, w]));
    Content.upgrades = new Map(upgrades.upgrades.map((u) => [u.id, u]));
    Content.drones = misc.drones ?? [];
    Content.expansionBays = misc.expansionBays ?? [];
    Content.hazards = hazards.hazards ?? [];
    const ships = [];
    for (const f of index.starships) {
      const d = await getJSON(f);
      for (const s of d.ships) ships.push({ ...s, faction: d.faction });
    }
    Content.ships = ships;
    // custom content from the world setting overrides / extends shipped content
    const custom = game.settings.get(MODULE_ID, "customContent") ?? {};
    for (const a of custom.actions ?? []) Content.actions.set(a.id, { ...a, custom: true });
    for (const w of custom.weapons ?? []) Content.weapons.set(w.id, { ...w, custom: true });
    for (const s of custom.stations ?? []) Content.stations.set(s.id, { ...s, custom: true });
    for (const u of custom.upgrades ?? []) Content.upgrades.set(u.id, { ...u, custom: true });
    Content.loaded = true;
    const reports = [
      validateStarships(Content.ships),
      validateHazards(Content.hazards),
      validateStations([...Content.stations.values()]),
      validateActions([...Content.actions.values()], [...Content.stations.keys(), "npc"]),
      validateWeapons([...Content.weapons.values()])
    ];
    for (const r of reports) Content.problems.push(...r.errors.map((e) => `error: ${e}`));
    if (Content.problems.length) log.warn("content problems", Content.problems);
    log.info(`content loaded: ${Content.ships.length} starships, ${Content.hazards.length} hazards, ${Content.actions.size} actions`);
  } catch (err) {
    log.error("failed to load content", err);
    ui.notifications?.error(game.i18n.localize("SF2eTSC.errors.contentLoad"));
  }
  return Content;
}

/** installable upgrade entries (one per variant), cached per catalog Map (custom content included). */
let upgradeCache = { src: null, size: -1, list: [] };
export function upgradeCatalog() {
  if (upgradeCache.src !== Content.upgrades || upgradeCache.size !== Content.upgrades.size)
    upgradeCache = { src: Content.upgrades, size: Content.upgrades.size, list: upgradeEntries([...Content.upgrades.values()]) };
  return upgradeCache.list;
}

export const getAction = (id) => Content.actions.get(id) ?? null;
export function actionsForStation(stationType, grade, gradeIndexFn) {
  const out = [];
  for (const a of Content.actions.values()) {
    if (a.npcOnly) continue;
    if (a.station !== stationType && a.station !== "any") continue;
    if (a.minGrade && gradeIndexFn(grade) < gradeIndexFn(a.minGrade)) continue;
    out.push(a);
  }
  return out;
}
