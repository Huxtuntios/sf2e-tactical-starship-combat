import test from "node:test";
import assert from "node:assert/strict";
import { mappedMineTargets } from "../../scripts/actions/mine-targets.mjs";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { modifyOwnedMine } from "../../scripts/actions/mine-modification.mjs";

function mapFixture() {
  installFoundryMock();
  const one = makeShip({ id: "one", name: "One" });
  const two = makeShip({ id: "two", name: "Two" });
  const elsewhere = makeShip({ id: "other", name: "Elsewhere" });
  const state = { zones: 12, objects: [one, two, elsewhere].map((a, i) => ({ key: a.uuid, type: "starship", zone: i === 2 ? 4 : 3 })) };
  state.objects.push({ key: "hazard", type: "hazard", zone: 3 });
  return { one, two, state, resolve: async (uuid) => fromUuidSync(uuid) };
}
test("mapped ships include source and exclude hazards and other zones without changing map", async () => {
  const f = mapFixture(),
    before = structuredClone(f.state);
  const r = await mappedMineTargets(f.state, 3, f.one.uuid, f.resolve);
  assert.deepEqual(
    r.targets.map((x) => x.uuid),
    [f.one.uuid, f.two.uuid]
  );
  assert.equal(r.shipZone, 3);
  assert.deepEqual(f.state, before);
});
test("ambiguous key, duplicate actor, invalid zones and unknown types are rejected", async () => {
  for (const alter of [
    (f) => f.state.objects.push({ ...f.state.objects[0] }),
    (f) => f.state.objects.push({ ...f.state.objects[0], key: "other-key" }),
    (f) => (f.state.objects[1].zone = 99),
    (f) => (f.state.objects[1].type = "unknown"),
    (f) => (f.state.objects[0].key = "other-key")
  ]) {
    const f = mapFixture();
    alter(f);
    await assert.rejects(mappedMineTargets(f.state, 3, f.one.uuid, f.resolve));
  }
});
test("unresolvable or non-starship mapped target is rejected, not silently omitted", async () => {
  const f = mapFixture();
  await assert.rejects(mappedMineTargets(f.state, 3, f.one.uuid, async () => null));
  const pc = makeCharacter({ id: "pc", name: "PC" });
  f.state.objects[1].key = pc.uuid;
  await assert.rejects(mappedMineTargets(f.state, 3, f.one.uuid, f.resolve));
});

async function uiFixture(smart = true) {
  installFoundryMock();
  await loadContentFromDisk();
  const pc = makeCharacter({ id: "operator", name: "Operator" });
  pc.system.details = { level: { value: 3 } };
  pc.classDC = { dc: { value: 19 } };
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "s1", type: "drone-console", grade: "commercial", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, role: "crew", stationId: "s1" }]
  });
  const other = makeShip({ id: "target", name: "<Target>" });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 3 },
      { key: other.uuid, zone: 3 }
    ]
  });
  await combat.createEmbeddedDocuments("Combatant", [{ _id: "op", actorId: pc.id, initiative: 20 }]);
  const { patchStarship, readStarship } = await import("../../scripts/starship/starship-state.mjs");
  await patchStarship(
    ship,
    (d) => {
      d.drones = [
        {
          id: "d1",
          stationId: "s1",
          tscVersion: 1,
          ref: "pyrotechnics-drone",
          deployed: true,
          mines: [
            {
              id: "m1",
              droneId: "d1",
              shipUuid: ship.uuid,
              operatorUuid: pc.uuid,
              combatId: combat.id,
              zone: 3,
              state: "armed",
              legacy: { keep: 1 }
            }
          ]
        }
      ];
      if (smart)
        modifyOwnedMine({
          data: d,
          shipUuid: ship.uuid,
          stationId: "s1",
          droneId: "d1",
          mineId: "m1",
          operator: pc,
          combat,
          shipZone: 3,
          origin: 3,
          type: "smart",
          modificationId: "mineMod-abcdefgh"
        });
    },
    { history: false }
  );
  const { prepareMineDetonation } = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  const button = { dataset: { stationId: "s1", droneId: "d1", mineId: "m1" } };
  return { ship, other, combat, readStarship, run: () => prepareMineDetonation.call({ document: ship }, null, button) };
}
test("Smart exclusion labels exactly one target on a GM-only manual card without state writes", async () => {
  const f = await uiFixture();
  let dialog;
  foundry.applications.api.DialogV2.prompt = async (options) => {
    dialog = options.content;
    return { type: "piercing", reaction: true, excludedTarget: f.other.uuid };
  };
  const before = structuredClone(f.readStarship(f.ship)),
    writes = globalThis.__writes.length,
    messages = game.messages.size;
  await f.run();
  const msg = [...game.messages.values()].at(-1);
  assert.equal(game.messages.size, messages + 1);
  assert.deepEqual(msg.whisper, ["gm"]);
  assert.match(dialog, /name="excludedTarget"/);
  assert.match(msg.content, /&lt;Target&gt;/);
  assert.equal((msg.content.match(/excluded from this blast/g) ?? []).length, 1);
  assert.match(msg.content, /@Damage\[3d8\[piercing\]\]/);
  assert.equal(globalThis.__writes.length, writes);
  assert.deepEqual(f.readStarship(f.ship), before);
});
test("non-smart or unknown selected target is rejected with no writes or card", async () => {
  for (const smart of [true, false]) {
    const f = await uiFixture(smart);
    foundry.applications.api.DialogV2.prompt = async () => ({ type: "fire", excludedTarget: smart ? "Actor.missing" : f.other.uuid });
    const writes = globalThis.__writes.length,
      messages = game.messages.size;
    await assert.rejects(f.run());
    assert.equal(globalThis.__writes.length, writes);
    assert.equal(game.messages.size, messages);
  }
});
test("changed map, round or modification while dialog open refuses without new card", async () => {
  for (const kind of ["map", "round", "modification"]) {
    const f = await uiFixture();
    foundry.applications.api.DialogV2.prompt = async () => {
      if (kind === "map") f.combat.flags["sf2e-tactical-starship-combat"].tsc.objects[1].zone = 4;
      if (kind === "round") f.combat.round = 2;
      if (kind === "modification")
        f.ship.flags["sf2e-tactical-starship-combat"].starship.drones[0].mines[0].tscMineModification.type = "targeting";
      return { type: "fire", excludedTarget: f.other.uuid };
    };
    const writes = globalThis.__writes.length,
      messages = game.messages.size;
    await assert.rejects(f.run());
    assert.equal(globalThis.__writes.length, writes);
    assert.equal(game.messages.size, messages);
  }
});
test("same-client concurrent click opens one dialog; cancel permits later retry", async () => {
  const f = await uiFixture();
  let release,
    calls = 0;
  foundry.applications.api.DialogV2.prompt = async () => {
    calls++;
    return await new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = f.run();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  await f.run();
  assert.equal(calls, 1);
  release(null);
  await first;
  foundry.applications.api.DialogV2.prompt = async () => {
    calls++;
    return null;
  };
  await f.run();
  assert.equal(calls, 2);
});

test("expired Smart cannot exclude a target and no selector is offered", async () => {
  const f = await uiFixture();
  f.combat.round = 3;
  let dialog;
  foundry.applications.api.DialogV2.prompt = async (options) => {
    dialog = options.content;
    return { type: "fire", excludedTarget: f.other.uuid };
  };
  const writes = globalThis.__writes.length,
    messages = game.messages.size;
  await assert.rejects(f.run());
  assert.doesNotMatch(dialog, /name="excludedTarget"/);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
});

test("players cannot open GM-only helper or create cards", async () => {
  const f = await uiFixture();
  game.user = game.users.get("p1");
  const messages = game.messages.size,
    writes = globalThis.__writes.length;
  await assert.rejects(f.run());
  assert.equal(game.messages.size, messages);
  assert.equal(globalThis.__writes.length, writes);
});
