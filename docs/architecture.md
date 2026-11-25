# Native-first rebuild architecture

> Status: implementation contract for `rewrite/native-first-rebuild`, baseline module `1.3.1` at `fa3bb679ae908c08ce85483a76aa1726b976a3e3`. Evidence: `docs/rebuild-native-api-map.md` and `docs/rewrite-feature-matrix.md`.

## 1. Goal and non-goals

The module owns only tactical starship mechanics that Foundry VTT v14 and SF2e do not provide. It keeps native Actor, Item, Combat, Combatant, ChatMessage, Roll, ActiveEffect, permission, document lifecycle, targeting and UI mechanisms wherever their verified contracts fit.

Non-goals:

- No new actor type, roll system, skill system, proficiency system or persistent target store.
- No general action/reaction/MAP economy and no general Undo; both were intentionally removed.
- No wholesale import of the unmerged v1.4 effects branch.
- No global UI redesign, Toolbelt dependency, automatic world rewrite or release/publish action.
- No sensor-range invisibility rule invented on top of SF2e detection rules.

## 2. Source-of-truth boundaries

| Data                                                                                  | Authority                                                             | Rules                                                                               |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Hull Points                                                                           | `Actor.system.attributes.hp`                                          | Native bars, XP and system document APIs remain authoritative.                      |
| Starship-specific state                                                               | `Actor.flags[MODULE_ID].starship`                                     | Keep existing keys and IDs; additive migrations only.                               |
| Shield Points, crew, stations, weapons, upgrades, effects, sensor base range, Fortify | Existing module fields under the starship flag                        | Do not mirror these into new persistent stores.                                     |
| Hazard state                                                                          | `Actor.flags[MODULE_ID].starshipHazard`                               | Native `hazard` Actor remains the document type.                                    |
| Encounter map, detection and temporary combat state                                   | `Combat.flags[MODULE_ID].tsc`                                         | Public/private projections are derived; no hidden identity in public combat data.   |
| History                                                                               | GM-only history Journal                                               | Read-only audit; narrow Toolbelt damage undo remains separate.                      |
| Current targets                                                                       | `game.user.targets` / Token placeable target state                    | Ephemeral native state; never persist to flags.                                     |
| Effective sensor range                                                                | Derived from current ship data, frame/scanner data and verified rules | Do not persist a second calculated range. Missing base values may be migrated once. |
| Client UI preferences                                                                 | Client `uiState` setting                                              | Never shared across users.                                                          |

Prepared `actor.system` data is never treated as persistent source. Writes use Foundry document APIs and narrow flag paths.

## 3. Runtime lifecycle

`scripts/main.mjs` remains the composition root, not a business-logic container.

- `init`: capability gate, settings, sheets, templates, public API, scene controls and keybindings. Foundry 14.370 requires scene controls before `ready`.
- `ready`: content and translations, capability-checked optional adapters, sockets/hooks, then active-GM migration/repair/projections.
- Document hooks invalidate derived caches and rerender affected windows; no polling loops.
- Every registration is idempotent or guarded by Foundry's once-only lifecycle. Window callbacks clean up listeners and stale references.

## 4. Component boundaries

| Area                                  | Existing responsibility                                               | Boundary after rebuild                                                                            |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `scripts/starship/starship-state.mjs` | Read/normalize/write starship flags, per-Actor write queue            | Remains the only starship persistence gateway; no UI calls into raw flag writes.                  |
| `scripts/starship/stats.mjs`          | Derived ship statistics and native check helpers                      | Pure derivation plus native SF2e roll calls; no duplicate persistent stats.                       |
| `scripts/combat/*`                    | Combat creation, initiative, copies, cleanup and crew synchronization | Native Combat/Combatant lifecycle; station reset is one setting-controlled transition.            |
| `scripts/crew/*`                      | Roles, station claims, availability and station Items                 | Native Actor/Item documents; per-ship serialization and permission checks.                        |
| `scripts/sensor/*`                    | Contacts, detection, private projections and appearance               | Per-user projection before rendering; GM bypasses player-only range UX.                           |
| `scripts/engine/*`                    | Pure rules, validation, range, damage and migrations                  | No Foundry DOM/business logic; small pure helpers only where they remove duplication.             |
| `scripts/actions/*`                   | Action requirements, drafts, rolls and effects                        | One action contract; native targets in, result object out; confirmation before meaningful writes. |
| `scripts/chat/*`                      | Attack cards, receipts and chat rendering                             | Prefer system cards; one minimal starship-specific fallback and one damage path.                  |
| `scripts/integrations/*`              | Optional Toolbelt/Workbench/HoloDock/Aztec/Causodes adapters          | Feature detection and version-bounded behavior; absence never changes core rules.                 |
| `scripts/ui/*`                        | ApplicationV2 windows, sheets, HUD and controls                       | Thin rendering/event layer over services; no parallel game-state ownership.                       |

New files are allowed only when an existing file would become a mixed-responsibility large module. Expected candidates are a pure sensor-range resolver and a shared action-result formatter; neither should become a service framework.

## 5. Action and mutation flow

```text
UI action
  -> validate user, ship, station, resources and real SF2e requirements
  -> resolve current native targets (plus compatible Sensor Map selection)
  -> prepare native SF2e roll/check and show result
  -> for meaningful state changes: show consequence and allow confirm/edit/cancel
  -> GM-authoritative socket request with validated payload
  -> per-document queued write + conflict/receipt guard
  -> Foundry document hooks -> cache invalidation -> rerender/chat
```

Chat-only description sends branch directly to `ChatMessage.create` and never enter the roll/write path. Safe technical operations may run automatically; resource spending, conditions, movement, damage and irreversible actions require the configured user confirmation.

## 6. Targeting contract

- Core `T` toggles a hovered Token; `Shift` adds without releasing existing targets.
- SF2e Encounter Tracker already provides `toggleTarget`; reuse it instead of adding a second control system.
- Resolve targets from `game.user.targets`, deduplicate Token IDs, drop deleted/invalid/unavailable targets and revalidate detection/permission before execution.
- Sensor Map contacts are not TokenDocuments. Keep their existing ephemeral selection for map-only contacts; never create fake Tokens.
- Action payloads may add `targetUUIDs` while retaining legacy singular `targetKey` as a compatibility fallback. No target flags are persisted.

## 7. Sensor and privacy contract

- Official rules: Sensor Map is visible to GM and all players; Seek scans within sensor range; Gunnery may target outside sensor range.
- Range is not blanket invisibility. Detection state continues to control hidden/observed/identified information.
- Range boundary and blur are optional player-only visualization, not a new detection state.
- GM always receives the full unrestricted map and all contacts.
- Private identities are projected out before player rendering. Foundry ownership is not treated as a raw-client confidentiality boundary; live two-client verification remains mandatory.

## 8. Chat, damage and Toolbelt contract

- Use `ChatMessage`, evaluated `Roll`, SF2e check/card rendering and standard localization.
- Action descriptions and execution results share one formatter; source Item/compendium text remains immutable.
- Native SF2e/Toolbelt damage buttons bypass vehicle Shield Points. One capture/versioned adapter must intercept starship damage before native application, apply the module engine once and write a receipt.
- Ordinary characters keep native damage behavior. No duplicate damage buttons or second competing card.
- Toolbelt is optional: detect active module, exact API function and relevant setting. Actionable is not a starship engine; Better Chat transformations are refused for starship receipts.

## 9. Concurrency, authority and failure

- State-changing socket requests execute on the active GM and validate sender, permissions and payload server-side.
- Per-Actor and per-Combat queues serialize competing writes without stalling unrelated documents.
- Multi-document operations use conflict guards and receipts; they do not claim distributed atomicity.
- A failed write leaves the original document unchanged where Foundry permits; no blind retry after timeout.
- Hooks and UI callbacks are idempotent. Errors identify the operation/document without leaking private contact data.

## 10. Compatibility and migration contract

- Preserve module ID, setting keys, flag names, Actor/Item types, pack IDs, UUIDs, public API names, hook names and socket event names.
- Add `targetUUIDs` and new settings additively; do not rename or remove old contracts.
- `DATA_VERSION` moves from `2` to `3` only for the missing sensor-range migration described in `docs/migration-notes.md`.
- The station-reset setting needs no actor migration.
- Migrations are active-GM only, idempotent, narrow-path updates, never delete user data and never downgrade system schema stamps.

## 11. Autonomous decision log

| ID   | Decision                                                                                        | Reason                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| D-01 | Keep native vehicle/NPC/hazard Actor types; no new starship Actor type.                         | SF2e has no native starship type; the module marker and existing flags are the compatibility contract.    |
| D-02 | Treat sensor range as detection/action range, not blanket invisibility.                         | Official Sensor Map, Seek and Gunnery rules; user questioned visibility and supplied the source.          |
| D-03 | Boundary/blur are player-only UX; GM is unrestricted.                                           | Explicit user clarification and official full-map visibility.                                             |
| D-04 | Missing NPC range uses explicit statblock, then official size baseline, then `null` + warning.  | All 74 bundled NPC have explicit values; legacy/custom actors need a safe non-invented fallback.          |
| D-05 | Use native Token targets and SF2e Tracker control; no persistent target store.                  | Foundry already implements `T`, Shift multi-target and Tracker synchronization.                           |
| D-06 | Render Fortify from `starship.fortify`; do not derive it from Fortitude.                        | Verified module field and action semantics.                                                               |
| D-07 | Keep one starship damage adapter before native/Toolbelt application.                            | Native damage bypasses SP; duplicate paths cause double application.                                      |
| D-08 | Toolbelt remains optional and capability-checked.                                               | No hard dependency; ordinary actors must remain unchanged.                                                |
| D-09 | Soft automation confirms meaningful game-state changes.                                         | User requirement; calculations and safe technical writes may remain automatic.                            |
| D-10 | Preserve manual MAP/action economy and read-only history; do not restore general Undo.          | Intentional maintainer decisions, not regressions.                                                        |
| D-11 | Do not import the v1.4 effects branch wholesale.                                                | It adds ~5,717 lines and conflicts with the minimization goal; reuse only verified pieces.                |
| D-12 | Requirement 8.1 is already fixed; preserve and regression-test it.                              | Explicit user clarification; exact numbering is retained without guessing its content.                    |
| D-13 | Add `DATA_VERSION=3` only for missing base sensor range; no new provenance field on Actors.     | Additive compatibility with minimal stored data; migration audit/history records the source.              |
| D-14 | Preserve the two uncommitted user proficiency changes.                                          | They are current work, not baseline noise; no reset/stash/overwrite is allowed.                           |
| D-15 | Add a priority module `KeyT` binding only for hovered Sensor Map objects.                       | Core `KeyT` sees only Canvas hover; the module consumes map hover and otherwise falls through to core.    |
| D-16 | Hazards are valid targets and use native Actor HP/AC/saves.                                     | Explicit user correction; starship flags and starship save formulas must not be written to hazards.       |
| D-17 | Repeated directory drops add map records with unique keys and the same `actorUuid`.             | Latest explicit user choice: no independent Actor copy; drag still moves only the selected record.        |
| D-18 | `manualReflexDC` uses the shared level DC table, with manual DC taking precedence.              | Live level-10 attacker produced DC 10 from Reflex 0 instead of the required level DC 27.                  |
| D-19 | HTML action descriptions pass through the same single inline-enrichment pipeline as plain text. | Live HTML probe rendered zero links; existing tokens remain protected by `TOKEN_RE`.                      |
| D-20 | Restore a minimal GM condition manager without history; use native Condition Manager items.     | Explicit user request; the full v1.4 effects branch is unnecessary and would reintroduce removed history. |
| D-21 | Render degree legends only from real action outcomes or verified basic-save metadata.           | Matches the SF2e screenshot without inventing results for cancelled/dry-run/failed cards.                 |
| D-22 | Use native-like IWR/skills controls while preserving the numeric-map storage contract.          | The current schema has no exceptions/doubleVs; inert controls would be misleading and lossy.              |

## 12. Implementation order

1. T-007: combat lifecycle, crew/stations and default-off initiative reset setting.
2. T-008: ship documents/sheets, Fortify and measured compactness.
3. T-009: sensor range resolver, player visualization, detection privacy and missing-NPC migration.
4. T-010: native target integration and action payloads.
5. T-011: shared action results, chat-only descriptions and soft automation.
6. T-012: unified cards and single damage/Toolbelt path.
7. T-013: optional integrations and PF2e + Anachronism.
8. T-014/T-015: full automated/live verification, cleanup, ZIP and final decision report.
9. T-019: native Sensor Map `KeyT`, visible target marker and hazard target/damage/save support.
10. T-020: repeated directory drops as additional map records with the same Actor UUID.
11. T-021/T-023: measured station compactness and Sensor Map HP/SP deduplication.
12. T-022: unified inline enrichment for HTML and plain action descriptions.
13. T-024: table-based starship level DC for `manualReflexDC`.
14. T-025/T-026/T-027: restored condition manager, native-style ship editors and SF2e outcome cards.
15. T-018/T-015: final live regression, cleanup, packaging and delivery.
