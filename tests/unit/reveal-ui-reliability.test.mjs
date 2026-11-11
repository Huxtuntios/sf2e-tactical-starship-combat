import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { addPrivateCustom, changePrivateContact, pendingPrivateReveals } from "../../scripts/sensor/private-contacts.mjs";

installFoundryMock();
const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
const { buildApi } = await import("../../scripts/api.mjs");

async function pending() {
  const mock = installFoundryMock();
  const combat = makeStarshipCombat();
  const key = await addPrivateCustom(combat, "Unfinished contact", 4);
  const journal = game.journal.contents[0];
  const update = journal.update.bind(journal);
  journal.update = async (changes) => {
    if (Object.hasOwn(changes, `flags.${MODULE_ID}.privateSensor.completedReveals`)) throw new Error("finalization unavailable");
    return update(changes);
  };
  await assert.rejects(changePrivateContact(combat, key, "reveal"));
  journal.update = update;
  return { ...mock, combat, key, journal, update };
}

function appControl() {
  const rendered = [];
  return { rendered, render: (options) => rendered.push(options) };
}

const recover = SensorMapApplication.DEFAULT_OPTIONS.actions.recoverReveals;

test("recovery control renders only for a GM with pending intent", () => {
  const hb = Handlebars.create();
  hb.registerHelper("localize", (key) => key);
  const bar = hb.compile(fs.readFileSync("templates/sensor-map-bar.hbs", "utf8"));
  assert.match(bar({ isGM: true, pendingRevealCount: 2 }), /data-action="recoverReveals"/);
  assert.doesNotMatch(bar({ isGM: false, pendingRevealCount: 2 }), /data-action="recoverReveals"/);
  assert.doesNotMatch(bar({ isGM: true, pendingRevealCount: 0 }), /data-action="recoverReveals"/);
  assert.doesNotMatch(bar({ noCombat: true, isGM: true, pendingRevealCount: 2 }), /data-action="recoverReveals"/);
});

test("bar context reports pending reveal even after its private marker is filtered by public identity", async () => {
  const { setUser } = await pending();
  const app = new SensorMapApplication();
  const writes = globalThis.__writes.length;
  try {
    const gm = await app._prepareContext({ parts: ["bar"] });
    assert.equal(gm.pendingRevealCount, 1);
    assert.equal(app._privateObjects.length, 0);
    setUser("p1");
    const player = await app._prepareContext({ parts: ["bar"] });
    assert.equal(player.pendingRevealCount, 0);
    assert.equal(JSON.stringify(player).includes("reveal.stage"), false);
    assert.equal(globalThis.__writes.length, writes, "render never recovers documents");
  } finally {
    app._cleanup();
  }
});

test("explicit recovery releases busy button, finalizes once and refreshes the map", async () => {
  const { combat } = await pending();
  const app = appControl();
  const button = { disabled: false };
  const calls = [];
  const info = ui.notifications.info;
  ui.notifications.info = (message) => calls.push(message);
  try {
    await recover.call(app, {}, button);
    assert.equal(button.disabled, false);
    assert.equal(app._recoveringReveals, false);
    assert.equal(pendingPrivateReveals(combat.id).length, 0);
    assert.ok(app.rendered.length > 0);
    assert.ok(calls.some((message) => /completed|завершено/i.test(message)));
    const writes = globalThis.__writes.length;
    await recover.call(app, {}, button);
    assert.equal(globalThis.__writes.length, writes);
  } finally {
    ui.notifications.info = info;
  }
});

test("recovery conflict retains intent and releases controls with actionable warning", async () => {
  const { combat, journal, update } = await pending();
  journal.update = async (changes) => {
    if (Object.hasOwn(changes, `flags.${MODULE_ID}.privateSensor.completedReveals`)) throw new Error("still unavailable");
    return update(changes);
  };
  const app = appControl();
  const button = { disabled: false };
  const warnings = [];
  const warn = ui.notifications.warn;
  ui.notifications.warn = (message) => warnings.push(message);
  try {
    await recover.call(app, {}, button);
    assert.equal(button.disabled, false);
    assert.equal(app._recoveringReveals, false);
    assert.equal(pendingPrivateReveals(combat.id).length, 1);
    assert.ok(warnings.some((message) => /journal|журнал/i.test(message)));
    assert.ok(app.rendered.length > 0);
  } finally {
    ui.notifications.warn = warn;
  }
});

test("player recovery action and API cannot write or receive GM diagnostics", async () => {
  const { combat, setUser } = await pending();
  setUser("p1");
  const writes = globalThis.__writes.length;
  const app = appControl();
  const button = { disabled: false };
  await recover.call(app, {}, button);
  assert.equal(button.disabled, false);
  assert.deepEqual(buildApi().pendingPrivateReveals(combat), []);
  await assert.rejects(buildApi().recoverPrivateReveals(combat));
  assert.equal(globalThis.__writes.length, writes);
});
