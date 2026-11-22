# Public API

```js
const api = game.modules.get("sf2e-tactical-starship-combat").api;
api.openSensorMap();
api.openStarshipSheet(actor); // player starship (vehicle)
api.openNPCStarshipSheet(actor); // NPC starship
await api.startStarshipCombat({
  playerShips: [uuid],
  crew: [uuid],
  enemies: [{ uuid, zone: 10 }],
  hazards: [{ uuid, zone: 6 }],
  zones: 12
});
api.isStarship(actor);
api.isStarshipCombat(combat);
await api.moveStarship(actor, 7); // GM
await api.changeHeading(actor); // GM
await api.executeStarshipAction({ shipUuid, actionId: "boost-thrusters", crewUuid, options: {} });
await api.applyStarshipDamage({ actor, amount: 14, damageType: "fire", traits: ["bypassing"] }); // GM
await api.triggerHazard(hazardUuid);
await api.disableHazard(hazardUuid, "disable");
api.getStarshipState(actor);
api.getSensorState(combat);
api.convertToStarship(actor, "player" | "npc");
```

Hooks (`Hooks.on(name, fn)`): `sf2eTsc.starshipCombatStarted`, `…CombatEnded`, `…starshipMoved(ship,from,to)`, `…starshipHeadingChanged`, `…starshipActionExecuted(ship,action,degree)`,
`…starshipDamaged(ship,result)`, `…starshipDestroyed`, `…starshipCompromised`, `…stationMalfunctioned`, `…hazardTriggered`, `…hazardDisabled`, `…targetIdentified`, `…crewChanged`, `…stationClaimed`.
`result` of `starshipDamaged`: `{originalDamage, mitigatedDamage, shieldDamage, hullDamage, bypassedShields, hardnessReduction, resistanceReduction, weaknessIncrease, immune, compromisedIncrease, becameCompromised, stationsMalfunctioned, destroyed, newState}`.

## 1.4.0 — GM effects and persistent damage

All mutations below require the authenticated active GM. These methods do not grant player permission through a socket payload. `openEffectManager` is a GM-only shared UI; `getEffectTargetCatalog` reads the ship's actual installed stations/actions/weapons and registered/assigned crew.

```js
api.openEffectManager(actor);
const catalog = api.getEffectTargetCatalog(actor);
const applied = await api.applyManualEffect(actor.uuid, {
  operationId: "example-frightened-1",
  kind: "condition",
  slug: "frightened",
  conditionValue: 2,
  ignoreImmunities: false,
  targets: { entire: true }
});
await api.removeManualEffect(actor.uuid, applied.applicationId);
```

`targets` is normalized to `{ entire, mechanics: [], stations: [], actions: [{ stationId, actionId }], weaponAttacks, weaponDefenses, weapons: [], allCrew, crew: [actorUuid] }`. Entire defaults to true, is ship-only and does not select crew. Mechanics are `abilities`, `skills`, `attacks`, `saves`, `ac`, `defenses`; defenses covers other supported skill/Perception DCs independently from AC/saves. Weapon IDs and action pairs must exist in the current catalog. `weaponDefenses` is currently unsupported. Combining scopes does not double one application's contribution. For crew-only selection, explicitly pass `entire: false`. Empty, stale and incompatible selections reject before application.

Numeric applications use `kind: "bonus" | "penalty"`, `modifiers: [{ selector, value, type }]` and optional `statistic: "check" | "dc" | "both"`. Values are actual signed numbers; type is `status`, `circumstance`, `item` or `untyped`. Crew-specific check/DC selectors are resolved against native statistic domains; unsupported domains reject. Condition values are positive integers only when the condition is valued; otherwise use null/omit. Unsupported native ship condition mechanics reject. Do not use generic `condition` with slug `persistent-damage`; use the dedicated kind.

Persistent configuration: `kind: "persistent-damage"`, `persistent: { formula, damageType, dc: 15, criticalHit: false }`. Select the whole ship and/or valid crew recipients, not unsupported station/weapon subtargets. The formula and damage type must be supported by the current native system. `ignoreImmunities` defaults false and is only an effect-immunity exception; it never edits actual immunity data or bypasses later damage IWR.

Stable `operationId` retries preserve the application/native Item identity; changing a replayed input rejects. Returns `{ applicationId, status, nativeTargets, rejectedTargets, record }` for a current application; status can be `applied` or `partial`, with failed crew recipients explicitly listed. A replay after exact removal returns `removed`. Partial native creation/save/deletion failures retain durable handles for inspection/retry rather than deleting unrelated Items. Do not generate a new operation ID when retrying the same application after a timeout.

- `await api.processPersistentDamage(shipUuid, { combat?, intervalKey? })` — roll/store a ship packet. The default interval is combat/round, otherwise current world time. Combat hooks use the actual ordinary ship turn end or one end-of-round fallback, not every crew/hull-integrity turn. Only use explicit interval keys for deliberately separate outside-combat intervals; they are not a way to bypass same-round guards.
- `await api.applyPersistentDamage(shipUuid, receiptId)` — explicit GM application of that saved packet through existing ship IWR/Hardness/shields/hull; repeat controls share its durable receipt. Removed/recovered/stale components reject rather than dealing stored damage to an obsolete recipient.
- `await api.recoverPersistentDamage(shipUuid, applicationId, { actorUuid? })` — ship recovery after application when actorUuid is omitted, independent native crew recovery for an exact linked recipient otherwise. Successful ship recovery ends all same-type ship recipients but preserves unrecovered crew. Exact application removal is separate and does not clear other same-name applications.

Indefinite manual applications and receipts persist through reload and combat end. Native crew expiry/removal is synchronized without recreating Items. Effects are effective overlays, not physical ship/station repair mutations. Private ship handling retains the existing GM authority/detection policy; the API does not redesign world-data visibility.

## Unpublished reliability recovery

- `api.pendingPrivateReveals(combat = activeStarshipCombat())` — read-only GM diagnostics: `{ key, actorUuid, stage }[]`; other users receive an empty list. Does not write or recover documents.
- `await api.recoverPrivateReveals(combat = activeStarshipCombat())` — explicit active-GM finish-forward recovery. Returns `{ pending, completed, failed }`; completed entries are keys, failures contain `{ key, stage, error }`. Reports are GM-local, not socket broadcasts. Inspect conflicts and private journal/Actor/Combatant/map documents before retrying; information already disclosed cannot be undone. Do not invoke recovery from render hooks.

## 0.17.1-dev.12 additions

- `api.addSensorContact(spec, combat = activeStarshipCombat())` — active GM only. `spec = { source: "world" | "compendium" | "custom", uuid?, name?, zone, detection }`. The selected detection state applies immediately; the current service does not require `confirmed`. World and compendium Hazard/Starship placements create independent world Actor copies, leaving sources unchanged. Actors accessible to players can only be placed as identified; otherwise the copy starts with player ownership NONE. An unreferenced copy is removed after placement failure; inspect pending contacts before retrying. See `scripts/sensor/contact-service.mjs` and `scripts/sensor/actor-instance.mjs`.
- `api.syncMineContact({ shipUuid, droneId, mineId })` — GM only, idempotent. Creates or updates the mine's Hazard Actor and Sensor Map contact, or removes the contact and marks the Actor when the mine is detonated or removed.
- `api.privacyProbe()` — any user. Reports what this client can see of the private Sensor Map data (`findings`, `counts`, `note`). An empty findings list is **not** a security proof.
