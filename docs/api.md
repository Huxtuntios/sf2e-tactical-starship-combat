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

## Unpublished reliability recovery

- `api.pendingPrivateReveals(combat = activeStarshipCombat())` — read-only GM diagnostics: `{ key, actorUuid, stage }[]`; other users receive an empty list. Does not write or recover documents.
- `await api.recoverPrivateReveals(combat = activeStarshipCombat())` — explicit active-GM finish-forward recovery. Returns `{ pending, completed, failed }`; completed entries are keys, failures contain `{ key, stage, error }`. Reports are GM-local, not socket broadcasts. Inspect conflicts and private journal/Actor/Combatant/map documents before retrying; information already disclosed cannot be undone. Do not invoke recovery from render hooks.

## 0.17.1-dev.12 additions

- `api.addSensorContact(spec, combat = activeStarshipCombat())` — GM only. `spec = { source: "world" | "compendium" | "custom", uuid?, name?, zone, detection, confirmed }`. `observed` and `identified` require `confirmed: true`. A compendium hazard is copied into the world with no player access; the copy is removed if placement fails.
- `api.syncMineContact({ shipUuid, droneId, mineId })` — GM only, idempotent. Creates or updates the mine's Hazard Actor and Sensor Map contact, or removes the contact and marks the Actor when the mine is detonated or removed.
- `api.privacyProbe()` — any user. Reports what this client can see of the private Sensor Map data (`findings`, `counts`, `note`). An empty findings list is **not** a security proof.
