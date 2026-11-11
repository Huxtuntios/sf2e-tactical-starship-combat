# Data versioning and migrations

Starship flags and newly created combat state carry `dataVersion` (current **2**, `scripts/constants.mjs`). `scripts/engine/migration.mjs` holds ordered, pure steps keyed by the version they migrate _from_: `MIGRATIONS[0]` adds the version-1 stamp and missing station, crew, weapon, upgrade, expansion-bay and effect containers; `MIGRATIONS[1]` folds station upgrades into version 2.

On `ready` the active GM migrates legacy starship flags once per world `dataVersion` setting (`scripts/main.mjs`). `readStarship` also migrates in memory before normalization (`scripts/starship/starship-state.mjs`); this is not a world-wide Contact/Combat flag migration. Back up older worlds and verify on a disposable copy; offline tests do not certify live migration.

To add a step: bump `DATA_VERSION` in `scripts/constants.mjs`, add `MIGRATIONS[n]`, add a unit test (`tests/unit/engine.test.mjs`), document it here.

## Data version 2 (0.9.1)

- `stations[].upgrades` (catalog ids) are folded into the ship-wide `upgrades[]` list as records with `stationId`; the station list is emptied. Nothing is deleted.
- Records of older versions without `stationId` are assigned to a station when exactly one station of the type given by the catalog's Usage line exists (this also corrects old wrong mappings, e.g. Gravity Toggle → generator). Escape pods stay at ship level; ambiguous records stay unassigned and are listed on the sheet.
- The fold is idempotent and also runs on every read, so un-migrated actors display correctly before the GM migration runs.
