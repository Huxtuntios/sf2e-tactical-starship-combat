import { Content } from "../content/loader.mjs";
/** Advancement row (bonuses per grade) of an installed station. */
export function stationRowFor(station) {
  const def = Content.stations.get(station.type);
  return def?.advancement?.find((r) => r.grade === station.grade) ?? station.passive ?? null;
}
