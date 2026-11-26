import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";

const DIR = "templates";
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".hbs"));

test("0.9.2: every Handlebars template compiles (a typo in a template only shows up in a live Foundry otherwise)", () => {
  assert.ok(files.length >= 15);
  for (const f of files) assert.doesNotThrow(() => Handlebars.precompile(fs.readFileSync(path.join(DIR, f), "utf8")), f);
});

function renderer() {
  const hb = Handlebars.create();
  hb.registerHelper("localize", (k) => String(k).split(".").pop());
  hb.registerHelper("eq", (a, b) => a === b);
  hb.registerHelper("numberFormat", (n) => n);
  hb.registerHelper("dotsafe", (x) => x);
  return (name, ctx) => hb.compile(fs.readFileSync(path.join(DIR, `${name}.hbs`), "utf8"), { noEscape: false })(ctx);
}

test("0.9.2: action dock - warnings leave the button enabled, hard blocks disable it, the picker appears only with several stations", () => {
  const render = renderer();
  const base = {
    noCombat: false,
    isGM: false,
    dock: {
      none: false,
      station: "Gunnery",
      crew: "Ava",
      ship: "Aurora",
      stationIcon: "x",
      malfunctioning: false,
      noCombatant: false,
      selectors: [{ i: 0, short: "Gunnery", label: "g", active: true }],
      actions: [
        { id: "strike", name: "Strike", icon: "◆", enabled: true, needsTarget: true, warnings: "Out of range", text: "Attack" },
        { id: "locked", name: "Locked", icon: "◆", enabled: false, reasons: "No combat", text: "" }
      ]
    }
  };
  let html = render("sensor-map-dock", base);
  assert.match(html, /data-action-id="strike"\s+class="[^"]*\bhas-warning\b/);
  assert.doesNotMatch(html.split('data-action-id="strike"')[1].split("</button>")[0], /disabled/);
  assert.match(html.split('data-action-id="locked"')[1].split("</button>")[0], /disabled/);
  assert.doesNotMatch(html, /dockPick/, "a single station needs no picker");
  base.dock.selectors.push({ i: 1, short: "Pilot", label: "p", active: false });
  assert.match(render("sensor-map-dock", base), /data-action="dockPick" data-index="1"/);
  assert.match(render("sensor-map-dock", { ...base, noCombat: true }), /hidden/);
  assert.doesNotMatch(
    render("sensor-map-dock", { noCombat: false, isGM: true, dock: { none: true } }),
    /tsc-dock-empty/,
    "the GM is not nagged about helming"
  );
});

test("0.9.2: sensor detail - crew get the vitals inputs, GM tools exist for the GM only", () => {
  const render = renderer();
  const detail = {
    label: "Aurora",
    key: "k",
    rows: [],
    vitals: { shipUuid: "u", hp: 10, hpMax: 20, sp: 5, spMax: 8 },
    canOpen: true,
    canMove: true,
    gm: null
  };
  const player = render("sensor-map-detail", { noCombat: false, isGM: false, detail, log: [] });
  assert.match(player, /data-gm-ship="hp"/);
  assert.match(player, /data-gm-ship="sp"/);
  assert.doesNotMatch(player, /tsc-gm-tools/);
  const gm = render("sensor-map-detail", {
    noCombat: false,
    isGM: true,
    gmToolsOpen: true,
    detail: { ...detail, gm: { shipUuid: "u", headings: [], statuses: [] } },
    log: []
  });
  assert.match(gm, /<details class="tsc-gm-tools" open>/);
  assert.match(gm, /data-action="removeObj"/);
});

test("private Sensor Map details keep vitals and zone controls together", () => {
  const render = renderer();
  const detail = {
    label: "Private NPC",
    key: "map-private",
    privateContact: true,
    actorUuid: "map-private",
    zone: 4,
    zoneChoices: [{ id: 4, selected: true }],
    vitals: { shipUuid: "map-private", hp: 20, hpMax: 30, sp: 6, spMax: 10 },
    detection: [],
    detectionLabel: "Hidden"
  };
  const html = render("sensor-map-detail", { noCombat: false, isGM: true, detail, log: [] });
  assert.match(html, /data-gm-ship="hp"/);
  assert.match(html, /data-gm-ship="sp"/);
  assert.match(
    html,
    /<div class="tsc-zone-controls">[\s\S]*?data-private-zone="map-private"[\s\S]*?data-action="privateMove"[\s\S]*?data-action="privateMove"[\s\S]*?<\/div>/
  );
});

test("normal Sensor Map zone arrows stay on the zone row", () => {
  const render = renderer();
  const html = render("sensor-map-detail", {
    noCombat: false,
    isGM: true,
    detail: { label: "Aurora", key: "map-one", rows: [], zone: 4, canMove: true, gm: null },
    log: []
  });
  assert.match(
    html,
    /<div class="tsc-zone-controls">[\s\S]*?Зона|zone[\s\S]*?data-action="moveLeft"[\s\S]*?data-action="moveRight"[\s\S]*?<\/div>/
  );
});

test("GM action picker includes the position in its options", () => {
  const render = renderer();
  const actionObjects = [{ key: "map-one", label: "Aurora", typeLabel: "Starship", positionLabel: "Zone 3 · Position 1", selected: true }];
  const html = render("sensor-map-bar", {
    noCombat: false,
    isGM: true,
    combat: { round: 1, turn: "Aurora" },
    zoneCount: 6,
    actionObjects,
    actionSelection: actionObjects[0]
  });
  assert.match(html, /<option value="map-one" selected>Aurora — Starship — Zone 3 · Position 1<\/option>/);
  assert.doesNotMatch(html, /class="tsc-pill tsc-action-position"/);
});

test("0.9.2: ship sheet header - vitals inputs and quick buttons need adjustVitals", () => {
  const render = renderer();
  const ctx = {
    actor: { name: "A", img: "" },
    ship: { hp: { value: 5, max: 10 }, sp: { value: 2, max: 4 }, hpPct: 50, spPct: 50, hullDC: 12 },
    stats: {},
    hullCheckable: true
  };
  const none = render("starship-sheet-header", { ...ctx, perms: {} });
  assert.doesNotMatch(none, /data-field="hp.value"/);
  assert.doesNotMatch(none, /data-action="gmDamage"/);
  const crew = render("starship-sheet-header", { ...ctx, perms: { adjustVitals: true } });
  for (const k of [
    'data-field="hp.value"',
    'data-field="sp.value"',
    'data-action="gmDamage"',
    'data-action="gmRepair"',
    'data-action="hullCheck"'
  ])
    assert.ok(crew.includes(k), k);
});
