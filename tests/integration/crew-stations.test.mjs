import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeCharacter, makeShip } from "../helpers/foundry-mock.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";

test("Crew service serializes competing station claims and releases the winner", async () => {
  installFoundryMock();
  const first = makeCharacter({ id: "station-claim-a", name: "Pilot A", owners: ["p1"] });
  const second = makeCharacter({ id: "station-claim-b", name: "Pilot B", owners: ["p2"] });
  const ship = makeShip({
    id: "station-claim-target",
    name: "Claim target",
    stations: [{ id: "pilot-station", type: "pilot", helmedBy: null }],
    crew: []
  });
  const { Crew, registerCrewHandlers } = await import("../../scripts/crew/crew-service.mjs");
  registerCrewHandlers();

  const results = await Promise.allSettled([
    Crew.claim(ship.uuid, "pilot-station", first.uuid),
    Crew.claim(ship.uuid, "pilot-station", second.uuid)
  ]);
  const winners = results.flatMap((result, index) => (result.status === "fulfilled" ? [index === 0 ? first : second] : []));
  assert.equal(winners.length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const winner = winners[0];
  assert.equal(readStarship(ship).stations[0].helmedBy, winner.uuid);
  assert.equal(readStarship(ship).crew.find((member) => member.actorUuid === winner.uuid).stationId, "pilot-station");

  await Crew.release(ship.uuid, "pilot-station", winner.uuid);
  const afterRelease = readStarship(ship);
  assert.equal(afterRelease.stations[0].helmedBy, null);
  assert.equal(afterRelease.crew.find((member) => member.actorUuid === winner.uuid).stationId, null);
});
