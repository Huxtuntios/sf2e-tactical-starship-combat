import { DATA_VERSION, FLAGS, MODULE_ID } from "../constants.mjs";
import { foldStationUpgrades } from "./upgrades.mjs";
import { resolveBaseSensorRange } from "./sensor-range.mjs";

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
  1: (d) => ({ ...foldStationUpgrades(d), dataVersion: 2 }),
  2: (d, context = {}) => {
    const resolved = resolveBaseSensorRange(d, context.frame);
    const next = { ...d, dataVersion: 3 };
    if (d.sensorRange == null && resolved.value != null) next.sensorRange = resolved.value;
    if (d.sensorRange == null) {
      context.audit?.push({
        from: 2,
        to: 3,
        field: "sensorRange",
        source: resolved.source,
        value: resolved.value,
        ...(resolved.warning ? { warning: resolved.warning } : {})
      });
    }
    return next;
  }
};

export function needsMigration(data) {
  return (data?.dataVersion ?? 0) < DATA_VERSION;
}

export function migrate(data, target = DATA_VERSION, steps = MIGRATIONS, context = {}) {
  let cur = { ...(data ?? {}) };
  let v = cur.dataVersion ?? 0;
  const log = [];
  const audit = context.audit ?? [];
  const stepContext = { ...context, audit };
  while (v < target) {
    const step = steps[v];
    if (!step) throw new Error(`No migration from dataVersion ${v}`);
    cur = step(cur, stepContext);
    log.push(`${v}->${cur.dataVersion ?? v + 1}`);
    v = cur.dataVersion ?? v + 1;
  }
  return { data: cur, log, audit };
}

/** Persist completed migrations only; a failed Actor leaves the world stamp untouched for retry. */
export async function migrateStarships(actors, { getVersion, setVersion, frameFor = () => null } = {}) {
  const worldVersion = Number((await getVersion()) ?? 0);
  const entries = [];
  let unchanged = 0;
  const path = `flags.${MODULE_ID}.${FLAGS.STARSHIP}`;
  for (const actor of actors) {
    const raw = actor.flags?.[MODULE_ID]?.[FLAGS.STARSHIP];
    if (!needsMigration(raw)) {
      unchanged++;
      continue;
    }
    const { data, audit } = migrate(raw, DATA_VERSION, MIGRATIONS, { frame: frameFor(raw) });
    const rangeAudit = audit.find((entry) => entry.field === "sensorRange");
    const updates = raw.dataVersion === 2 ? {} : { [path]: data };
    if (raw.dataVersion === 2 && rangeAudit?.value != null) updates[`${path}.sensorRange`] = rangeAudit.value;
    updates[`${path}.dataVersion`] = DATA_VERSION;
    await actor.update(updates);
    entries.push({
      actorId: actor.id,
      source: rangeAudit?.source ?? "explicit",
      value: rangeAudit?.value ?? data.sensorRange ?? null,
      warning: rangeAudit?.warning ?? null
    });
  }
  if (worldVersion < DATA_VERSION) await setVersion(DATA_VERSION);
  return { migrated: entries.length, unchanged, entries };
}
