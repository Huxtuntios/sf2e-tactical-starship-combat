import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeCharacter, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

test("description handlers open the localized compendium Item without a game action", async () => {
  installFoundryMock();
  foundry.applications.sheets = { ActorSheetV2: class {} };
  const { StarshipSheet } = await import("../../scripts/ui/starship-sheet.mjs");
  const { StationHUD } = await import("../../scripts/ui/station-hud.mjs");
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const M = "sf2e-tactical-starship-combat";
  foundry.applications.api.DialogV2.wait = () => assert.fail("must open the Item, not a text dialog");
  for (const system of ["sf2e", "pf2e"])
    for (const lang of ["en", "ru"]) {
      game.system.id = system;
      game.i18n.lang = lang;
      const opened = [];
      const entries = ["en", "ru"].map((language) => ({
        _id: language,
        folder: language,
        flags: { [M]: { packAction: { actionId: "evade" } } }
      }));
      game.packs = new Map([
        [
          `${M}.starship-actions${system === "pf2e" ? "-pf2e" : ""}`,
          {
            folders: new Map([
              ["en", { name: "Pilot", folder: { name: "English" } }],
              ["ru", { name: "Пилот", folder: { name: "Русский" } }]
            ]),
            getIndex: async () => entries,
            getDocument: async (id) => ({ sheet: { render: () => opened.push(id) } })
          }
        ]
      ]);
      for (const cls of [StarshipSheet, StationHUD, SensorMapApplication]) {
        const handler = cls.DEFAULT_OPTIONS.actions.describeAction;
        assert.equal(typeof handler, "function", cls.name);
        let stopped = false;
        await handler.call(
          {},
          {
            preventDefault() {},
            stopPropagation() {
              stopped = true;
            }
          },
          {
            dataset: { actionId: "evade" },
            textContent: "Unavailable action",
            closest: () => ({ querySelector: () => ({ innerHTML: "Complete description" }) })
          }
        );
        assert.equal(stopped, true);
      }
      assert.deepEqual(opened, [lang, lang, lang]);
    }
  let tooltipTarget;
  game.tooltip = {
    activate: (target) => {
      tooltipTarget = target;
    }
  };
  const target = { dataset: { tooltipText: "Warning text" } };
  for (const cls of [StarshipSheet, StationHUD, SensorMapApplication]) {
    const handler = cls.DEFAULT_OPTIONS.actions.actionWarning;
    assert.equal(typeof handler, "function", cls.name);
    await handler({ preventDefault() {}, stopPropagation() {} }, target);
    assert.equal(tooltipTarget, target);
  }
  assert.equal(game.messages.size, 0);
});

test("ship-specific NPC descriptions use an unsaved native Item with the complete prepared text", async () => {
  installFoundryMock();
  const { showActionDescription } = await import("../../scripts/ui/action-controls.mjs");
  game.packs = new Map();
  const ship = makeShip({
    role: "npc",
    extra: {
      npcActions: [
        { name: "Charity Lance", cost: "three-actions", traits: ["divine"], text: "Complete rules" },
        { name: "Passive Ability", cost: "passive", text: "Passive rules" }
      ]
    }
  });
  const sources = [];
  globalThis.CONFIG.Item = {
    documentClass: class {
      constructor(data) {
        this.sheet = { render: () => sources.push(data) };
      }
      static create() {
        assert.fail("viewing must not persist an Item");
      }
    }
  };
  const prepared = '<p>Complete rules <a class="inline-check">Will DC 34</a></p><p>Final paragraph.</p>';
  await showActionDescription.call(
    { document: ship },
    { preventDefault() {}, stopPropagation() {} },
    {
      dataset: { actionId: "inline:charity-lance" },
      textContent: "Копьё благотворительности",
      closest: () => ({ querySelector: () => ({ innerHTML: prepared }) })
    }
  );
  assert.equal(sources.length, 1);
  assert.equal(sources[0].type, "action");
  assert.equal(sources[0].name, "Копьё благотворительности");
  assert.equal(sources[0].system.actions.value, 3);
  assert.equal(sources[0].system.description.value, prepared);
  await showActionDescription.call(
    { document: ship },
    { preventDefault() {}, stopPropagation() {} },
    {
      dataset: { actionId: "inline:passive-ability" },
      textContent: "Passive Ability",
      closest: () => ({ querySelector: () => ({ innerHTML: "Passive rules" }) })
    }
  );
  assert.equal(sources[1].system.actionType.value, "passive");
  assert.equal(sources[1].system.actions.value, null);
  assert.ok(sources[0]._id, "temporary sheets need distinct document identities");
  assert.notEqual(sources[0]._id, sources[1]._id);
  assert.equal(globalThis.__writes.length, 0);
  assert.equal(game.messages.size, 0);
});

test("chat action descriptions include NPC family text", async () => {
  installFoundryMock();
  const { sendActionDescriptionToChat } = await import("../../scripts/ui/action-controls.mjs");
  const ship = makeShip({ id: "npc-description-ship", name: "NPC Ship", role: "npc" });
  await sendActionDescriptionToChat({
    action: {
      id: "inline:dc-25",
      name: "DC 25",
      inline: true,
      text: "DC 25",
      familyText: "Targets attempt a basic Reflex save."
    },
    ship
  });
  const message = game.messages.contents.at(-1);
  assert.match(message.flags["sf2e-tactical-starship-combat"].actionDescription.sourceText, /DC 25/);
  assert.match(message.content, /Targets attempt a basic Reflex save\./);
});

for (const isGM of [true, false])
  for (const inCombat of [true, false]) {
    test(`PC station availability: GM=${isGM}, strict combat=${inCombat}`, async () => {
      const { setUser } = installFoundryMock();
      if (!isGM) setUser("p1");
      await loadContentFromDisk();
      const crew = makeCharacter({ id: "operator", name: "Operator", owners: ["p1"] });
      const ship = makeShip({
        id: "ship",
        owners: ["p1"],
        stations: [
          { id: "scanners", name: "Scanners", type: "scanners", grade: "commercial", helmedBy: crew.uuid, malfunctioning: inCombat }
        ]
      });
      if (inCombat) makeStarshipCombat();
      const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");
      const context = await buildSheetContext({ document: ship, tab: "stations", tabs: ["stations"], isNpc: false });
      const actions = context.stations[0].actionList;
      const targetLock = actions.find((row) => row.id === "target-lock");
      assert.ok(targetLock);
      assert.equal(targetLock.enabled, isGM, "the GM must reach execution and its existing override dialog");
      assert.ok(targetLock.reasons.includes(game.i18n.localize(`SF2eTSC.errors.${inCombat ? "malfunctioning" : "noCombat"}`)));
      assert.ok(actions.every((row) => row.costLabel && row.html));
    });
  }

const rows = [
  { id: "one", name: "Single action", icon: "◆", enabled: true },
  { id: "two", name: "Double action", icon: "◆◆", enabled: true },
  { id: "three", name: "Triple action", icon: "◆◆◆", enabled: true },
  { id: "free", name: "Free action", icon: "◇", enabled: true },
  { id: "reaction", name: "Reaction", icon: "↺", enabled: true },
  { id: "variable", name: "Variable cost", icon: "◆–◆◆◆", enabled: true },
  { id: "blocked", name: "Unavailable action", icon: "◆", enabled: false, reasons: "No combat" }
].map((row) => ({
  ...row,
  html: "<p>Complete description</p>",
  desc: "<p>Complete description</p>",
  warnings: "Warning text",
  frequency: "once per round"
}));

function render(template, context) {
  const h = Handlebars.create();
  h.registerHelper("localize", (key) => key);
  h.registerHelper("eq", (a, b) => a === b);
  for (const name of [
    "tscOccupant",
    "tscStationUpgrades",
    "tscShipUpgrades",
    "tscUpgradeItem",
    "modules/sf2e-tactical-starship-combat/templates/crew-ship.hbs"
  ])
    h.registerPartial(name, "");
  return h.compile(readFileSync(new URL(`../../templates/${template}.hbs`, import.meta.url), "utf8"))(context);
}

test("description controls preserve the selected operator across sheet, HUD and dock", () => {
  const actions = [{ id: "target-lock", name: "Target Lock" }];
  for (const [template, context] of [
    ["starship-sheet", { tab: "stations", ship: {}, stations: [{ id: "scanner", helmedBy: "Actor.operator", actionList: actions }] }],
    ["station-hud", { crewUuid: "Actor.operator", shipUuid: "Actor.ship", actions }],
    ["sensor-map-dock", { dock: { crewUuid: "Actor.operator", shipUuid: "Actor.ship", actions } }]
  ]) {
    const html = render(template, context);
    const button = html.match(/<button[^>]+data-action="describeAction"[^>]*>/)?.[0];
    assert.match(button, /data-crew-uuid="Actor.operator"/, template);
    if (template !== "starship-sheet") assert.match(button, /data-ship-uuid="Actor.ship"/, template);
  }
});

for (const [name, template, context, execution] of [
  ["PC stations", "starship-sheet", { tab: "stations", stations: [{ id: "station", actionList: rows }], ship: {} }, "runAction"],
  [
    "NPC stations",
    "starship-sheet",
    { tab: "stations", isNpc: true, stations: [{ id: "station", actionList: rows }], ship: {} },
    "runAction"
  ],
  ["NPC actions", "starship-sheet", { tab: "actions", isNpc: true, npcActions: rows, ship: {} }, "runAction"],
  ["Station HUD", "station-hud", { actions: rows }, "act"],
  ["Sensor Map dock", "sensor-map-dock", { dock: { actions: rows } }, "dockAct"]
]) {
  test(`${name}: cost runs the action without including its description control`, () => {
    const html = render(template, context);
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    for (const row of rows) {
      const cost = buttons.find(
        ([, attrs]) => attrs.includes(`data-action="${execution}"`) && attrs.includes(`data-action-id="${row.id}"`)
      );
      assert.ok(cost, row.name);
      assert.ok(cost[2].includes(row.icon));
      assert.ok(!cost[2].includes(row.name), "clickable action name must not execute");
      assert.equal(/\bdisabled\b/.test(cost[1]), !row.enabled);
      assert.match(cost[1], /aria-label="[^"]+"/);
    }
  });

  test(`${name}: descriptions are independent and available even for blocked actions`, () => {
    const html = render(template, context);
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    for (const row of rows) {
      const description = buttons.find(
        ([, attrs]) => attrs.includes('data-action="describeAction"') && attrs.includes(`data-action-id="${row.id}"`)
      );
      assert.ok(description, row.name);
      assert.ok(description[2].includes(row.name));
      assert.doesNotMatch(description[1], /\bdisabled\b/);
      assert.match(description[1], /aria-haspopup="dialog"/);
    }
    const warning = buttons.find(([, attrs]) => attrs.includes('data-action="actionWarning"'));
    assert.ok(warning, "warnings have a separate tooltip control");
    assert.match(warning[1], /data-tooltip-text="[^"]*Warning text/);
    assert.match(warning[1], /aria-label="[^"]*Warning text/);
    assert.ok(!warning[2].includes("Warning text"), "warning text does not clutter the row");
    assert.doesNotMatch(html, /<small class="why/);
    assert.match(html, /once per round/);
    assert.match(html, /Complete description/);
  });
}
