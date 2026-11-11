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
  assert.equal(r.actorUuid, h.uuid);
  assert.equal(privateContacts(combat.id)[0].zone, 4);
  assert.deepEqual(getTsc(combat).objects, []);
  const h2 = hazard("h2", "Other");
  await addSensorContact(combat, { source: "world", uuid: h2.uuid, zone: 5, detection: "hidden" });
  assert.equal(privateContacts(combat.id).find((o) => o.actorUuid === h2.uuid).detection.party, "hidden");
  assert.deepEqual(getTsc(combat).objects, []);
  assert.equal(text(combat).includes("Secret hazard"), false);
});

test("observed publishes an anonymous marker only; identified needs explicit confirmation", async () => {
  const combat = setup();
  const h = hazard("h1");
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "observed" }));
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "identified", confirmed: false }));
  assert.deepEqual(privateContacts(combat.id), []); // отказ до любых записей
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "observed", confirmed: true });
  const marker = getTsc(combat).objects[0];
  assert.deepEqual(Object.keys(marker).sort(), ["detection", "heading", "key", "name", "span", "tscPrivateProjection", "type", "zone"]);
  assert.equal(marker.name, "Contact");
  for (const secret of ["Secret hazard", h.uuid, h.img]) assert.equal(text(combat).includes(secret), false);
  // раскрытие переводит объект в публичный и очищает приватную запись
  const key = privateContacts(combat.id)[0].key;
  const { changePrivateContact } = await import("../../scripts/sensor/private-contacts.mjs");
  await changePrivateContact(combat, key, "reveal");
  assert.equal(getTsc(combat).objects[0].actorUuid, h.uuid);
  assert.deepEqual(privateContacts(combat.id), []);
});

test("identified placement discloses the Actor only after confirmation", async () => {
  const combat = setup();
  const h = hazard("h1");
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 2, detection: "identified", confirmed: true });
  const o = getTsc(combat).objects[0];
  assert.deepEqual([o.actorUuid, o.type, o.zone, o.detection.party], [h.uuid, "hazard", 2, "identified"]);
  assert.deepEqual(privateContacts(combat.id), []);
});

test("world Starship Actors use private NPC contacts and confirmed public Player contacts", async () => {
  const combat = setup();
  const npcShip = starship("npc-ship");
  await addSensorContact(combat, { source: "world", uuid: npcShip.uuid, zone: 3, detection: "hidden" });
  assert.equal(privateContacts(combat.id)[0].actorUuid, npcShip.uuid);
  assert.deepEqual(getTsc(combat).objects, []);
  assert.equal(
    (combat.combatants ?? []).some((c) => c.actorId === npcShip.id),
    false
  );

  const playerShip = starship("player-ship", "Party ship", "player", { owners: ["p1"] });
  await assert.rejects(
    addSensorContact(combat, { source: "world", uuid: playerShip.uuid, zone: 2, detection: "observed", confirmed: true })
  );
  await addSensorContact(combat, {
    source: "world",
    uuid: playerShip.uuid,
    zone: 2,
    detection: "identified",
    confirmed: true
  });
  assert.equal(getTsc(combat).objects[0].actorUuid, playerShip.uuid);
  assert.equal(
    (combat.combatants ?? []).some((c) => c.actorId === playerShip.id),
    false
  );
});

test("an Actor already visible to players cannot be hidden: only confirmed identified placement", async () => {
  const combat = setup();
  const h = hazard("h1", "Known hazard", { owners: ["p1"] });
  assert.equal(actorVisibleToPlayers(h), true);
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 3, detection: "undetected" }));
  await assert.rejects(addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 3, detection: "observed", confirmed: true }));
  assert.deepEqual(getTsc(combat).objects, []);
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 3, detection: "identified", confirmed: true });
  assert.equal(getTsc(combat).objects[0].actorUuid, h.uuid);
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
    detection: "identified",
    confirmed: true
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
          { _id: "ordinary", name: "Ordinary NPC", type: "npc" }
        ];
      }
    }
  ];
  assert.deepEqual(
    (await compendiumHazardChoices()).map((choice) => [choice.uuid, choice.kind, choice.role]),
    [[source.uuid, "starship", "npc"]]
  );
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

test("editor view model filters, sizes zones and requires confirmation only for disclosing states", () => {
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
  assert.equal(ctx.needsConfirm, true);
  assert.equal(contactEditorContext({ detection: "hidden" }, { zones: 3, world, compendium: [] }).needsConfirm, false);
  assert.equal(contactEditorContext({ source: "custom" }, { zones: 3, world, compendium: [] }).isCustom, true);
});

test("privacy probe reports findings for a player client and never claims 'secure'", async () => {
  const combat = setup();
  const h = hazard("h1");
  await addSensorContact(combat, { source: "world", uuid: h.uuid, zone: 4, detection: "observed", confirmed: true });
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
