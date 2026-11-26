# Migration notes

> Scope: compatibility contract for the native-first rebuild. Existing worlds must continue loading without forced conversion, data deletion or identifier changes.

## 1. Invariants

- Module ID remains `sf2e-tactical-starship-combat`.
- Actor types remain `vehicle`, `npc` and `hazard`; module markers remain under `flags.<MODULE_ID>`.
- Existing flag keys, setting keys, pack IDs, document IDs, UUIDs, public API names, hooks and socket event names remain valid.
- Unknown fields and user-authored values survive migrations.
- No migration writes ordinary actors, compendium source documents or unrelated vehicles/NPCs.
- No migration downgrades `system._migration.version` or replaces a whole flags object when a narrow path update is sufficient.

## 2. Current baseline

- `DATA_VERSION = 3`; version 2 is the previous baseline.
- Migration `0 -> 1` adds missing containers and the version stamp.
- Migration `1 -> 2` folds per-station upgrade IDs into ship-wide upgrade records with `stationId`.
- Migration `2 -> 3` repairs a missing base `sensorRange` from a verified frame or size source.
- `readStarship` can apply migrations in memory; active-GM `migrateAll` persists them and stamps the world setting.
- World repair uses `worldFixVersion = 6`; schema stamping only fills missing module-owned Actor schema stamps.

## 3. Current `DATA_VERSION = 3` migration

The only actor-data migration is a missing base `sensorRange` repair.

### 3.1 Inputs and precedence

1. Existing valid integer `sensorRange` wins unchanged.
2. Player starship without a range uses its verified frame `sensorRange` when available.
3. NPC/ally/neutral/autonomous/living starship without a range uses the official SF2e size baseline:
   - Tiny: 3
   - Small: 4
   - Medium: 4
   - Large: 5
   - Huge: 6
   - Gargantuan: 7
4. If no valid frame/size source exists, leave the value absent/`null` and surface a warning; do not invent 4 or 6.

The scanner station increase remains a derived bonus in `computeShipStats`; migration writes only the missing base value and never double-counts an explicit archive value.

### 3.2 Idempotency

- Migration runs only when `dataVersion < 3`.
- Each Actor update sets `dataVersion: 3` only after the narrow flag update succeeds.
- Re-running on version 3 is a no-op.
- Partial failure leaves the Actor at its prior version; the next active-GM load retries only unfinished Actors.
- In-memory `readStarship` uses the same pure migration step so UI behavior is consistent before persistence.

### 3.3 Provenance and audit

No new Actor provenance field is added. The migration log/history records that the official size/frame baseline was used and how many Actors changed. The authoritative rule source is documented in `docs/rebuild-native-api-map.md` §16.

### 3.4 Safety procedure

1. Add unit tests for explicit value, player frame, every NPC size, invalid size, repeated migration and partial failure.
2. Run migration against cloned fixtures, not the live world.
3. Before any live deployment, back up the world and installed module, then obtain scoped approval for world migration/deployment.
4. Run active-GM migration, verify document counts/values, reload, then verify again.
5. If verification fails, restore the backed-up module/world state; do not delete Actors or flags.

## 4. Setting-only changes

### 4.1 Station reset at initiative

New world setting: `resetStationsOnInitiative`, default `false`.

- No Actor migration is required.
- `false`: preserve `helmedBy`, crew assignments and all other combat data at initiative start.
- `true`: clear only station occupancy at the initiative transition; preserve crew records, weapons, upgrades, effects and unrelated combat flags.
- Repeated start/reload uses the same setting and does not accumulate cleanup side effects.

### 4.2 Native targets

No migration. Targets stay in Foundry's ephemeral `game.user.targets`/Token state. Action payloads may add `targetUUIDs`; legacy `targetKey` remains accepted as a fallback.

## 5. Public contract compatibility

| Contract                                            | Change policy                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `game.modules.get(MODULE_ID).api`                   | Keep existing names/signatures; additive optional parameters only.                                              |
| Hook names in `HOOK_EVENTS`                         | Keep existing names; add emissions only where the declared contract was already present.                        |
| Socket event `module.sf2e-tactical-starship-combat` | Keep event and request/response kinds; validate new target list on the GM side.                                 |
| Settings                                            | Keep every existing key registered; add new keys with safe defaults.                                            |
| Actor/Item/Compendium IDs                           | Never regenerate or replace.                                                                                    |
| Templates/CSS selectors                             | Keep stable selectors where integrations may depend on them; add compactness classes without removing controls. |
| Chat flags/receipts                                 | Keep receipt keys and correlation semantics; reject duplicate application.                                      |

## 6. Compatibility test matrix

| Scenario                                              | Required result                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| Version 0/1/2 fixture                                 | Migrates to current version without losing unknown fields.        |
| Version 3 fixture                                     | No writes on repeated load.                                       |
| Explicit NPC `sensorRange`                            | Unchanged.                                                        |
| Missing player range with valid frame                 | Uses frame base once.                                             |
| Missing NPC range for each official size              | Uses official baseline once.                                      |
| Missing range with invalid/unique size                | Remains absent/`null`; warning only.                              |
| Scanner station present                               | Derived increase applies once after migration.                    |
| Station reset OFF/ON/reload                           | Only intended occupancy fields change.                            |
| Old action payload with `targetKey`                   | Still works.                                                      |
| New action payload with duplicate/stale `targetUUIDs` | Deduped/invalid targets removed before execution.                 |
| Toolbelt absent/present/disabled                      | Core module behavior remains valid.                               |
| PF2e + Anachronism                                    | Uses `pf2e` flag namespace and verified Anachronism capabilities. |

## 7. Rollback and release gates

- Migration code must be reversible by restoring the pre-change module/world backup; it does not provide automatic data rollback.
- Do not tag, publish, merge or push as part of migration.
- A live world is not migrated merely because local tests pass. Deployment, reload and world writes require scoped user approval.
- Full automated checks, pack/build validation and authorized live reload/persistence checks are required before packaging.
