import test from "node:test";
import assert from "node:assert/strict";
import { makeShip, makeCharacter, loadContentFromDisk } from "../helpers/foundry-mock.mjs";
import { installNativeEffectsFixture, nativeActor } from "../helpers/native-effects-fixture.mjs";
import { dispatchSocketMessage } from "../../scripts/socket.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { effectModifiers } from "../../scripts/starship/effects.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { registerEffectHandlers } from "../../scripts/starship/effect-service.mjs";
const service = await import("../../scripts/starship/application-service.mjs").catch(() => ({}));
const effectError = (key) => (err) => err.message.startsWith(game.i18n.localize(`SF2eTSC.effects.errors.${key}`));

async function setup() {
  installNativeEffectsFixture();
  await loadContentFromDisk();
  const pc = nativeActor(makeCharacter({ id: "pc", name: "Pilot" }));
  const gunner = nativeActor(makeCharacter({ id: "gunner", name: "Gunner" }));
  const foreign = nativeActor(makeCharacter({ id: "stranger", name: "Stranger" }));
  const ship = nativeActor(
    makeShip({
      id: "ship",
      name: "Ship",
      crew: [
        { actorUuid: pc.uuid, role: "crew" },
        { actorUuid: gunner.uuid, role: "crew" }
      ],
      stations: [
        { id: "pilot", type: "pilot", grade: "commercial", helmedBy: pc.uuid },
        { id: "gun", type: "gunnery", grade: "commercial", helmedBy: gunner.uuid }
      ],
      weapons: [{ id: "laser", name: "Laser", stationId: "gun" }]
    })
  );
  if (service.registerApplicationService) service.registerApplicationService();
  return { pc, gunner, foreign, ship };
}
const input = (extra = {}) => ({ operationId: "op-1", kind: "condition", slug: "frightened", conditionValue: 2, ...extra });
async function invoke(type, payload, sender = "gm") {
  let result;
  await dispatchSocketMessage({ kind: "request", type, requestId: "request", payload, userId: "gm" }, sender, {
    users: game.users,
    selfId: "gm",
    isActiveGM: true,
    clientEvents: new Map(),
    emit: (response) => {
      result = response;
    }
  });
  return result;
}

test("catalog uses installed actions and weapons and only crew registry/assignments", async () => {
  assert.equal(typeof service.getEffectTargetCatalog, "function");
  const { ship, pc, gunner, foreign } = await setup();
  const catalog = service.getEffectTargetCatalog(ship);
  assert.deepEqual(catalog.crew.map((c) => c.uuid).sort(), [pc.uuid, gunner.uuid].sort());
  assert.equal(
    catalog.crew.some((c) => c.uuid === foreign.uuid),
    false
  );
  assert.equal(
    catalog.stations.find((s) => s.id === "pilot").actions.some((a) => a.id === "evade"),
    true
  );
  assert.deepEqual(catalog.weapons, [{ id: "laser", label: "Laser" }]);
  assert.equal(catalog.weaponDefensesSupported, false);
});
test("authenticated player cannot apply effects even with spoofed GM body", async () => {
  assert.equal(typeof service.registerApplicationService, "function");
  const { ship } = await setup();
  const response = await invoke("applyManualEffect", { shipUuid: ship.uuid, input: input() }, "p1");
  assert.equal(response.ok, false);
  assert.equal(response.error, game.i18n.localize("SF2eTSC.effects.errors.gmOnly"));
  assert.equal(readStarship(ship).effects.length, 0);
});
test("default entire ship application has native-derived condition values and preserves applications", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input());
  assert.equal(result.status, "applied");
  const first = readStarship(ship).effects[0];
  assert.equal(first.manual, true);
  assert.equal(first.targets.entire, true);
  assert.equal(first.conditionValue, 2);
  assert.equal(effectModifiers([first], "reflex", { actor: ship })[0].value, -2);
  await service.applyManualEffect(ship.uuid, input({ operationId: "op-2", conditionValue: 3 }));
  assert.equal(readStarship(ship).effects.length, 2);
  assert.equal(pc.items.size, 0);
});
test("empty, stale, incompatible and unsafe numeric/persistent targets reject before writes", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship } = await setup();
  for (const extra of [
    { targets: { entire: false } },
    { targets: { entire: false, stations: ["deleted"] } },
    { targets: { entire: false, actions: [{ stationId: "pilot", actionId: "not-installed" }] } },
    { targets: { entire: false, weapons: ["deleted"] } },
    { targets: { entire: false, crew: ["Actor.stranger"] } },
    { targets: { entire: false, weaponDefenses: true } },
    { slug: "unconscious", ignoreImmunities: true },
    { slug: "persistent-damage", conditionValue: null, targets: { entire: false, crew: ["Actor.pc"] } },
    { kind: "bonus", modifiers: [{ selector: "ac", value: 2, type: "invented" }] },
    { kind: "bonus", modifiers: [{ selector: "ac", value: "2", type: "status" }] },
    { kind: "persistent-damage", persistent: { formula: "1d6;fetch('x')", damageType: "fire", dc: 15 } }
  ])
    await assert.rejects(service.applyManualEffect(ship.uuid, input(extra)));
  assert.equal(readStarship(ship).effects.length, 0);
  assert.equal(globalThis.__writes.length, 0);
});
test("duplicate operations cannot double records/native Items and changed replay rejects", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc } = await setup();
  const config = input({ targets: { entire: false, crew: [pc.uuid] } });
  const [a, b] = await Promise.all([service.applyManualEffect(ship.uuid, config), service.applyManualEffect(ship.uuid, config)]);
  assert.equal(a.applicationId, b.applicationId);
  assert.equal(pc.items.size, 1);
  assert.equal(readStarship(ship).effects.length, 1);
  await assert.rejects(service.applyManualEffect(ship.uuid, { ...config, conditionValue: 3 }), effectError("operationConflict"));
  await service.removeManualEffect(ship.uuid, a.applicationId);
  const replay = await service.applyManualEffect(ship.uuid, config);
  assert.equal(replay.status, "removed");
  assert.equal(pc.items.size, 0);
});
test("allCrew plus specific target dedups; exact removal survives reassignment and preserves foreign Items", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc, gunner, foreign } = await setup();
  const foreignItem = (
    await pc.createEmbeddedDocuments("Item", [{ type: "condition", name: "Foreign", system: { slug: "frightened", value: { value: 1 } } }])
  )[0];
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, allCrew: true, crew: [pc.uuid] } }));
  assert.equal(pc.items.size, 2);
  assert.equal(gunner.items.size, 1);
  assert.equal(foreign.items.size, 0);
  const record = readStarship(ship).effects[0];
  assert.equal(record.nativeTargets.length, 2);
  assert.equal(effectModifiers([record], "ac", { actor: ship }).length, 0);
  ship.flags[MODULE_ID].starship.crew = [];
  ship.flags[MODULE_ID].starship.stations = [];
  await service.removeManualEffect(ship.uuid, result.applicationId);
  assert.equal(pc.items.size, 1);
  assert.equal(pc.items.has(foreignItem.id), true);
  assert.equal(gunner.items.size, 0);
});
test("native rejection reports each rejected target and retains successful crew", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc, gunner } = await setup();
  nativeActor(gunner, { immune: ["frightened"] });
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, allCrew: true } }));
  assert.equal(result.status, "partial");
  assert.equal(result.nativeTargets.length, 1);
  assert.equal(result.rejectedTargets[0].actorUuid, gunner.uuid);
  assert.equal(result.rejectedTargets[0].label, "Gunner");
  assert.equal(pc.items.size, 1);
  assert.equal(gunner.items.size, 0);
});
test("native handles are durable before native creation and survive final save failure", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc } = await setup();
  const update = ship.update.bind(ship);
  let saves = 0;
  ship.update = async (...args) => {
    if (++saves > 1) throw new Error("save failure");
    return update(...args);
  };
  await assert.rejects(service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } })), /save failure/);
  const durable = readStarship(ship).effects[0];
  assert.equal(durable.nativeTargets.length, 1);
  assert.equal(pc.items.has(durable.nativeTargets[0].itemId), true);
  ship.update = update;
  await service.removeManualEffect(ship.uuid, durable.id);
  assert.equal(pc.items.size, 0);
});
test("snapshot preserves original target labels and handles after crew removal", async () => {
  const { ship, pc } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } }));
  pc.name = "Renamed";
  ship.flags[MODULE_ID].starship.crew = [];
  const record = readStarship(ship).effects.find((e) => e.id === result.applicationId);
  assert.deepEqual(record.targetSnapshot?.crew, [{ uuid: pc.uuid, label: "Pilot" }]);
});
test("existing Complete timing command removes manual native Items as well as the application", async () => {
  const { ship, pc } = await setup();
  registerEffectHandlers();
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } }));
  const response = await invoke("effectTiming", { shipUuid: ship.uuid, effectId: result.applicationId, op: "complete" });
  assert.equal(response.ok, true);
  assert.equal(pc.items.size, 0);
  assert.equal(readStarship(ship).effects.length, 0);
});
test("numeric crew check and DC configuration uses actual native domains before writes", async () => {
  const { ship, pc } = await setup();
  pc.saves = {
    reflex: {
      slug: "reflex",
      domains: ["all", "reflex", "saving-throw"],
      check: { domains: ["all", "reflex", "saving-throw", "check", "reflex-check"] },
      dc: { domains: ["all", "reflex", "saving-throw", "reflex-dc"] }
    }
  };
  pc.getStatistic = (slug) => pc.saves[slug];
  const result = await service.applyManualEffect(
    ship.uuid,
    input({
      kind: "bonus",
      statistic: "check",
      modifiers: [{ selector: "reflex", type: "status", value: 2 }],
      targets: { entire: false, crew: [pc.uuid] }
    })
  );
  const item = pc.items.get(result.nativeTargets[0].itemId);
  assert.deepEqual(item.system.rules[0].selector, ["reflex-check"]);
  await assert.rejects(
    service.applyManualEffect(
      ship.uuid,
      input({
        operationId: "bad",
        kind: "bonus",
        statistic: "dc",
        modifiers: [{ selector: "attack", type: "status", value: 2 }],
        targets: { entire: false, crew: [pc.uuid] }
      })
    ),
    effectError("incompatibleCrewStatistic")
  );
  assert.equal(readStarship(ship).effects.length, 1);
});
test("native condition incompatible with selected ship mechanics is rejected, not visual success", async () => {
  const { ship } = await setup();
  await assert.rejects(
    service.applyManualEffect(
      ship.uuid,
      input({ slug: "off-guard", conditionValue: null, targets: { entire: false, mechanics: ["skills"] } })
    ),
    effectError("incompatibleShipCondition")
  );
  assert.equal(readStarship(ship).effects.length, 0);
});
test("failed crew replay is rejected rather than falsely returning successful operation", async () => {
  const { ship, pc } = await setup();
  nativeActor(pc, { immune: ["frightened"] });
  const config = input({ targets: { entire: false, crew: [pc.uuid] } });
  await assert.rejects(service.applyManualEffect(ship.uuid, config), effectError("nativeRejected"));
  await assert.rejects(service.applyManualEffect(ship.uuid, config), effectError("nativeRejected"));
});
test("maximum valid operation IDs remain removable after application prefix", async () => {
  const { ship } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ operationId: "x".repeat(128) }));
  await service.removeManualEffect(ship.uuid, result.applicationId);
  assert.equal(readStarship(ship).effects.length, 0);
});
test("partial deletion failure retains exact handles and retry does not touch foreign Items", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc, gunner } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, allCrew: true } }));
  const deletion = gunner.deleteEmbeddedDocuments.bind(gunner);
  gunner.deleteEmbeddedDocuments = async () => {
    throw new Error("delete failure");
  };
  await assert.rejects(service.removeManualEffect(ship.uuid, result.applicationId), /Gunner|delete failure/);
  assert.equal(readStarship(ship).effects.length, 1);
  assert.equal(gunner.items.size, 1);
  assert.equal(pc.items.size, 0);
  gunner.deleteEmbeddedDocuments = deletion;
  await service.removeManualEffect(ship.uuid, result.applicationId);
  assert.equal(readStarship(ship).effects.length, 0);
  assert.equal(gunner.items.size, 0);
});

test("persistent effect immunity rejects application without bypassing later damage defenses", async () => {
  const { ship } = await setup();
  ship.flags[MODULE_ID].starship.immunities = ["persistent-damage", "fire"];
  const config = { operationId: "immune-pd", kind: "persistent-damage", persistent: { formula: "1d6", damageType: "fire", dc: 15 } };
  await assert.rejects(service.applyManualEffect(ship.uuid, config), effectError("shipImmune"));
  assert.equal(readStarship(ship).effects.length, 0);
  await service.applyManualEffect(ship.uuid, { ...config, ignoreImmunities: true });
  assert.equal(readStarship(ship).effects.length, 1);
  assert.deepEqual(readStarship(ship).immunities, ["persistent-damage", "fire"]);
});

test("removing a copied application never deletes the original ship's native crew effect", async () => {
  const { ship, pc } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } }));
  const copy = nativeActor(makeShip({ id: "copy", name: "Copy" }));
  copy.flags[MODULE_ID].starship = structuredClone(ship.flags[MODULE_ID].starship);
  await service.removeManualEffect(copy.uuid, result.applicationId);
  assert.equal(pc.items.has(result.nativeTargets[0].itemId), true);
  assert.equal(readStarship(ship).effects.length, 1);
  assert.equal(readStarship(copy).effects.length, 0);
});

test("public API exposes the guarded manual and persistent services", async () => {
  const { ship } = await setup();
  const { buildApi } = await import("../../scripts/api.mjs");
  const api = buildApi();
  for (const key of [
    "applyManualEffect",
    "removeManualEffect",
    "getEffectTargetCatalog",
    "processPersistentDamage",
    "applyPersistentDamage",
    "recoverPersistentDamage"
  ])
    assert.equal(typeof api[key], "function", key);
  const result = await api.applyManualEffect(ship.uuid, input());
  assert.equal(result.status, "applied");
  await api.removeManualEffect(ship.uuid, result.applicationId);
  assert.equal(readStarship(ship).effects.length, 0);
});

test("deleting the source ship cleans linked crew Items through the active-GM hook", { timeout: 2000 }, async () => {
  const { ship, pc } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } }));
  const deletion = pc.deleteEmbeddedDocuments.bind(pc);
  let deleted;
  const completion = new Promise((resolve) => {
    deleted = resolve;
  });
  pc.deleteEmbeddedDocuments = async (...args) => {
    const response = await deletion(...args);
    deleted();
    return response;
  };
  await ship.delete();
  await completion;
  assert.equal(pc.items.has(result.nativeTargets[0].itemId), false);
});

test("source ship cleanup removes only its linked native Items", async () => {
  const { ship, pc } = await setup();
  const foreign = (
    await pc.createEmbeddedDocuments("Item", [{ type: "condition", name: "Foreign", system: { slug: "frightened", value: { value: 1 } } }])
  )[0];
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } }));
  assert.equal(typeof service.cleanupShipEffectTargets, "function");
  await service.cleanupShipEffectTargets(ship);
  assert.equal(pc.items.has(result.nativeTargets[0].itemId), false);
  assert.equal(pc.items.has(foreign.id), true);
});
