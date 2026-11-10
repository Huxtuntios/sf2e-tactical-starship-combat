import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat, dice } from "../helpers/foundry-mock.mjs";
import { mineBasicDamage, guidedMineResolution } from "../../scripts/ui/sheet/mine-guided.mjs";
import { prepareHarrySensors } from "../../scripts/ui/sheet/harry-assist.mjs";

test("basic mine damage uses all four save degrees and floors half damage", () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((d) => mineBasicDamage(11, d)),
    [22, 11, 5, 0]
  );
  for (const [n, d] of [
    [-1, 2],
    [3, -1],
    [3, 4],
    [2.3, 1],
    [3, null]
  ])
    assert.throws(() => mineBasicDamage(n, d));
});
function native(actor, slug, degree, total = 19) {
  actor.saves = {
    ...(actor.saves ?? {}),
    [slug]: {
      mod: 8,
      check: {
        roll: async (opts) => {
          assert.equal(opts.createMessage, false);
          assert.equal(opts.dc.value, 20);
          return { degreeOfSuccess: degree, total };
        }
      }
    }
  };
}
async function guidedFixture({ modification, excluded = "" } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  const ship = makeShip({ id: "ship", name: "Ship", role: "npc" });
  const a = makeShip({ id: "a", name: "<A>", role: "npc" });
  const b = makeShip({ id: "b", name: "B", role: "npc" });
  native(a, "reflex", 0);
  native(b, "reflex", 2);
  const fresh = {
    snapshot: "current",
    result: { zone: 3, dc: 20, dice: 2, ...(modification ? { modification, bonus: 4 } : {}) },
    operator: { uuid: "Actor.op", name: "Operator" },
    targets: [a, b].map((x) => ({ key: x.uuid, uuid: x.uuid, name: x.name }))
  };
  const args = {
    ship,
    fresh,
    choice: { type: "fire" },
    excluded,
    recipients: ["gm"],
    plan: async () => fresh,
    mineId: "m1",
    droneId: "d1"
  };
  return { ship, a, b, fresh, args };
}
test("guided mine uses native rolls, one GM card, no Actor writes, Targeting once", async () => {
  const f = await guidedFixture({ modification: "targeting" });
  dice(4, 5);
  foundry.applications.api.DialogV2.prompt = async () => ({ damage: "", degrees: ["0", "2"] });
  const writes = globalThis.__writes.length;
  await guidedMineResolution(f.args);
  assert.equal(game.messages.size, 1);
  const m = [...game.messages.values()][0];
  assert.deepEqual(m.whisper, ["gm"]);
  assert.match(m.content, /2d8 \+ 4/);
  assert.match(m.content, /13/);
  assert.match(m.content, /26 damage before defenses/);
  assert.match(m.content, /6 damage before defenses/);
  assert.match(m.content, /&lt;A&gt;/);
  assert.equal(globalThis.__writes.length, writes);
});
test("Smart exclusion never rolls selected target", async () => {
  const f = await guidedFixture({ modification: "smart" });
  f.args.excluded = f.a.uuid;
  f.a.saves.reflex.check.roll = async () => {
    throw new Error("excluded target rolled");
  };
  foundry.applications.api.DialogV2.prompt = async () => ({ degrees: ["2"], damage: "" });
  await guidedMineResolution(f.args);
  const m = [...game.messages.values()][0];
  assert.match(m.content, /excluded by Smart Mine/);
  assert.match(m.content, /4 damage before defenses/);
});
test("manual fallback stores entered save and damage without applying damage", async () => {
  const f = await guidedFixture();
  globalThis.CONFIG.Dice.rolls = [];
  delete f.a.saves;
  foundry.applications.api.DialogV2.prompt = async () => ({ damage: "11", degrees: ["1", ""] });
  const before = globalThis.__writes.length;
  await guidedMineResolution(f.args);
  const m = [...game.messages.values()][0];
  assert.match(m.content, /11 damage before defenses/);
  assert.match(m.content, /GM entry/);
  assert.match(m.content, /Save unavailable or uncertain/);
  assert.equal(globalThis.__writes.length, before);
});
test("changed plan stops with completed damage retained and saves pending", async () => {
  const f = await guidedFixture();
  let calls = 0;
  f.args.plan = async () => (++calls > 1 ? { snapshot: "changed" } : f.fresh);
  await guidedMineResolution(f.args);
  const m = [...game.messages.values()][0];
  assert.match(m.content, /Damage 2d8 Fire: 8/);
  assert.match(m.content, /changed/);
  assert.match(m.content, /Pending/);
});
test("closing review keeps single partial card", async () => {
  const f = await guidedFixture();
  foundry.applications.api.DialogV2.prompt = async () => null;
  await guidedMineResolution(f.args);
  assert.equal(game.messages.size, 1);
  assert.match([...game.messages.values()][0].content, /No HP\/SP/);
});
async function harryFixture({ dc = 21 } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  const operator = makeCharacter({ id: "op", name: "Operator" });
  operator.getStatistic = (slug) => (slug === "class-spell" && dc != null ? { dc: { value: dc } } : null);
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "s1", type: "drone-console", grade: "commercial", helmedBy: operator.uuid }],
    crew: [{ actorUuid: operator.uuid, role: "crew", stationId: "s1" }],
    extra: { drones: [{ id: "d1", stationId: "s1", ref: "scramble-drone", tscVersion: 1, deployed: true }] }
  });
  const target = makeShip({ id: "target", name: "Target", role: "npc" });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 3 },
      { key: target.uuid, zone: 3 }
    ]
  });
  const button = { dataset: { stationId: "s1", droneId: "d1" } };
  return { operator, ship, target, combat, run: () => prepareHarrySensors(ship, button) };
}
test("Harry Sensors uses class-spell DC, native Will and reports correct effects without applying conditions", async () => {
  const f = await harryFixture({ dc: 20 });
  native(f.target, "will", 1);
  let calls = 0;
  foundry.applications.api.DialogV2.prompt = async () => (calls++ === 0 ? { target: f.target.uuid, dc: "" } : "1");
  const writes = globalThis.__writes.length;
  await f.run();
  const msg = [...game.messages.values()][0];
  assert.deepEqual(msg.whisper, ["gm"]);
  assert.match(msg.content, /Will DC 20/);
  assert.match(msg.content, /Failure: off-kilter/);
  assert.match(msg.content, /No conditions were applied/);
  assert.equal(globalThis.__writes.length, writes);
});
test("Harry manual DC and critical failure remain manual when save unavailable", async () => {
  const f = await harryFixture({ dc: null });
  let calls = 0;
  foundry.applications.api.DialogV2.prompt = async () => (calls++ === 0 ? { target: f.target.uuid, dc: "23" } : "0");
  await f.run();
  const msg = [...game.messages.values()][0];
  assert.match(msg.content, /Will DC 23/);
  assert.match(msg.content, /Critical failure: off-kilter and off-guard/);
  assert.match(msg.content, /GM entry/);
});
test("Harry rejects stale map and ambiguous drone before producing any card", async () => {
  const f = await harryFixture();
  foundry.applications.api.DialogV2.prompt = async () => {
    f.combat.flags["sf2e-tactical-starship-combat"].tsc.objects[1].zone = 4;
    return { target: f.target.uuid };
  };
  await assert.rejects(f.run());
  assert.equal(game.messages.size, 0);
  f.ship.flags["sf2e-tactical-starship-combat"].starship.drones.push({
    ...f.ship.flags["sf2e-tactical-starship-combat"].starship.drones[0]
  });
  await assert.rejects(f.run());
  assert.equal(game.messages.size, 0);
});
test("Harry does not expose its GM helper to a player", async () => {
  const f = await harryFixture();
  game.user = game.users.get("p1");
  await assert.rejects(f.run());
  assert.equal(game.messages.size, 0);
});

test("manual Intercept is individual, replay safe, and reset only by Retrieve", async () => {
  const { markManualIntercept } = await import("../../scripts/actions/intercept-manual.mjs");
  const { changeDrone } = await import("../../scripts/engine/drone-state.mjs");
  const data = {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op" }],
    drones: [{ id: "d", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true, legacy: { keep: 1 } }]
  };
  const args = {
    stationId: "s",
    droneId: "d",
    operatorUuid: "Actor.op",
    combatId: "combat",
    interceptId: "intercept-123",
    strikeRef: "attack.123"
  };
  assert.equal(markManualIntercept(data, args), true);
  const saved = structuredClone(data);
  assert.equal(markManualIntercept(data, args), false);
  assert.deepEqual(data, saved);
  assert.throws(() => markManualIntercept(data, { ...args, strikeRef: "other" }));
  assert.throws(() => markManualIntercept(data, { ...args, strikeRef: "new", interceptId: "intercept-2" }));
  const env = { definition: {}, droneTypes: [{ id: "scramble-drone" }], worldTime: 0 };
  assert.equal(changeDrone(data, "retrieve", { stationId: "s", id: "d" }, env), true);
  assert.equal(data.drones[0].tscInterceptUsed, false);
  assert.deepEqual(data.drones[0].legacy, { keep: 1 });
  assert.equal(markManualIntercept(data, args), false);
  assert.equal(data.drones[0].tscInterceptUsed, false);
  assert.equal(data.drones[0].deployed, false);
});
test("manual Intercept rejects ambiguous records and bad receipt stores without mutations", async () => {
  const { markManualIntercept } = await import("../../scripts/actions/intercept-manual.mjs");
  for (const mutate of [
    (d) => d.drones.push({ ...d.drones[0] }),
    (d) => d.stations.push({ ...d.stations[0] }),
    (d) => (d.drones[0].tscInterceptReceipts = []),
    (d) => (d.drones[0].tscInterceptUsed = "bad"),
    (d) => (d.drones[0].deployed = false)
  ]) {
    const data = {
      stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op" }],
      drones: [{ id: "d", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true }]
    };
    mutate(data);
    const before = structuredClone(data);
    assert.throws(() =>
      markManualIntercept(data, {
        stationId: "s",
        droneId: "d",
        operatorUuid: "Actor.op",
        combatId: "c",
        interceptId: "intercept-1",
        strikeRef: "strike"
      })
    );
    assert.deepEqual(data, before);
  }
});
test("GM-authoritative manual Intercept socket refuses player and exact replay creates no card or write", async () => {
  const f = await harryFixture();
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  const { readStarship } = await import("../../scripts/starship/starship-state.mjs");
  registerShipHandlers();
  const out = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (m) => out.push(m) };
  const payload = {
    shipUuid: f.ship.uuid,
    stationId: "s1",
    droneId: "d1",
    operatorUuid: f.operator.uuid,
    combatId: f.combat.id,
    interceptId: "intercept-123",
    strikeRef: "attack.123",
    confirmManual: true
  };
  const send = (sender) => dispatchSocketMessage({ kind: "request", type: "markManualIntercept", requestId: "r1", payload }, sender, env);
  await send("p1");
  assert.equal(out.at(-1).ok, false);
  await Promise.all([send("gm"), send("gm")]);
  assert.equal(readStarship(f.ship).drones[0].tscInterceptUsed, true);
  const writes = globalThis.__writes.length,
    cards = game.messages.size;
  assert.equal(cards, 1);
  await send("gm");
  assert.equal(out.at(-1).result, false);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, cards);
});

test("Harry reviews all four outcomes and their exact manual instructions", async () => {
  const expected = [
    "Critical failure: off-kilter and off-guard",
    "Failure: off-kilter",
    "Success: off-kilter until the start",
    "Critical success: no effect"
  ];
  for (let degree = 0; degree <= 3; degree++) {
    const f = await harryFixture({ dc: 20 });
    native(f.target, "will", degree);
    let calls = 0;
    foundry.applications.api.DialogV2.prompt = async () => (calls++ ? String(degree) : { target: f.target.uuid });
    await f.run();
    assert.ok([...game.messages.values()][0].content.includes(expected[degree]));
  }
});
test("Harry refuses target changes after selection without card or native roll", async () => {
  const f = await harryFixture({ dc: 20 });
  let calls = 0;
  native(f.target, "will", 2);
  f.target.saves.will.check.roll = async () => {
    calls++;
    return { total: 22, degreeOfSuccess: 2 };
  };
  foundry.applications.api.DialogV2.prompt = async () => {
    f.target.flags["sf2e-tactical-starship-combat"].starship.will = 2;
    return { target: f.target.uuid };
  };
  await assert.rejects(f.run());
  assert.equal(calls, 0);
  assert.equal(game.messages.size, 0);
});
test("failed save remains pending and GM cancellation retains the progress card", async () => {
  const f = await guidedFixture();
  f.a.saves.reflex.check.roll = async () => {
    throw new Error("ambiguous outcome");
  };
  foundry.applications.api.DialogV2.prompt = async () => null;
  await guidedMineResolution(f.args);
  const msg = [...game.messages.values()][0];
  assert.match(msg.content, /Save unavailable or uncertain/);
  assert.match(msg.content, /check before retrying/);
  assert.match(msg.content, /No HP\/SP/);
});
test("manual Intercept rejects full receipt store without eviction", async () => {
  const { markManualIntercept } = await import("../../scripts/actions/intercept-manual.mjs");
  const receipts = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`id${i}`, `receipt${i}`]));
  const data = {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op" }],
    drones: [{ id: "d", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true, tscInterceptReceipts: receipts }]
  };
  const before = structuredClone(data);
  assert.throws(() =>
    markManualIntercept(data, {
      stationId: "s",
      droneId: "d",
      operatorUuid: "Actor.op",
      combatId: "c",
      interceptId: "newid",
      strikeRef: "strike"
    })
  );
  assert.deepEqual(data, before);
});

test("guided mine path is reachable from existing dialog and uses one private card", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const operator = makeCharacter({ id: "operator", name: "Operator" });
  operator.system.details = { level: { value: 3 } };
  operator.classDC = { dc: { value: 20 } };
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "s", type: "drone-console", grade: "commercial", helmedBy: operator.uuid }],
    crew: [{ actorUuid: operator.uuid, role: "crew", stationId: "s" }]
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 3 }] });
  const { patchStarship } = await import("../../scripts/starship/starship-state.mjs");
  await patchStarship(
    ship,
    (d) => {
      d.drones = [
        {
          id: "d",
          stationId: "s",
          tscVersion: 1,
          ref: "pyrotechnics-drone",
          deployed: true,
          mines: [{ id: "m", droneId: "d", shipUuid: ship.uuid, operatorUuid: operator.uuid, combatId: combat.id, zone: 3, state: "armed" }]
        }
      ];
    },
    { history: false }
  );
  const { prepareMineDetonation } = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  let calls = 0;
  foundry.applications.api.DialogV2.prompt = async () => (calls++ === 0 ? { type: "fire", guided: true } : { damage: "", degrees: ["1"] });
  const writes = globalThis.__writes.length;
  await prepareMineDetonation.call({ document: ship }, null, { dataset: { stationId: "s", droneId: "d", mineId: "m" } });
  assert.equal(calls, 2);
  assert.equal(game.messages.size, 1);
  assert.equal(globalThis.__writes.length, writes);
  assert.deepEqual([...game.messages.values()][0].whisper, ["gm"]);
});

test("new guided rolls reject a non-active GM before creating a card", async () => {
  const { MockUser } = await import("../helpers/foundry-mock.mjs");
  const f = await guidedFixture();
  const other = new MockUser({ id: "gm2", name: "Other GM", isGM: true });
  game.users.set(other.id, other);
  game.user = other;
  await assert.rejects(guidedMineResolution(f.args));
  assert.equal(game.messages.size, 0);
});
