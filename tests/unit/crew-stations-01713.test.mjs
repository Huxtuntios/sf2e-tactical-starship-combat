import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeCharacter, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { crewStationsView } from "../../scripts/crew/crew-stations-view.mjs";

test("station chooser lists accessible combat ships and exposes current and free stations", () => {
  installFoundryMock();
  const actor = makeCharacter({ id: "station-pc", name: "Pilot", owners: ["p1"] });
  const ship = makeShip({
    id: "ship-current",
    name: "Current ship",
    owners: ["p1"],
    stations: [
      { id: "pilot-1", name: "Pilot", type: "pilot", helmedBy: actor.uuid },
      { id: "gunner-1", name: "Gunner", type: "gunner" }
    ],
    crew: [{ actorUuid: actor.uuid, name: actor.name, userId: "p1", role: "crew", stationId: "pilot-1" }]
  });
  const other = makeShip({
    id: "ship-other",
    name: "Other ship",
    owners: ["p1"],
    stations: [{ id: "pilot-2", name: "Pilot", type: "pilot" }]
  });
  const hidden = makeShip({
    id: "ship-hidden",
    name: "Hidden ship",
    role: "npc",
    owners: ["p2"],
    stations: [{ id: "pilot-3", name: "Pilot", type: "pilot" }]
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid }, { key: other.uuid }, { key: hidden.uuid }] });
  const view = crewStationsView(combat, actor, game.users.get("p1"));
  assert.deepEqual(
    view.ships.map((item) => item.name),
    ["Current ship", "Other ship"]
  );
  assert.deepEqual(view.ships[0].currentStation, { id: "pilot-1", name: "Pilot" });
  assert.deepEqual(
    view.ships[0].freeStations.map((item) => item.id),
    ["gunner-1"]
  );
  assert.equal(view.ships[0].claimDisabled, false);
  assert.equal(view.ships[1].claimDisabled, false);
});

test("character sheets expose the station command through Foundry's AppV1 and AppV2 hooks only in combat", async () => {
  installFoundryMock();
  const { registerControls } = await import("../../scripts/ui/controls.mjs");
  registerControls();
  const actor = makeCharacter({ id: "sheet-pc", name: "Pilot", owners: ["p1"] });
  const v1Buttons = [];
  Hooks.callAll("getActorSheetHeaderButtons", { actor, options: { classes: [] } }, v1Buttons);
  assert.equal(
    v1Buttons.some((button) => button.class === "tsc-crew-stations"),
    false
  );

  makeStarshipCombat();
  Hooks.callAll("getActorSheetHeaderButtons", { actor, options: { classes: [] } }, v1Buttons);
  assert.equal(
    v1Buttons.some((button) => button.class === "tsc-crew-stations"),
    true
  );
  const v2Controls = [];
  Hooks.callAll("getHeaderControlsApplicationV2", { document: actor, options: { classes: [] } }, v2Controls);
  assert.equal(
    v2Controls.some((control) => control.action === "tscCrewStations"),
    true
  );
});
