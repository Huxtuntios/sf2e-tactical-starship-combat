import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat, dice } from "../helpers/foundry-mock.mjs";
import { readStarship, patchStarship } from "../../scripts/starship/starship-state.mjs";
import { executeAction, registerActionHandlers } from "../../scripts/actions/action-engine.mjs";
import { actionsForStation } from "../../scripts/content/loader.mjs";
import { historyEntries } from "../../scripts/history/history.mjs";
import { dispatchSocketMessage } from "../../scripts/socket.mjs";

async function setup({ degree = 2, rank = 4 } = {}) {
  installFoundryMock();
  const content = await loadContentFromDisk();
  content.drones = JSON.parse(readFileSync("data/equipment/misc.json", "utf8")).drones;
  const crew = makeCharacter({ id: "pilot", name: "Pilot", owners: ["p1"] });
  let calls = 0;
  const args = [];
  crew.skills = {
    crafting: {
      rank,
      check: {
        roll: async (options) => {
          calls++;
          args.push(options);
          return { degreeOfSuccess: degree, total: 25 };
        }
      }
    }
  };
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    hp: 40,
    sp: 10,
    owners: ["p1"],
    stations: [{ id: "console", type: "drone-console", grade: "commercial", helmedBy: crew.uuid }],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "console" }],
    extra: {
      drones: [{ id: "d1", ref: "repair-drone", stationId: "console", tscVersion: 1, deployed: true, oldField: "preserved" }],
      otherOldField: { value: 3 }
    }
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 3 }] });
  await patchStarship(
    ship,
    (d) => {
      d.hp.value = 10;
    },
    { history: false }
  );
  const request = {
    shipUuid: ship.uuid,
    crewUuid: crew.uuid,
    stationId: "console",
    actionId: "repair-hull-drone",
    options: { repairId: "repair-test0001" },
    user: game.users.get("p1")
  };
  return { crew, ship, combat, request, args, calls: () => calls };
}

for (const [degree, expectedHp, expectedSp, diceValues] of [
  [0, 10, 6, [4]],
  [1, 10, 10, []],
  [2, 14, 10, [4]],
  [3, 17, 10, [3, 4]]
]) {
  test(`Repair Hull: degree ${degree} applies only its own result and one card`, async () => {
    const { ship, request, args, calls } = await setup({ degree });
    dice(...diceValues);
    const result = await executeAction(request);
    assert.equal(result.degree, degree);
    assert.deepEqual([readStarship(ship).hp.value, readStarship(ship).sp.value], [expectedHp, expectedSp]);
    assert.equal(calls(), 1);
    assert.deepEqual(args[0].dc, { value: 15 });
    assert.equal(args[0].createMessage, false);
    assert.equal(args[0].action, "repair-hull");
    assert.equal(game.messages.size, 1);
    assert.equal(historyEntries(ship.uuid).length, degree === 1 ? 0 : 1);
    assert.equal(readStarship(ship).drones[0].oldField, "preserved");
    assert.deepEqual(readStarship(ship).otherOldField, { value: 3 });
    if (degree !== 1) assert.equal(historyEntries(ship.uuid)[0].flags["sf2e-tactical-starship-combat"].history.undoable, false);
  });
}

test("Repair Hull tiers use exact DC and bonus only on a success", async () => {
  for (const [choice, rank, dc, bonus] of [
    [0, 2, 20, 10],
    [1, 3, 30, 30],
    [2, 4, 40, 50]
  ]) {
    const { ship, request, args } = await setup({ degree: 2, rank });
    await patchStarship(
      ship,
      (d) => {
        d.hp.max = 100;
      },
      { history: false }
    );
    dice(3);
    await executeAction({ ...request, options: { ...request.options, dcChoice: choice } });
    assert.equal(args[0].dc.value, dc);
    assert.equal(readStarship(ship).hp.value, 13 + bonus);
  }
  const { ship, request } = await setup({ degree: 0, rank: 4 });
  dice(2);
  await executeAction({ ...request, options: { ...request.options, dcChoice: 2 } });
  assert.equal(readStarship(ship).sp.value, 8);
});

test("Repair Hull receipt prevents duplicate roll, chat, history and application after later changes", async () => {
  const { ship, request, calls } = await setup();
  dice(3);
  const both = await Promise.all([executeAction(request), executeAction(request)]);
  assert.deepEqual(
    both.map((x) => x.replayed),
    [false, true]
  );
  assert.equal(calls(), 1);
  await patchStarship(
    ship,
    (d) => {
      d.hp.value = 5;
    },
    { history: false }
  );
  const writes = globalThis.__writes.length,
    messages = game.messages.size,
    history = historyEntries(ship.uuid).length;
  assert.equal((await executeAction(request)).replayed, true);
  assert.equal(readStarship(ship).hp.value, 5);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
  assert.equal(historyEntries(ship.uuid).length, history);
  await assert.rejects(executeAction({ ...request, options: { ...request.options, dcChoice: 0 } }));
  assert.equal(calls(), 1);
});

test("Repair Hull only appears for a deployed repair drone", async () => {
  const { ship } = await setup();
  const data = readStarship(ship);
  const has = (d) =>
    actionsForStation("drone-console", "commercial", () => 0, { data: d, station: d.stations[0] }).some(
      (a) => a.id === "repair-hull-drone"
    );
  assert.equal(has(data), true);
  assert.equal(has({ ...data, drones: [{ ...data.drones[0], deployed: false }] }), false);
});

test("Repair Hull rejects unauthorized, ambiguous, missing, stale, bad input or unqualified requests before rolling", async () => {
  const cases = [
    ({ request }) => {
      request.user = game.users.get("p2");
    },
    ({ request }) => {
      request.options.targetKey = "Actor.other";
    },
    ({ request }) => {
      request.options.repairId = "invalid";
    },
    ({ request }) => {
      request.options.dcChoice = 8;
    },
    ({ request, crew }) => {
      request.options.dcChoice = 0;
      crew.skills.crafting.rank = 1;
    },
    ({ crew }) => {
      delete crew.skills.crafting.check;
    },
    ({ ship }) => {
      ship.flags["sf2e-tactical-starship-combat"].starship.drones[0].deployed = false;
    },
    ({ ship }) => {
      ship.flags["sf2e-tactical-starship-combat"].starship.drones.push({
        ...ship.flags["sf2e-tactical-starship-combat"].starship.drones[0]
      });
    },
    ({ ship }) => {
      ship.flags["sf2e-tactical-starship-combat"].starship.stations.push({
        ...ship.flags["sf2e-tactical-starship-combat"].starship.stations[0]
      });
    },
    ({ ship }) => {
      ship.flags["sf2e-tactical-starship-combat"].starship.stations[0].malfunctioning = true;
    },
    ({ ship }) => {
      ship.flags["sf2e-tactical-starship-combat"].starship.droneRepairReceipts = [];
    },
    ({ combat }) => {
      combat.flags["sf2e-tactical-starship-combat"].tsc.objects = [];
    }
  ];
  for (const change of cases) {
    const f = await setup();
    change(f);
    const before = structuredClone(readStarship(f.ship)),
      writes = globalThis.__writes.length,
      messages = game.messages.size,
      history = historyEntries(f.ship.uuid).length;
    await assert.rejects(executeAction(f.request));
    assert.deepEqual(readStarship(f.ship), before);
    assert.equal(globalThis.__writes.length, writes);
    assert.equal(game.messages.size, messages);
    assert.equal(historyEntries(f.ship.uuid).length, history);
    assert.equal(f.calls(), 0);
  }
});

test("Repair Hull rejects native failure or missing degree without a fallback roll or write", async () => {
  for (const run of [
    async () => {
      throw new Error("native failed");
    },
    async () => null,
    async () => ({ total: 20, degreeOfSuccess: null })
  ]) {
    const f = await setup();
    f.crew.skills.crafting.check.roll = run;
    const before = structuredClone(readStarship(f.ship)),
      writes = globalThis.__writes.length;
    await assert.rejects(executeAction(f.request));
    assert.deepEqual(readStarship(f.ship), before);
    assert.equal(globalThis.__writes.length, writes);
    assert.equal(game.messages.size, 0);
    assert.equal(historyEntries(f.ship.uuid).length, 0);
  }
});

test("Repair Hull refuses a ship changed externally during the check without overwriting it", async () => {
  const f = await setup();
  f.crew.skills.crafting.check.roll = async () => {
    await f.ship.update({ "system.attributes.hp.value": 8 });
    return { total: 25, degreeOfSuccess: 2 };
  };
  dice(4);
  await assert.rejects(executeAction(f.request));
  assert.equal(readStarship(f.ship).hp.value, 8);
  assert.equal(readStarship(f.ship).droneRepairReceipts, undefined);
  assert.equal(game.messages.size, 0);
  assert.equal(historyEntries(f.ship.uuid).length, 0);
});

test("Repair Hull failed Actor save never posts, records or cleans up initiative", async () => {
  const f = await setup({ degree: 3 });
  const oldUpdate = f.ship.update;
  f.ship.update = async () => {
    throw new Error("write failed");
  };
  dice(2, 3);
  try {
    await assert.rejects(executeAction(f.request));
    assert.equal(readStarship(f.ship).hp.value, 10);
    assert.equal(game.messages.size, 0);
    assert.equal(historyEntries(f.ship.uuid).length, 0);
  } finally {
    f.ship.update = oldUpdate;
  }
});

test("Repair Hull coalesces identical authenticated socket packets", async () => {
  const f = await setup();
  registerActionHandlers();
  dice(2);
  const send = async () => {
    let reply;
    await dispatchSocketMessage({ kind: "request", type: "executeAction", requestId: "transport-repair-1", payload: f.request }, "p1", {
      users: game.users,
      selfId: "gm",
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (r) => {
        reply = r;
      }
    });
    return reply;
  };
  const results = await Promise.all([send(), send()]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(f.calls(), 1);
  assert.equal(readStarship(f.ship).hp.value, 12);
  assert.equal(game.messages.size, 1);
});

test("Repair Hull applies the station-scoped check modifier through the native statistic once", async () => {
  const f = await setup();
  const seen = [];
  await f.combat.createEmbeddedDocuments("Combatant", [{ _id: "anchor", actorId: f.crew.id, initiative: 20 }]);
  f.combat.turn = 0;
  game.pf2e.Modifier = class {
    constructor(data) {
      Object.assign(this, data);
    }
  };
  const original = f.crew.skills.crafting;
  original.clone = ({ modifiers }) => {
    seen.push(...modifiers);
    return original;
  };
  await patchStarship(
    f.ship,
    (d) => {
      d.effects = [
        {
          id: "boost1",
          slug: "boost-battle-station",
          station: "console",
          timing: { combatId: f.combat.id, combatantId: "anchor", round: 2 },
          modifiers: [{ selector: "station-check", type: "status", value: 1, label: "Boost" }]
        },
        {
          id: "boost2",
          slug: "boost-battle-station",
          station: "other",
          timing: { combatId: f.combat.id, combatantId: "anchor", round: 2 },
          modifiers: [{ selector: "station-check", type: "status", value: 9, label: "Other" }]
        }
      ];
    },
    { history: false }
  );
  dice(1);
  await executeAction(f.request);
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].label, seen[0].modifier, seen[0].type], ["Boost", 1, "status"]);
  assert.match(game.messages.contents[0].content, /Boost/);
});

test("Repair Hull refuses an applicable modifier when the native modifier adapter is unavailable", async () => {
  const f = await setup();
  await f.combat.createEmbeddedDocuments("Combatant", [{ _id: "anchor", actorId: f.crew.id, initiative: 20 }]);
  f.combat.turn = 0;
  await patchStarship(
    f.ship,
    (d) => {
      d.effects = [
        {
          id: "boost",
          slug: "boost-battle-station",
          station: "console",
          timing: { combatId: f.combat.id, combatantId: "anchor", round: 2 },
          modifiers: [{ selector: "station-check", type: "status", value: 1 }]
        }
      ];
    },
    { history: false }
  );
  const before = structuredClone(readStarship(f.ship)),
    writes = globalThis.__writes.length;
  await assert.rejects(executeAction(f.request));
  assert.equal(f.calls(), 0);
  assert.deepEqual(readStarship(f.ship), before);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, 0);
});

test("Repair Hull detects combat changes during the check", async () => {
  const f = await setup();
  f.crew.skills.crafting.check.roll = async () => {
    f.combat.round++;
    return { total: 20, degreeOfSuccess: 2 };
  };
  dice(1);
  await assert.rejects(executeAction(f.request));
  assert.equal(readStarship(f.ship).hp.value, 10);
  assert.equal(readStarship(f.ship).droneRepairReceipts, undefined);
  assert.equal(game.messages.size, 0);
});

test("Repair Hull follows saved hull restoration with initiative cleanup and does not reroll if cleanup fails", async () => {
  const f = await setup();
  await patchStarship(
    f.ship,
    (d) => {
      d.hp.value = 0;
      d.compromised = 1;
      d.inoperable = true;
    },
    { history: false }
  );
  const { Initiative } = await import("../../scripts/combat/initiative.mjs");
  const old = Initiative.leaveCompromised,
    oldWarn = ui.notifications.warn;
  let warnings = 0,
    cleanups = 0;
  ui.notifications.warn = () => {
    warnings++;
  };
  Initiative.leaveCompromised = async () => {
    cleanups++;
    assert.equal(readStarship(f.ship).hp.value, 2);
    throw new Error("cleanup failed");
  };
  dice(2);
  try {
    const result = await executeAction(f.request);
    assert.equal(result.changed, true);
    assert.equal(cleanups, 1);
    assert.equal(warnings, 1);
    assert.equal(game.messages.size, 1);
    assert.equal((await executeAction(f.request)).replayed, true);
    assert.equal(f.calls(), 1);
    assert.equal(cleanups, 1);
  } finally {
    Initiative.leaveCompromised = old;
    ui.notifications.warn = oldWarn;
  }
});

test("Repair Hull UI offers its own-ship limitation and DC, supports cancellation, then executes", async () => {
  const f = await setup({ rank: 2 });
  await patchStarship(
    f.ship,
    (d) => {
      d.hp.max = 100;
    },
    { history: false }
  );
  registerActionHandlers();
  const { runAction } = await import("../../scripts/ui/action-runner.mjs");
  const { getAction } = await import("../../scripts/content/loader.mjs");
  const action = getAction("repair-hull-drone");
  const ctx = { ship: f.ship, crew: f.crew, station: readStarship(f.ship).stations[0] };
  foundry.utils.flattenObject = (value) => value;
  let displayed = "";
  foundry.applications.api.DialogV2.prompt = async (p) => {
    displayed = p.content;
    return null;
  };
  await runAction(action, ctx);
  assert.match(displayed, /own ship/);
  assert.match(displayed, /20/);
  assert.equal(f.calls(), 0);
  assert.equal(game.messages.size, 0);
  foundry.applications.api.DialogV2.prompt = async () => ({ dcChoice: "0" });
  dice(3);
  await runAction(action, ctx);
  assert.equal(f.calls(), 1);
  assert.equal(readStarship(f.ship).hp.value, 23);
  assert.equal(Object.keys(readStarship(f.ship).droneRepairReceipts).length, 1);
  assert.equal(game.messages.size, 1);
});

test("Repair Hull refuses invalid tier and full durable receipt map without a roll", async () => {
  for (const mode of ["negative", "full"]) {
    const f = await setup();
    if (mode === "negative") f.request.options.dcChoice = -1;
    else
      await patchStarship(
        f.ship,
        (d) => {
          d.droneRepairReceipts = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`old${i}`, "old"]));
        },
        { history: false }
      );
    const writes = globalThis.__writes.length;
    await assert.rejects(executeAction(f.request));
    assert.equal(f.calls(), 0);
    assert.equal(globalThis.__writes.length, writes);
    assert.equal(game.messages.size, 0);
  }
});

test("Every proficiency tier preserves each degree outcome and excludes bonuses on failure", async () => {
  for (const [choice, dc, bonus] of [
    [0, 20, 10],
    [1, 30, 30],
    [2, 40, 50]
  ]) {
    for (const degree of [0, 1, 2, 3]) {
      const f = await setup({ degree, rank: 4 });
      await patchStarship(
        f.ship,
        (d) => {
          d.hp.max = 100;
        },
        { history: false }
      );
      if (degree === 3) dice(2, 3);
      else if (degree !== 1) dice(2);
      const result = await executeAction({ ...f.request, options: { ...f.request.options, dcChoice: choice } });
      assert.equal(result.degree, degree);
      assert.equal(f.args[0].dc.value, dc);
      assert.equal(readStarship(f.ship).hp.value, degree === 3 ? 15 + bonus : degree === 2 ? 12 + bonus : 10);
      assert.equal(readStarship(f.ship).sp.value, degree === 0 ? 8 : 10);
    }
  }
});
