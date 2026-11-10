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
