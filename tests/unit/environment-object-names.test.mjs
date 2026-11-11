import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { LEGACY_ENVIRONMENT_TYPES, prepareLegacyEnvironmentObject } from "../../scripts/sensor/environment-object-names.mjs";
import { addPrivateCustom } from "../../scripts/sensor/private-contacts.mjs";
import { legacyEnvironmentObjectDialogContent, submitLegacyEnvironmentObject } from "../../scripts/ui/legacy-environment-object-dialog.mjs";

test("legacy environment objects accept blank names for every standard type with localized labels", () => {
  for (const lang of ["en", "ru"]) {
    installFoundryMock({ lang });
    for (const type of LEGACY_ENVIRONMENT_TYPES.slice(0, -1)) {
      const object = prepareLegacyEnvironmentObject({ name: "  ", type, zone: "4" });
      assert.equal(
        object.name,
        game.i18n.format("SF2eTSC.ui.environmentObjectFallback", {
          type: game.i18n.localize(`SF2eTSC.objectTypes.${type}`),
          number: 1
        })
      );
      assert.equal(object.type, type);
      assert.equal(object.zone, 4);
    }
  }
});

test("legacy environment fallback names skip collisions and preserve explicitly named objects", () => {
  installFoundryMock();
  const first = game.i18n.format("SF2eTSC.ui.environmentObjectFallback", {
    type: game.i18n.localize("SF2eTSC.objectTypes.asteroid"),
    number: 1
  });
  const third = game.i18n.format("SF2eTSC.ui.environmentObjectFallback", {
    type: game.i18n.localize("SF2eTSC.objectTypes.asteroid"),
    number: 3
  });
  const generated = prepareLegacyEnvironmentObject({ type: "asteroid", name: "" }, [{ name: first }, { name: third }, { name: "Other 1" }]);
  assert.equal(
    generated.name,
    game.i18n.format("SF2eTSC.ui.environmentObjectFallback", {
      type: game.i18n.localize("SF2eTSC.objectTypes.asteroid"),
      number: 2
    })
  );
  assert.deepEqual(prepareLegacyEnvironmentObject({ type: "planet", name: "  Kepler  " }), {
    name: "Kepler",
    type: "planet",
    zone: 1
  });
});

test("legacy custom objects require a trimmed name and accept named input", () => {
  installFoundryMock();
  assert.throws(
    () => prepareLegacyEnvironmentObject({ type: "custom", name: " \t " }),
    new RegExp(game.i18n.localize("SF2eTSC.ui.customObjectNameRequired"))
  );
  assert.deepEqual(prepareLegacyEnvironmentObject({ type: "custom", name: "  Wreckage  ", zone: "3" }), {
    name: "Wreckage",
    type: "custom",
    zone: 3
  });
});

test("legacy submit stores named custom objects through the private contact path", async () => {
  installFoundryMock();
  const errorElement = { hidden: true, textContent: "" };
  let custom;
  const closed = { value: false };
  const result = await submitLegacyEnvironmentObject(
    { name: "  Wreckage  ", type: "custom", zone: 3 },
    {
      dialog: { element: { querySelector: () => errorElement }, close: async () => (closed.value = true) },
      app: { render() {} },
      combat: { id: "combat" },
      existingObjects: () => [],
      addCustom: async (...args) => (custom = args),
      addPublic: async () => assert.fail("custom objects must stay private")
    }
  );
  assert.equal(result, true);
  assert.deepEqual(custom, [{ id: "combat" }, "Wreckage", 3]);
  assert.equal(closed.value, true);
});

test("legacy submit creates each unnamed standard type and leaves custom validation inline", async () => {
  installFoundryMock();
  const created = [];
  const context = {
    dialog: { element: { querySelector: () => errorElement }, close: async () => (closed = true) },
    app: { render: () => (renders += 1) },
    combat: { id: "combat" },
    existingObjects: () => [],
    addCustom: async (...args) => created.push(["custom", ...args]),
    addPublic: async (...args) => created.push(["public", ...args])
  };
  let closed;
  let renders = 0;
  const errorElement = { hidden: true, textContent: "" };

  for (const type of LEGACY_ENVIRONMENT_TYPES.slice(0, -1)) {
    closed = false;
    assert.equal(await submitLegacyEnvironmentObject({ name: "", type, zone: 2 }, context), true);
    assert.equal(closed, true);
  }
  assert.deepEqual(
    created.map(([kind, combat, object]) => [kind, combat.id, object.name, object.type, object.zone]),
    [
      ["public", "combat", "Asteroid 1", "asteroid", 2],
      ["public", "combat", "Station 1", "station", 2],
      ["public", "combat", "Debris 1", "debris", 2],
      ["public", "combat", "Drift beacon 1", "beacon", 2],
      ["public", "combat", "Planet 1", "planet", 2]
    ]
  );
  closed = false;
  const custom = await submitLegacyEnvironmentObject({ name: "  ", type: "custom", zone: 1 }, context);
  assert.equal(custom, false);
  assert.equal(closed, false);
  assert.equal(errorElement.hidden, false);
  assert.equal(errorElement.textContent, game.i18n.localize("SF2eTSC.ui.customObjectNameRequired"));
  assert.equal(renders, 5);
});

test("legacy submit displays creation failures without closing the dialog", async () => {
  installFoundryMock();
  const errorElement = { hidden: true, textContent: "" };
  let closed = false;
  const result = await submitLegacyEnvironmentObject(
    { name: "", type: "beacon" },
    {
      dialog: { element: { querySelector: () => errorElement }, close: async () => (closed = true) },
      app: { render() {} },
      combat: { id: "combat" },
      existingObjects: () => [],
      addCustom: async () => {},
      addPublic: async () => {
        throw new Error("Sensor update failed.");
      }
    }
  );
  assert.equal(result, false);
  assert.equal(closed, false);
  assert.equal(errorElement.hidden, false);
  assert.equal(errorElement.textContent, "Sensor update failed.");
});

test("named public submit does not depend on an unavailable private journal", async () => {
  installFoundryMock();
  const errorElement = { hidden: true, textContent: "" };
  const created = [];
  let closed = false;
  const result = await submitLegacyEnvironmentObject(
    { name: "Named asteroid", type: "asteroid", zone: 2 },
    {
      dialog: { element: { querySelector: () => errorElement }, close: async () => (closed = true) },
      app: { render() {} },
      combat: { id: "combat" },
      existingObjects: () => {
        throw new Error(game.i18n.localize("SF2eTSC.privateMap.invalidStore"));
      },
      addCustom: async () => assert.fail("public objects must not use the private store"),
      addPublic: async (combat, object) => created.push({ combat: combat.id, ...object })
    }
  );
  assert.equal(result, true);
  assert.deepEqual(created, [{ combat: "combat", name: "Named asteroid", type: "asteroid", zone: 2 }]);
  assert.equal(closed, true);
  assert.equal(errorElement.hidden, true);
});

test("legacy Sensor Map public submit succeeds when its private journal is invalid", async () => {
  installFoundryMock();
  const combat = makeStarshipCombat();
  await addPrivateCustom(combat, "Existing private contact", 1);
  game.journal.contents[0].folder = { id: "moved-folder" };
  const { SensorMapApplication, registerSensorHandlers } = await import("../../scripts/ui/sensor-map-app.mjs");
  registerSensorHandlers();

  const originalDialog = foundry.applications.api.DialogV2;
  const originalUx = foundry.applications.ux;
  let dialogOptions;
  class CapturedDialog {
    constructor(options) {
      dialogOptions = options;
    }
    render() {
      return this;
    }
  }
  foundry.applications.api.DialogV2 = CapturedDialog;
  foundry.applications.ux = {
    FormDataExtended: class {
      constructor(form) {
        this.object = form.object;
      }
    }
  };
  const errorElement = { hidden: true, textContent: "" };
  let closed = false;
  try {
    await SensorMapApplication.DEFAULT_OPTIONS.actions.addPublicObject.call({ _privateObjects: [], render() {} });
    const result = await dialogOptions.buttons[0].callback(
      {},
      { form: { object: { name: "", type: "asteroid", zone: 2 } } },
      { element: { querySelector: () => errorElement }, close: async () => (closed = true) }
    );
    assert.equal(result, true);
    assert.equal(closed, true);
    assert.equal(errorElement.hidden, true);
    assert.ok(
      globalThis.__notes.some(([kind, message]) => kind === "error" && message === game.i18n.localize("SF2eTSC.privateMap.invalidStore"))
    );
    assert.equal(getTsc(combat).objects.at(-1).name, "Asteroid 1");
    assert.equal(getTsc(combat).objects.at(-1).zone, 2);
  } finally {
    foundry.applications.api.DialogV2 = originalDialog;
    if (originalUx === undefined) delete foundry.applications.ux;
    else foundry.applications.ux = originalUx;
  }
});

test("open legacy dialog checks private names from its captured combat after an active-combat switch", async () => {
  installFoundryMock();
  const capturedCombat = makeStarshipCombat();
  await addPrivateCustom(capturedCombat, "Asteroid 1", 1);
  const otherCombat = makeStarshipCombat();
  await addPrivateCustom(otherCombat, "Asteroid 2", 1);
  game.combat = capturedCombat;

  const { SensorMapApplication, registerSensorHandlers } = await import("../../scripts/ui/sensor-map-app.mjs");
  registerSensorHandlers();
  const originalDialog = foundry.applications.api.DialogV2;
  const originalUx = foundry.applications.ux;
  let dialogOptions;
  class CapturedDialog {
    constructor(options) {
      dialogOptions = options;
    }
    render() {
      return this;
    }
  }
  foundry.applications.api.DialogV2 = CapturedDialog;
  foundry.applications.ux = {
    FormDataExtended: class {
      constructor(form) {
        this.object = form.object;
      }
    }
  };
  const app = { _privateObjects: [], render() {} };
  const errorElement = { hidden: true, textContent: "" };
  let closed = false;
  try {
    await SensorMapApplication.DEFAULT_OPTIONS.actions.addPublicObject.call(app);
    game.combat = otherCombat;
    app._privateObjects = [{ name: "Asteroid 2" }];

    const result = await dialogOptions.buttons[0].callback(
      {},
      { form: { object: { name: "", type: "asteroid", zone: 3 } } },
      { element: { querySelector: () => errorElement }, close: async () => (closed = true) }
    );
    assert.equal(result, true);
    assert.equal(closed, true);
    assert.equal(getTsc(capturedCombat).objects[0].name, "Asteroid 2");
    assert.deepEqual(getTsc(otherCombat).objects, []);
  } finally {
    foundry.applications.api.DialogV2 = originalDialog;
    if (originalUx === undefined) delete foundry.applications.ux;
    else foundry.applications.ux = originalUx;
  }
});

test("legacy custom submit surfaces private journal errors and does not lose the entered object", async () => {
  installFoundryMock();
  const combat = makeStarshipCombat();
  await addPrivateCustom(combat, "Existing contact", 1);
  const store = game.journal.contents[0];
  const originalContacts = structuredClone(store.flags[MODULE_ID].privateSensor.contacts);
  store.folder = { id: "moved-folder" };
  const errorElement = { hidden: true, textContent: "" };
  let closed = false;

  const result = await submitLegacyEnvironmentObject(
    { name: "New private contact", type: "custom", zone: 2 },
    {
      dialog: { element: { querySelector: () => errorElement }, close: async () => (closed = true) },
      app: { render() {} },
      combat,
      existingObjects: () => assert.fail("custom objects do not need public-name collision lookup"),
      addCustom: addPrivateCustom,
      addPublic: async () => assert.fail("custom objects must stay private")
    }
  );
  assert.equal(result, false);
  assert.equal(closed, false);
  assert.equal(errorElement.hidden, false);
  assert.equal(errorElement.textContent, game.i18n.localize("SF2eTSC.privateMap.invalidStore"));
  assert.deepEqual(store.flags[MODULE_ID].privateSensor.contacts, originalContacts);
});

test("legacy environment dialog renders all type choices and an inline alert", () => {
  installFoundryMock();
  const content = legacyEnvironmentObjectDialogContent({
    nameLabel: "Name",
    typeLabel: "Type",
    zoneLabel: "Zone",
    errorLabel: "Required",
    typeOptions: LEGACY_ENVIRONMENT_TYPES.map((id) => ({ id, label: id }))
  });
  for (const type of LEGACY_ENVIRONMENT_TYPES) assert.ok(content.includes(`value="${type}"`));
  assert.match(content, /role="alert"[^>]*hidden/);
});
