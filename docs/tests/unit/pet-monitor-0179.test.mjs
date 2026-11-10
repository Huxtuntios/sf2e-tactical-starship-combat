import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter } from "../helpers/foundry-mock.mjs";
import { petEndCandidates, observePetCabins } from "../../scripts/actions/pet-cabin-monitor.mjs";
import { petOnboardStatus, updatePetCabin } from "../../scripts/actions/pet-onboard.mjs";
import { readStarship, patchStarship } from "../../scripts/starship/starship-state.mjs";

const session = { sessionId: "petStart123", petUuid: "Actor.pet", operatorUuid: "Actor.op", start: 100, end: 160 };
const base = () => ({
  stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op", tscPetOnboard: { ...session }, legacy: 12 }],
  upgrades: [{ id: "u", ref: "pet-drone-shell", stationId: "s" }]
});
const pet = (hp = 1) => ({ uuid: "Actor.pet", system: { attributes: { hp: { value: hp } } } });

test("pet monitor identifies definite time, helm, HP, deletion and upgrade ending events", () => {
  const d = base(),
    get = () => pet();
  assert.deepEqual(petEndCandidates(d, 159, get), []);
  assert.equal(petEndCandidates(d, 160, get).length, 1);
  assert.equal(petEndCandidates(d, 150, () => pet(0)).length, 1);
  assert.equal(petEndCandidates(d, 150, () => null, "Actor.pet").length, 1);
  assert.equal(petEndCandidates(d, 150, () => null).length, 0, "unresolvable is not proof of death");
  d.stations[0].helmedBy = null;
  assert.equal(petEndCandidates(d, 150, get).length, 1);
  d.stations[0].helmedBy = "Actor.op";
  d.upgrades = [];
  assert.equal(petEndCandidates(d, 150, get).length, 1);
});
test("pet monitor refuses ambiguous station IDs and skips already ended sessions", () => {
  const d = base();
  d.stations.push(structuredClone(d.stations[0]));
  assert.deepEqual(
    petEndCandidates(d, 160, () => pet()),
    []
  );
  d.stations.pop();
  d.stations[0].tscPetOnboard.ended = true;
  assert.deepEqual(
    petEndCandidates(d, 160, () => pet()),
    []
  );
  assert.equal(petOnboardStatus(d, d.stations[0], pet(), 120), false);
});
async function setup() {
  installFoundryMock();
  await loadContentFromDisk();
  game.time.worldTime = 120;
  const d = base();
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: d.stations,
    crew: [{ actorUuid: "Actor.op", stationId: "s", role: "crew" }],
    extra: { upgrades: d.upgrades, oldField: 42 }
  });
  const animal = makeCharacter({ id: "pet", name: "Pet" });
  animal.system = { traits: { size: { value: "tiny" } }, attributes: { hp: { value: 0 } } };
  return { ship, animal };
}
test("death observed before recovery is durably ended and repeated observation is a no-op", async () => {
  const { ship, animal } = await setup();
  const first = observePetCabins();
  animal.system.attributes.hp.value = 5;
  assert.equal(await first, 1);
  const d = readStarship(ship),
    st = d.stations[0];
  assert.equal(st.tscPetOnboard.ended, true);
  assert.equal(st.legacy, 12);
  assert.equal(d.oldField, 42);
  assert.equal(petOnboardStatus(d, st, animal, 120), false);
  const before = globalThis.__writes.length;
  assert.equal(await observePetCabins(), 0);
  assert.equal(globalThis.__writes.length, before);
  assert.throws(() =>
    updatePetCabin(d, {
      stationId: "s",
      pet: animal,
      operatorUuid: "Actor.op",
      op: "start",
      operationId: "petStart456",
      now: 120,
      confirmed: true
    })
  );
});
test("an old captured event cannot end a newer replacement session", async () => {
  const { ship } = await setup();
  let unblock;
  const gate = new Promise((r) => (unblock = r));
  const pending = patchStarship(
    ship,
    async (d) => {
      await gate;
      d.stations[0].tscPetOnboard.sessionId = "replacement123";
    },
    { history: false }
  );
  const observe = observePetCabins();
  unblock();
  await pending;
  assert.equal(await observe, 0);
  assert.equal(readStarship(ship).stations[0].tscPetOnboard.sessionId, "replacement123");
  assert.notEqual(readStarship(ship).stations[0].tscPetOnboard.ended, true);
});
test("non-active GM and players never write a pet end marker", async () => {
  const { ship } = await setup();
  game.user = game.users.get("p1");
  const before = globalThis.__writes.length;
  assert.equal(await observePetCabins(), 0);
  assert.equal(globalThis.__writes.length, before);
  assert.notEqual(readStarship(ship).stations[0].tscPetOnboard.ended, true);
});

test("registered actor and time hooks end a cabin on the active GM", async () => {
  const { registerPetCabinMonitor } = await import("../../scripts/actions/pet-cabin-monitor.mjs");
  const { ship, animal } = await setup();
  animal.system.attributes.hp.value = 4;
  registerPetCabinMonitor();
  await animal.update({ "system.attributes.hp.value": 0 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(readStarship(ship).stations[0].tscPetOnboard.ended, true);
  assert.equal(globalThis.__hookErrors?.length ?? 0, 0);
  const before = globalThis.__writes.length;
  Hooks.callAll("updateWorldTime", 160);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(globalThis.__writes.length, before);
});
