import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeStarshipCombat, MockActor } from "../helpers/foundry-mock.mjs";
import {
  addSensorContact,
  setPrivateContactZone,
  worldHazardChoices,
  importHazardCopy,
  compendiumHazardChoices,
  actorVisibleToPlayers
} from "../../scripts/sensor/contact-service.mjs";
import { defaultStarship } from "../../scripts/engine/validation.mjs";
import { privateContacts } from "../../scripts/sensor/private-contacts.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { contactEditorContext } from "../../scripts/sensor/contact-editor-model.mjs";
import { privacyProbe } from "../../scripts/sensor/privacy-probe.mjs";

// ВНИМАНИЕ: Foundry имитируется. Эти тесты проверяют логику оркестрации, а не приватность в настоящем Foundry.
const MODULE = "sf2e-tactical-starship-combat";
function setup() {
  installFoundryMock();
  return makeStarshipCombat();
}
function hazard(id, name = "Secret hazard", extra = {}) {
  const h = new MockActor({ id, type: "hazard", name, ...extra });
  game.actors.set(h.id, h);
  return h;
}
function starship(id, name = "Enemy ship", role = "npc", extra = {}) {
  const ship = new MockActor({
    id,
    type: role === "player" ? "vehicle" : "npc",
    name,
    flags: { [MODULE]: { starship: { ...defaultStarship(), role } } },
    ...extra
  });
  game.actors.set(ship.id, ship);
  return ship;
}
const text = (combat) => JSON.stringify(combat.flags);

test("world hazard: undetected and hidden stay only in the private store", async () => {
  const combat = setup();
  const h = hazard("h1");
  const r = await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "undetected" });
  assert.notEqual(r.actorUuid, h.uuid);
  assert.equal(fromUuidSync(r.actorUuid).flags[MODULE].tacticalCopyOf, h.uuid);
  assert.equal(privateContacts(combat.id)[0].zone, 4);
  assert.deepEqual(getTsc(combat).objects, []);
  const h2 = hazard("h2", "Other");
  await addSensorContact(combat, { source: "world", uuid: h2.uuid, zone: 5, detection: "hidden" });
  assert.notEqual(privateContacts(combat.id).find((o) => o.actorUuid !== r.actorUuid).actorUuid, h2.uuid);
  assert.equal(privateContacts(combat.id).find((o) => o.actorUuid !== r.actorUuid).detection.party, "hidden");
  assert.deepEqual(getTsc(combat).objects, []);
  assert.equal(text(combat).includes("Secret hazard"), false);
});

test("observed publishes an anonymous marker only; identified can be selected directly", async () => {
  const combat = setup();
  const h = hazard("h1");
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "observed" });
  const marker = getTsc(combat).objects[0];
  assert.deepEqual(Object.keys(marker).sort(), ["detection", "heading", "key", "name", "span", "tscPrivateProjection", "type", "zone"]);
  assert.equal(marker.name, "Contact");
  for (const secret of ["Secret hazard", h.uuid, h.img]) assert.equal(text(combat).includes(secret), false);
  // раскрытие переводит объект в публичный и очищает приватную запись
  const key = privateContacts(combat.id)[0].key;
  const instanceUuid = privateContacts(combat.id)[0].actorUuid;
  const { changePrivateContact } = await import("../../scripts/sensor/private-contacts.mjs");
  await changePrivateContact(combat, key, "reveal");
  assert.equal(getTsc(combat).objects[0].actorUuid, instanceUuid);
  assert.equal(
    combat.combatants.some((c) => c.actorId === fromUuidSync(instanceUuid).id),
    false
  );
  assert.deepEqual(privateContacts(combat.id), []);
});

test("identified placement immediately publishes the Actor selected in the editor", async () => {
  const combat = setup();
  const h = hazard("h1");
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 2, detection: "identified" });
  const o = getTsc(combat).objects[0];
  assert.notEqual(o.actorUuid, h.uuid);
  assert.deepEqual([o.type, o.zone, o.detection.party], ["hazard", 2, "identified"]);
  assert.equal(fromUuidSync(o.actorUuid).flags[MODULE].tacticalCopyOf, h.uuid);
  assert.deepEqual(privateContacts(combat.id), []);
});

test("world Starship Actors use private NPC contacts and identified public Player contacts", async () => {
  const combat = setup();
  const npcShip = starship("npc-ship");
  await addSensorContact(combat, { source: "world", uuid: npcShip.uuid, zone: 3, detection: "hidden" });
  const privateShipUuid = privateContacts(combat.id)[0].actorUuid;
  assert.notEqual(privateShipUuid, npcShip.uuid);
  assert.equal(fromUuidSync(privateShipUuid).flags[MODULE].tacticalCopyOf, npcShip.uuid);
  assert.deepEqual(getTsc(combat).objects, []);
  assert.equal(
    (combat.combatants ?? []).some((c) => c.actorId === fromUuidSync(privateShipUuid).id),
    false
  );

  const playerShip = starship("player-ship", "Party ship", "player", { owners: ["p1"] });
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: playerShip.uuid, zone: 2, detection: "observed" }));
  await addSensorContact(combat, {
    source: "world",
    uuid: playerShip.uuid,
    zone: 2,
    detection: "identified"
  });
  const publicShipUuid = getTsc(combat).objects[0].actorUuid;
  assert.notEqual(publicShipUuid, playerShip.uuid);
  assert.equal(
    (combat.combatants ?? []).some((c) => c.actorId === fromUuidSync(publicShipUuid).id),
    false
  );
});

test("an Actor already visible to players can only be placed as identified", async () => {
  const combat = setup();
  const h = hazard("h1", "Known hazard", { owners: ["p1"] });
  assert.equal(actorVisibleToPlayers(h), true);
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 3, detection: "undetected" }));
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 3, detection: "observed" }));
  assert.deepEqual(getTsc(combat).objects, []);
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 3, detection: "identified" });
  assert.notEqual(getTsc(combat).objects[0].actorUuid, h.uuid);
});

test("repeated private NPC placements stay independent, reveal gets initiative, and removal cleans up only that copy", async () => {
  const combat = setup();
  const source = hazard("complex", "Complex hazard", {
    system: { details: { isComplex: true }, attributes: { hp: { value: 18, max: 18 } } }
  });
  const one = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 2, detection: "undetected" });
  const two = await addSensorContact(combat, { source: "world", uuid: source.uuid, zone: 5, detection: "hidden" });
  const first = fromUuidSync(one.actorUuid);
  const second = fromUuidSync(two.actorUuid);
  assert.notEqual(first.uuid, second.uuid);
  assert.equal(first.flags[MODULE].tacticalCopyOf, source.uuid);
  assert.equal(second.flags[MODULE].tacticalCopyOf, source.uuid);
  assert.equal(first.ownership.default, 0);
  assert.equal(second.ownership.default, 0);
  assert.equal(combat.combatants.size, 0);
  assert.deepEqual(getTsc(combat).objects, []);

  await first.update({ "system.attributes.hp.value": 6 });
  assert.equal(second.system.attributes.hp.value, 18);
  assert.equal(source.system.attributes.hp.value, 18);
  assert.equal(game.actors.get(first.id), first);
  assert.equal(privateContacts(combat.id).length, 2);

  const contact = privateContacts(combat.id).find((entry) => entry.actorUuid === first.uuid);
  const { changePrivateContact } = await import("../../scripts/sensor/private-contacts.mjs");
  await changePrivateContact(combat, contact.key, "reveal");
  assert.equal(combat.combatants.filter((c) => c.actorId === first.id).length, 1);
  assert.equal(
    combat.combatants.some((c) => c.actorId === second.id),
    false
  );
  assert.equal(
    getTsc(combat).objects.some((o) => o.actorUuid === first.uuid),
    true
  );

  const { registerSensorHandlers } = await import("../../scripts/sensor/map-handlers.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerSensorHandlers();
  const replies = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (r) => replies.push(r) };
  await dispatchSocketMessage(
    {
      kind: "request",
      type: "sensorUpdate",
      requestId: "remove-first",
      payload: { combatId: combat.id, op: "remove", key: first.uuid }
    },
    "gm",
    env
  );
  assert.equal(replies[0].ok, true);
  assert.equal(game.actors.has(first.id), false);
  assert.equal(
    combat.combatants.some((c) => c.actorId === first.id),
    false
  );
  assert.equal(game.actors.has(second.id), true);
  assert.equal(game.actors.has(source.id), true);
  assert.equal(
    getTsc(combat).objects.some((o) => o.actorUuid === first.uuid),
    false
  );
  const secondContact = privateContacts(combat.id).find((entry) => entry.actorUuid === second.uuid);
  await changePrivateContact(combat, secondContact.key, "remove");
  assert.equal(game.actors.has(second.id), false);
  assert.equal(
    privateContacts(combat.id).some((entry) => entry.actorUuid === second.uuid),
    false
  );
  assert.equal(game.actors.has(source.id), true);
});

test("custom contact without an Actor: placement, zone change, detection and no leakage", async () => {
  const combat = setup();
  const r = await addSensorContact(combat, { source: "custom", name: "Secret anomaly", zone: 6, detection: "undetected" });
  assert.equal(r.actorUuid, null);
  assert.equal(privateContacts(combat.id)[0].name, "Secret anomaly");
  assert.equal(await setPrivateContactZone(combat, r.key, 8), true);
  assert.equal(privateContacts(combat.id)[0].zone, 8);
  await assert.rejects(setPrivateContactZone(combat, r.key, 99));
  await assert.rejects(addSensorContact(combat, { source: "custom", name: "  ", zone: 2, detection: "undetected" }));
  const r2 = await addSensorContact(combat, {
    source: "custom",
    name: "Visible beacon",
    zone: 2,
    detection: "identified"
  });
  assert.equal(getTsc(combat).objects.find((o) => o.key === r2.key).name, "Visible beacon");
  assert.equal(text(combat).includes("Secret anomaly"), false);
});

test("compendium hazard becomes a private world copy per placement; failed placement removes the copy", async () => {
  const combat = setup();
  const source = {
    documentName: "Actor",
    type: "hazard",
    pack: "pf2e.hazards",
    uuid: "Compendium.pf2e.hazards.Actor.abc",
    toObject: () => ({
      _id: "abc",
      name: "Orbital trap",
      type: "hazard",
      folder: "f",
      sort: 5,
      ownership: { default: 2 },
      flags: { other: 1 }
    })
  };
  const created = [];
  const deps = {
    resolve: async () => source,
    createActor: async (data) => {
      assert.equal(data._id, undefined);
      assert.equal(data.folder, undefined);
      assert.deepEqual(data.ownership, { default: 0 });
      const a = new MockActor({ type: data.type, name: data.name, flags: data.flags });
      a.delete = async () => {
        a.deleted = true;
        game.actors.delete(a.id);
      };
      game.actors.set(a.id, a);
      created.push(a);
      return a;
    }
  };
  const copy = await importHazardCopy(source.uuid, deps);
  assert.equal(copy.flags[MODULE].contactImport.sourceUuid, source.uuid);
  assert.equal(copy.flags.other, 1);
  assert.equal(actorVisibleToPlayers(copy), false);
  game.actors.delete(copy.id);
  // два размещения → два независимых документа
  const a = await addSensorContact(combat, { source: "compendium", uuid: source.uuid, zone: 2, detection: "hidden" }, deps);
  const b = await addSensorContact(combat, { source: "compendium", uuid: source.uuid, zone: 2, detection: "hidden" }, deps);
  assert.notEqual(a.actorUuid, b.actorUuid);
  assert.equal(privateContacts(combat.id).length, 2);
  assert.equal(text(combat).includes("Orbital trap"), false);
  // размещение не удалось (копия оказалась видимой игрокам) → копия не остаётся сиротой, приватное хранилище не меняется
  const before = privateContacts(combat.id).length;
  const bad = { ...deps, createActor: async (d) => Object.assign(await deps.createActor(d), { owners: ["p1"] }) };
  await assert.rejects(addSensorContact(combat, { source: "compendium", uuid: source.uuid, zone: 2, detection: "hidden" }, bad));
  assert.equal(created.at(-1).deleted, true);
  assert.equal(privateContacts(combat.id).length, before);
  // не компендий и не опасность
  await assert.rejects(importHazardCopy("Actor.h", { resolve: async () => ({ documentName: "Actor", type: "hazard", pack: null }) }));
});

test("compendium Starship Actor copies are independent and the index exposes them", async () => {
  setup();
  const flags = { [MODULE]: { starship: { ...defaultStarship(), role: "npc" } } };
  const source = {
    documentName: "Actor",
    type: "npc",
    pack: "world.starships",
    uuid: "Compendium.world.starships.Actor.enemy",
    flags,
    toObject: () => ({ _id: "enemy", name: "Enemy ship", type: "npc", flags: structuredClone(flags) })
  };
  const original = JSON.stringify(source.toObject());
  const copy = await importHazardCopy(source.uuid, {
    resolve: async () => source,
    createActor: async (data) => {
      assert.equal(data._id, undefined);
      assert.deepEqual(data.ownership, { default: 0 });
      return new MockActor({ type: data.type, name: data.name, flags: data.flags });
    }
  });
  assert.notEqual(copy.uuid, source.uuid);
  assert.equal(JSON.stringify(source.toObject()), original);
  assert.equal(copy.flags[MODULE].starship.role, "npc");

  game.packs = [
    {
      documentName: "Actor",
      collection: "world.starships",
      metadata: { label: "Starships" },
      getIndex: async ({ fields }) => {
        assert.ok(fields.includes(`flags.${MODULE}.starship.isStarship`));
        return [
          { _id: "enemy", uuid: source.uuid, name: source.name, type: source.type, flags },
          { _id: "ordinary", name: "Ordinary NPC", type: "npc" },
          ...Array.from({ length: 520 }, (_, i) => ({
            _id: `hazard-${i}`,
            name: `Large compendium hazard ${String(i).padStart(3, "0")}`,
            type: "hazard"
          }))
        ];
      }
    }
  ];
  const choices = await compendiumHazardChoices();
  assert.deepEqual(
    choices.filter((choice) => choice.kind === "starship").map((choice) => [choice.uuid, choice.kind, choice.role]),
    [[source.uuid, "starship", "npc"]]
  );
  const last = choices.find((choice) => choice.uuid === "Compendium.world.starships.Actor.hazard-519");
  const context = contactEditorContext({ source: "compendium", uuid: last.uuid }, { zones: 3, world: [], compendium: choices });
  assert.equal(choices.length, 521);
  assert.equal(context.choices.find((choice) => choice.uuid === last.uuid).selected, true);
});

test("input validation and mine-managed actors are rejected", async () => {
  const combat = setup();
  const h = hazard("h1");
  for (const spec of [
    { source: "nope", uuid: h.uuid, zone: 2, detection: "undetected" },
    { source: "world", uuid: h.uuid, zone: 0, detection: "undetected" },
    { source: "world", uuid: h.uuid, zone: 13, detection: "undetected" },
    { source: "world", uuid: h.uuid, zone: 2, detection: "secret" },
    { source: "world", uuid: "Actor.missing", zone: 2, detection: "undetected" }
  ])
    await assert.rejects(addSensorContact(combat, spec));
  const mine = hazard("m1", "Mine", { flags: { [MODULE]: { starshipMine: { mineId: "x" } } } });
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: mine.uuid, zone: 2, detection: "undetected" }));
  assert.deepEqual(
    worldHazardChoices().map((c) => c.uuid),
    [h.uuid]
  );
});

test("editor view model filters and selects a detection state without confirmation fields", () => {
  installFoundryMock();
  const world = [
    { uuid: "Actor.a", name: "Alpha trap", visible: false },
    { uuid: "Actor.b", name: "Beta mine", visible: true }
  ];
  const ctx = contactEditorContext(
    { source: "world", filter: "beta", uuid: "Actor.b", zone: 3, detection: "observed" },
    { zones: 5, world, compendium: [] }
  );
  assert.deepEqual(
    ctx.choices.map((c) => [c.uuid, c.selected]),
    [["Actor.b", true]]
  );
  assert.equal(ctx.zones.length, 5);
  assert.equal(ctx.zones.find((z) => z.selected).id, 3);
  assert.equal(Object.hasOwn(ctx, "needsConfirm"), false);
  assert.equal(Object.hasOwn(ctx, "confirmed"), false);
  assert.equal(contactEditorContext({ source: "custom" }, { zones: 3, world, compendium: [] }).isCustom, true);
});

test("editor view model keeps matching actors beyond 400 results selectable", () => {
  installFoundryMock();
  const world = Array.from({ length: 520 }, (_, i) => ({
    uuid: `Actor.${i}`,
    name: `Hazard ${String(i).padStart(3, "0")}`
  }));
  const selected = world[519];
  const all = contactEditorContext({ source: "world", uuid: selected.uuid }, { zones: 3, world, compendium: [] });
  assert.equal(all.choices.length, 520);
  assert.equal(all.choices.at(-1).uuid, selected.uuid);
  assert.equal(all.choices.at(-1).selected, true);
  const filtered = contactEditorContext({ source: "world", filter: "519", uuid: selected.uuid }, { zones: 3, world, compendium: [] });
  assert.deepEqual(
    filtered.choices.map((choice) => [choice.uuid, choice.selected]),
    [[selected.uuid, true]]
  );
});

test("observed and identify actions apply without confirmation dialogs", async () => {
  const combat = setup();
  const h = hazard("h1");
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "undetected" });
  const contact = privateContacts(combat.id)[0];
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const dialog = foundry.applications.api.DialogV2;
  const confirm = dialog.confirm;
  let confirmations = 0;
  dialog.confirm = async () => {
    confirmations++;
    throw new Error("unexpected confirmation");
  };
  const app = {
    selected: contact.key,
    _privateObjects: [contact],
    render() {}
  };
  try {
    await SensorMapApplication.DEFAULT_OPTIONS.actions.privateDetect.call(
      app,
      {},
      {
        dataset: { key: contact.key, level: "observed" }
      }
    );
    assert.equal(privateContacts(combat.id)[0].detection.party, "observed");
    await SensorMapApplication.DEFAULT_OPTIONS.actions.privateReveal.call(
      app,
      {},
      {
        dataset: { key: contact.key }
      }
    );
  } finally {
    dialog.confirm = confirm;
  }
  assert.equal(confirmations, 0);
  assert.equal(privateContacts(combat.id).length, 0);
  assert.equal(getTsc(combat).objects[0].detection.party, "identified");
});

test("legacy Sensor Map flags and objects survive new contact writes", async () => {
  const combat = setup();
  const flags = combat.flags[MODULE];
  flags.legacySensorData = { oldSchema: true };
  flags.tsc.objects.push({
    key: "legacy-contact",
    type: "custom",
    name: "Old contact",
    zone: 1,
    heading: null,
    span: 1,
    detection: { party: "observed" }
  });
  const legacy = structuredClone(flags.tsc.objects[0]);
  await addSensorContact(combat, { source: "custom", name: "New contact", zone: 2, detection: "identified" });
  assert.deepEqual(combat.flags[MODULE].legacySensorData, { oldSchema: true });
  assert.deepEqual(
    getTsc(combat).objects.find((o) => o.key === legacy.key),
    legacy
  );
});

test("privacy probe reports findings for a player client and never claims 'secure'", async () => {
  const combat = setup();
  const h = hazard("h1");
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "observed" });
  const gm = privacyProbe({ user: game.users.get("gm"), combats: [combat] });
  assert.deepEqual(gm.findings, []);
  assert.equal(gm.counts.anonymousProjections, 1);
  // Имитация утечки: клиент игрока «видит» закрытое хранилище.
  const player = privacyProbe({ user: game.users.get("p1"), combats: [combat] });
  assert.equal(player.note, "FINDINGS");
  assert.ok(player.findings.some((f) => f.code === "private-store-present"));
  assert.ok(player.findings.some((f) => f.code === "private-contacts-readable"));
  // Утечка полей в анонимном маркере.
  combat.flags[MODULE].tsc.objects[0].actorUuid = h.uuid;
  assert.ok(privacyProbe({ user: game.users.get("gm"), combats: [combat] }).findings.some((f) => f.code === "projection-leaks-fields"));
  // Чистый клиент: нет находок, но вердикт не «безопасно».
  // В имитации клиент игрока «держит» актёра без прав: зонд обязан это заметить.
  assert.ok(privacyProbe({ user: game.users.get("p1"), combats: [combat] }).findings.some((f) => f.code === "actors-below-limited"));
  game.journal.clear();
  game.actors.clear();
  combat.flags[MODULE].tsc.objects = [];
  const clean = privacyProbe({ user: game.users.get("p1"), combats: [combat] });
  assert.equal(clean.note, "NO_FINDINGS_IN_THIS_PROBE_NOT_A_SECURITY_PROOF");
  assert.equal(JSON.stringify(clean).toLowerCase().includes('secure"'), false);
});
