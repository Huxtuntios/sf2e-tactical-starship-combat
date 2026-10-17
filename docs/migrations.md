# Data versioning and migrations

Every starship flag and the combat state carry `dataVersion` (current **1**). `scripts/engine/migration.mjs` holds ordered, pure steps keyed by the version they migrate _from_
(`MIGRATIONS[0]` = unversioned → 1). On `ready` the active GM migrates all starships once (`dataVersion` world setting); reads of un-migrated data are migrated in memory so nothing breaks before that.
To add a step: bump `DATA_VERSION` in `constants.mjs`, add `MIGRATIONS[n]`, add a unit test (`tests/unit/engine.test.mjs`), document it here.

## Data version 2 (0.9.1)

- `stations[].upgrades` (catalog ids) are folded into the ship-wide `upgrades[]` list as records with `stationId`; the station list is emptied. Nothing is deleted.
- Records of older versions without `stationId` are assigned to a station when exactly one station of the type given by the catalog's Usage line exists (this also corrects old wrong mappings, e.g. Gravity Toggle → generator). Escape pods stay at ship level; ambiguous records stay unassigned and are listed on the sheet.
- The fold is idempotent and also runs on every read, so un-migrated actors display correctly before the GM migration runs.
