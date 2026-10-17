import { DATA_VERSION } from "../constants.mjs";
import { foldStationUpgrades } from "./upgrades.mjs";

/** Ordered migration steps keyed by the version they migrate FROM. Each returns a new object. */
export const MIGRATIONS = {
  // 0 -> 1: legacy/unversioned data gets the dataVersion stamp and missing containers
  0: (d) => ({
    ...d,
    dataVersion: 1,
    stations: d.stations ?? [],
    crew: d.crew ?? [],
    weapons: d.weapons ?? [],
    upgrades: d.upgrades ?? [],
    expansionBays: d.expansionBays ?? [],
    effects: d.effects ?? []
  }),
  // 1 -> 2 (0.9.1): per-station upgrade ids become records of the ship-wide upgrades list with a stationId
  1: (d) => ({ ...foldStationUpgrades(d), dataVersion: 2 })
};

export function needsMigration(data) {
  return (data?.dataVersion ?? 0) < DATA_VERSION;
}

export function migrate(data, target = DATA_VERSION, steps = MIGRATIONS) {
  let cur = { ...(data ?? {}) };
  let v = cur.dataVersion ?? 0;
  const log = [];
  while (v < target) {
    const step = steps[v];
    if (!step) throw new Error(`No migration from dataVersion ${v}`);
    cur = step(cur);
    log.push(`${v}->${cur.dataVersion ?? v + 1}`);
    v = cur.dataVersion ?? v + 1;
  }
  return { data: cur, log };
}
