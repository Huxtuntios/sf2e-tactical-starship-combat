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
  assert.match(html, /data-action-id="strike"\s+class="has-warning"/);
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
