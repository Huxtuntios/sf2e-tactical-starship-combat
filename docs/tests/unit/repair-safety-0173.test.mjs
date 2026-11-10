import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

async function setup() {
  installFoundryMock();
  await loadContentFromDisk();
  makeCharacter({ id: "op", name: "Operator", owners: ["p1"] });
  const ship = makeShip({ id: "ship", name: "Ship", hp: 40, sp: 20, crew: [{ actorUuid: "Actor.op", userId: "p1", role: "crew" }] });
  makeStarshipCombat();
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  const { readStarship, patchStarship } = await import("../../scripts/starship/starship-state.mjs");
  const { historyEntries } = await import("../../scripts/history/history.mjs");
  registerShipHandlers();
  const send = async (payload, who = "p1") => {
    let reply;
    await dispatchSocketMessage(
      { kind: "request", type: "gmRepair", requestId: "repair", payload: { shipUuid: ship.uuid, ...payload } },
      who,
      {
        users: game.users,
        selfId: "gm",
        isActiveGM: true,
        clientEvents: new Map(),
        emit: (r) => {
          reply = r;
        }
      }
    );
    return reply;
  };
  return { ship, readStarship, patchStarship, historyEntries, send };
}

test("repair validates all amounts and flags before any Actor write", async () => {
  const { ship, readStarship, patchStarship, historyEntries, send } = await setup();
  await patchStarship(
    ship,
    (d) => {
      d.hp.value = 10;
      d.sp.value = 5;
    },
    { history: false }
  );
  const before = structuredClone(readStarship(ship)),
    writes = globalThis.__writes.length,
    messages = game.messages.size,
    history = historyEntries(ship.uuid).length;
  for (const payload of [
    { hp: -1 },
    { sp: -1 },
    { hp: "5" },
    { hp: 1.5 },
    { sp: NaN },
    { hp: Infinity },
    { hp: Number.MAX_SAFE_INTEGER + 1 },
    { hp: 2, sp: -1 },
    { hp: 2, clearMalfunctions: "false" }
  ])
    assert.equal((await send(payload)).ok, false);
  assert.deepEqual(readStarship(ship), before);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
  assert.equal(historyEntries(ship.uuid).length, history);
  assert.equal((await send({ hp: 0, sp: 0 })).ok, true);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal((await send({ hp: 5, sp: 4 })).ok, true);
  assert.deepEqual([readStarship(ship).hp.value, readStarship(ship).sp.value], [15, 9]);
});

test("failed Actor save does not remove compromised initiative", async () => {
  const { ship, patchStarship, send } = await setup();
  await patchStarship(
    ship,
    (d) => {
      d.hp.value = 0;
      d.compromised = 1;
      d.inoperable = true;
    },
    { history: false }
  );
  const { Initiative } = await import("../../scripts/combat/initiative.mjs");
  const oldLeave = Initiative.leaveCompromised,
    oldUpdate = ship.update;
  let called = 0;
  Initiative.leaveCompromised = async () => {
    called++;
  };
  ship.update = async () => {
    throw new Error("save failed");
  };
  try {
    assert.equal((await send({ hp: 5 })).ok, false);
    assert.equal(called, 0);
  } finally {
    Initiative.leaveCompromised = oldLeave;
    ship.update = oldUpdate;
  }
});

test("repair rechecks permissions after waiting in the ship queue", async () => {
  const { ship, readStarship, patchStarship, historyEntries, send } = await setup();
  await patchStarship(
    ship,
    (d) => {
      d.hp.value = 10;
    },
    { history: false }
  );
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const revocation = patchStarship(
    ship,
    async (d) => {
      entered();
      await gate;
      d.crew = [];
    },
    { history: false }
  );
  await started;
  const repair = send({ hp: 5 });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await revocation;
  const writes = globalThis.__writes.length;
  const messages = game.messages.size;
  const history = historyEntries(ship.uuid).length;
  const reply = await repair;
  assert.equal(reply.ok, false);
  assert.equal(readStarship(ship).hp.value, 10);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
  assert.equal(historyEntries(ship.uuid).length, history);
});

test("initiative cleanup happens only after repair saves; failure does not report a failed repair", async () => {
  const { ship, readStarship, patchStarship, send } = await setup();
  await patchStarship(
    ship,
    (d) => {
      d.hp.value = 0;
      d.compromised = 1;
      d.inoperable = true;
    },
    { history: false }
  );
  const { Initiative } = await import("../../scripts/combat/initiative.mjs");
  const oldLeave = Initiative.leaveCompromised;
  const oldWarn = ui.notifications.warn;
  let warned = false;
  Initiative.leaveCompromised = async () => {
    assert.equal(readStarship(ship).hp.value, 5);
    throw new Error("initiative update failed");
  };
  ui.notifications.warn = () => {
    warned = true;
  };
  try {
    assert.equal((await send({ hp: 5 })).ok, true);
    assert.equal(readStarship(ship).hp.value, 5);
    assert.equal(warned, true);
  } finally {
    Initiative.leaveCompromised = oldLeave;
    ui.notifications.warn = oldWarn;
  }
});
