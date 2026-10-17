import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installFoundryMock, loadLang } from "../helpers/foundry-mock.mjs";
import {
  upgradeEntries,
  stationOptions,
  stationUpgradeStatus,
  planUpgradeChange,
  foldStationUpgrades,
  remapUpgradeStations,
  shipLevelOptions,
  resolveUpgrade,
  stationCapacity,
  UpgradeError,
  UPGRADE_USAGE
} from "../../scripts/engine/upgrades.mjs";
import { upgradeDescriptionHTML, buildUpgradeItemData, upgradeSlug } from "../../scripts/content/upgrade-docs.mjs";
import { migrate } from "../../scripts/engine/migration.mjs";
import { mergeStarshipFlag } from "../../scripts/content/ship-update.mjs";

const M = "sf2e-tactical-starship-combat";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const DEFS = read("data/equipment/upgrades.json").upgrades;
const ENTRIES = upgradeEntries(DEFS);
const STATIONS = new Map(read("data/stations/stations.json").stations.map((s) => [s.id, s]));
const NO_PACK_SRC = fs.existsSync(path.join(root, "packs-src", "starship-upgrades")) ? false : "packs-src/ not present (release build)";
const packDocs = (pack) =>
  fs.readdirSync(path.join(root, "packs-src", pack)).map((f) => JSON.parse(fs.readFileSync(path.join(root, "packs-src", pack, f), "utf8")));

/** Every Starship Upgrade on Archives of Nethys / Tech Core (34 upgrades + 33 variants). */
const BASES = [
  "Communications Overlay",
  "Drone Shield Protocol",
  "Executive Escape Pod",
  "Explorer Survival Pod",
  "Gunnery Turret Mount",
  "Mine Deployment Shell",
  "Munitions Deflection Unit",
  "Mystic Magic Module",
  "Ordnance Hinges",
  "Powerful Thrusters",
  "Rotational Thrusters",
  "Secondary Armaments",
  "Security Relay",
  "Tangle Ward",
  "Technomancer Magic Module",
  "Witchwarper Magic Module",
  "Gravity Toggle",
  "Mechanic Generator Module",
  "Pulse Shield",
  "Solar Generator Crystal",
  "Starship Weapon Crystal",
  "Thasteron Afterburner",
  "Towing Winch",
  "Solar Thrusters",
  "Magnepod",
  "Operator's Switchboard",
  "Pet Drone Shell",
  "Tractor Beam",
  "Nova Prow",
  "Primal Shielding",
  "Ramming Prow",
  "Cloaking Unit",
  "Telepod",
  "Interplanar Pod"
];
const VARIANTS = {
  "Security Relay": ["Commercial", "Tactical"],
  "Tangle Ward": ["Commercial", "Tactical", "Advanced", "Superior"],
  "Technomancer Magic Module": ["Commercial", "Tactical"],
  "Pulse Shield": ["Commercial", "Tactical", "Advanced"],
  "Starship Weapon Crystal": ["Commercial", "Tactical", "Advanced"],
  "Thasteron Afterburner": ["Commercial", "Tactical", "Advanced", "Superior", "Elite", "Ultimate", "Paragon"],
  "Nova Prow": ["Commercial", "Tactical", "Advanced", "Superior", "Elite"],
  "Ramming Prow": ["Commercial", "Tactical", "Advanced", "Superior", "Elite"],
  "Cloaking Unit": ["Commercial", "Tactical"]
};
const norm = (s) => s.replace(/’/g, "'");
const newIds = () => {
  let n = 0;
  return () => `u${++n}`;
};

test("catalog: every upgrade and variant from Tech Core is present exactly once, one catalog only", () => {
  assert.equal(DEFS.length, 34);
  assert.deepEqual(DEFS.map((d) => norm(d.name)).sort(), [...BASES].sort());
  const variantNames = DEFS.flatMap((d) => (d.variants ?? []).map((v) => norm(v.name)));
  const want = Object.entries(VARIANTS).flatMap(([b, gs]) => gs.map((g) => `${b} (${g})`));
  assert.equal(variantNames.length, 33);
  assert.deepEqual(variantNames.sort(), want.sort());
  assert.equal(new Set(DEFS.map((d) => d.id)).size, DEFS.length, "unique ids");
  assert.equal(new Set(ENTRIES.map((e) => e.key)).size, ENTRIES.length, "unique installable keys");
  assert.equal(ENTRIES.length, 33 + DEFS.filter((d) => !d.variants?.length).length);
  for (const d of DEFS) {
    assert.ok(d.source?.page > 0 && d.level >= 0 && d.rarity && d.usage && d.text?.length, d.id);
    assert.match(d.id, /^[a-z0-9-]+$/);
    for (const v of d.variants ?? []) assert.ok(v.level >= d.level && v.page > 0 && v.grade, v.name);
  }
  assert.deepEqual(
    fs.readdirSync(path.join(root, "data", "equipment")).filter((f) => /upgrade/i.test(f)),
    ["upgrades.json"]
  );
});

test("catalog: stations follow the Usage line (corrected mappings), escape pods are ship level", () => {
  const st = (id) => DEFS.find((d) => d.id === id);
  assert.equal(st("gravity-toggle").station, "generator");
  assert.equal(st("tractor-beam").station, "generator");
  assert.equal(st("munitions-deflection-unit").station, "gunnery");
  assert.equal(st("security-relay").station, "scanners");
  for (const id of ["executive-escape-pod", "explorer-survival-pod", "magnepod", "telepod", "interplanar-pod"]) {
    assert.equal(st(id).station, null, id);
    assert.equal(st(id).slot, "escape-pods", id);
  }
  for (const d of DEFS) assert.equal(d.usageKey, d.station ? UPGRADE_USAGE[d.station] : "other", d.id);
  assert.deepEqual(
    st("tractor-beam").activations[0].details.map((x) => x.label),
    ["Critical Success", "Success", "Failure", "Critical Failure"]
  );
});

test("selector: only compatible upgrades per station; escape pods never offered to stations; GM override list", () => {
  const gen = { id: "g", type: "generator", grade: "tactical" };
  const o = stationOptions(ENTRIES, gen);
  assert.ok(o.compatible.length > 0 && o.compatible.every((e) => e.station === "generator"));
  assert.ok(o.compatible.some((e) => e.ref === "gravity-toggle") && o.compatible.some((e) => e.ref === "tractor-beam"));
  assert.equal(o.override.length, 0);
  const gm = stationOptions(ENTRIES, gen, { isGM: true });
  assert.ok(gm.override.length > 0 && gm.override.every((e) => e.station !== "generator" && e.slot === "station"));
  for (const t of Object.keys(UPGRADE_USAGE)) {
    const all = stationOptions(ENTRIES, { id: t, type: t }, { isGM: true });
    assert.ok(
      [...all.compatible, ...all.override].every((e) => e.slot !== "escape-pods"),
      t
    );
  }
  assert.deepEqual(
    shipLevelOptions(ENTRIES)
      .map((e) => e.ref)
      .sort(),
    ["executive-escape-pod", "explorer-survival-pod", "interplanar-pod", "magnepod", "telepod"]
  );
  assert.ok(stationOptions(ENTRIES, { id: "x", type: "gunnery" }).compatible.some((e) => e.ref === "munitions-deflection-unit"));
  assert.ok(stationOptions(ENTRIES, { id: "x", type: "scanners" }).compatible.some((e) => e.key === "security-relay:tactical"));
});

test("capacity follows station advancement; over capacity is reported, never removed; GM override kept", () => {
  assert.equal(stationCapacity({ type: "pilot", grade: "commercial" }, STATIONS.get("pilot")), 0);
  assert.equal(stationCapacity({ type: "pilot", grade: "tactical" }, STATIONS.get("pilot")), 1);
  assert.equal(stationCapacity({ type: "gunnery", grade: "paragon" }, STATIONS.get("gunnery")), 4);
  const st = { id: "gen-1", type: "generator", grade: "tactical" };
  const data = { level: 10, stations: [st], upgrades: [] };
  const opts = { entries: ENTRIES, stationDefs: STATIONS, newId: newIds() };
  data.upgrades = planUpgradeChange(data, "add", { key: "gravity-toggle", stationId: "gen-1" }, opts);
  assert.deepEqual([data.upgrades[0].ref, data.upgrades[0].stationId, data.upgrades[0].variant], ["gravity-toggle", "gen-1", null]);
  assert.throws(
    () => planUpgradeChange(data, "add", { key: "tractor-beam", stationId: "gen-1" }, opts),
    (e) => e instanceof UpgradeError && e.code === "capacity"
  );
  assert.throws(
    () => planUpgradeChange(data, "add", { key: "tractor-beam", stationId: "gen-1", override: true }, opts),
    (e) => e.code === "capacity",
    "players cannot override"
  );
  assert.throws(
    () => planUpgradeChange(data, "add", { key: "cloaking-unit:commercial", stationId: "gen-1" }, { ...opts, isGM: true }),
    (e) => e.code === "incompatible"
  );
  assert.throws(
    () => planUpgradeChange(data, "add", { key: "ramming-prow:commercial", stationId: null }, opts),
    (e) => e.code === "needsStation"
  );
  const withPod = { ...data, upgrades: planUpgradeChange(data, "add", { key: "telepod", stationId: null }, opts) };
  assert.throws(
    () => planUpgradeChange(withPod, "add", { key: "magnepod", stationId: null }, opts),
    (e) => e.code === "escapePodsFull"
  );
  data.upgrades = planUpgradeChange(data, "add", { key: "tractor-beam", stationId: "gen-1", override: true }, { ...opts, isGM: true });
  const status = stationUpgradeStatus(data, st, { entries: ENTRIES, stationDef: STATIONS.get("generator") });
  assert.deepEqual([status.used, status.capacity, status.over], [2, 1, true]);
  assert.deepEqual(status.installed[1].issues, ["capacity"]);
  assert.equal(status.installed[1].overridden, true);
  const lower = { ...data, stations: [{ ...st, grade: "commercial" }] };
  const s2 = stationUpgradeStatus(lower, lower.stations[0], { entries: ENTRIES, stationDef: STATIONS.get("generator") });
  assert.equal(s2.used, 2);
  assert.equal(s2.capacity, 0);
  assert.ok(
    s2.installed.every((x) => x.issues.includes("capacity")),
    "grade lowered: kept and reported"
  );
  const id1 = data.upgrades[0].id;
  data.upgrades = planUpgradeChange(data, "remove", { id: id1 }, opts);
  assert.deepEqual(
    data.upgrades.map((u) => u.ref),
    ["tractor-beam"]
  );
  assert.throws(
    () => planUpgradeChange(data, "override", { id: data.upgrades[0].id, value: false }, opts),
    (e) => e.code === "gmOnly"
  );
});

test("migration 1 → 2 folds station.upgrades and legacy records without losing anything (idempotent)", () => {
  const legacy = {
    dataVersion: 1,
    level: 5,
    stations: [
      { id: "gen-1", type: "generator", grade: "tactical", upgrades: ["tractor-beam"] },
      { id: "g1", type: "gunnery", grade: "tactical", upgrades: [] },
      { id: "g2", type: "gunnery", grade: "tactical" }
    ],
    upgrades: [
      { id: "old1", ref: "gravity-toggle", name: "Gravity Toggle", station: "pilot", level: 1 },
      { id: "old2", ref: "ordnance-hinges", name: "Ordnance Hinges", station: "gunnery", level: 1 },
      { id: "old3", ref: "telepod", name: "Telepod", station: null, level: 8 }
    ]
  };
  const { data, log } = migrate(legacy);
  assert.equal(data.dataVersion, 2);
  assert.deepEqual(log, ["1->2"]);
  assert.equal(data.upgrades.length, 4);
  assert.deepEqual(data.stations[0].upgrades, []);
  const byRef = Object.fromEntries(data.upgrades.map((u) => [u.ref, u]));
  assert.equal(byRef["tractor-beam"].stationId, "gen-1");
  assert.equal(byRef["ordnance-hinges"].stationId, null, "two gunneries: left unassigned, not deleted");
  assert.equal(byRef.telepod.stationId, null);
  const withCatalog = foldStationUpgrades(legacy, ENTRIES);
  assert.equal(withCatalog.upgrades.find((u) => u.ref === "gravity-toggle").stationId, "gen-1", "catalog Usage corrects the old station");
  assert.equal(foldStationUpgrades(withCatalog, ENTRIES), withCatalog, "idempotent: no change → same object");
  assert.equal(resolveUpgrade(ENTRIES, "cloaking-unit", null).key, "cloaking-unit:commercial");
});

test("update from compendium re-points upgrades at renamed stations", () => {
  const out = mergeStarshipFlag(
    {
      stations: [{ id: "old-gen", type: "generator" }],
      upgrades: [{ id: "u1", ref: "tractor-beam", stationId: "old-gen" }],
      hp: { value: 10, max: 10 },
      sp: { value: 0, max: 0 }
    },
    { stations: [{ id: "new-gen", type: "generator" }], hp: { value: 10, max: 10 }, sp: { value: 0, max: 0 } }
  );
  assert.equal(out.upgrades[0].stationId, "new-gen");
  assert.deepEqual(remapUpgradeStations([{ id: "a", stationId: "x" }], new Map([["x", "y"]])), [{ id: "a", stationId: "y" }]);
});

test("descriptions: usage, level, traits, source, activations, outcome details and variant text", () => {
  const e = ENTRIES.find((x) => x.key === "tractor-beam");
  const html = upgradeDescriptionHTML(e, { L: (k, d) => (d ? `${k}:${JSON.stringify(d)}` : k), price: true });
  for (const s of [
    "Installed in a generator",
    "<strong>level</strong> 4",
    "Pull Starship",
    "action-glyph",
    "Critical Failure",
    "pulled 2 zones closer",
    "priceNote",
    "noAutomation",
    "186"
  ])
    assert.ok(html.includes(s), s);
  const vh = upgradeDescriptionHTML(
    ENTRIES.find((x) => x.key === "thasteron-afterburner:paragon"),
    {}
  );
  assert.ok(vh.includes("Thasteron Burst") && vh.includes("14d12") && vh.includes("Thasteron Afterburner (Paragon)"));
  assert.ok(
    upgradeDescriptionHTML(
      ENTRIES.find((x) => x.key === "tangle-ward:tactical"),
      {}
    ).includes("tsc-upgrade-review"),
    "known source problem is flagged"
  );
});

test("item schema: native sf2e equipment, price 0 placeholder with note, stable slug and flag", () => {
  for (const e of ENTRIES) {
    const d = buildUpgradeItemData(e, { L: (k) => k });
    assert.equal(d.type, "equipment");
    assert.deepEqual(d.system.price, { value: { sp: 0 } });
    assert.equal(d.system.level.value, e.level);
    assert.equal(d.system.usage.value, e.usageKey);
    assert.ok(d.system.description.value.includes("priceNote"));
    assert.ok(d.system.traits.value.every((t) => ["starship", "tech", "magical", "primal"].includes(t)));
    assert.equal(d.system.slug, upgradeSlug(e));
    assert.match(d.system.slug, /^tsc-upgrade-[a-z0-9-]+$/);
    assert.equal(d.flags[M].upgrade.key, e.key);
    assert.equal(d.system.publication.title, "Starfinder Tech Core");
  }
});

test("Starship Upgrades pack: EN + RU items for every entry, unique ids, valid journal links, translated", { skip: NO_PACK_SRC }, () => {
  const m = read("module.json");
  const p = m.packs.find((x) => x.name === "starship-upgrades");
  assert.equal(p.type, "Item");
  assert.equal(p.system, "sf2e");
  assert.equal(p.label, "Starship Upgrades / Улучшения звездолётов");
  assert.ok(m.packFolders[0].packs.includes("starship-upgrades"));
  assert.ok(fs.existsSync(path.join(root, p.path, "CURRENT")));
  const docs = packDocs("starship-upgrades");
  const items = docs.filter((d) => d._key.startsWith("!items!"));
  assert.equal(items.length, ENTRIES.length * 2);
  assert.equal(new Set(docs.map((d) => d._id)).size, docs.length);
  const folders = new Set(docs.filter((d) => d._key.startsWith("!folders!")).map((d) => d._id));
  for (const lang of ["en", "ru"]) {
    const list = items.filter((d) => d.flags[M].upgrade.lang === lang);
    assert.deepEqual(list.map((d) => d.flags[M].upgrade.key).sort(), ENTRIES.map((e) => e.key).sort());
    for (const d of list) {
      assert.ok(folders.has(d.folder));
      assert.deepEqual(d.system.price, { value: { sp: 0 } });
      assert.ok(d.system.description.value.includes(lang === "en" ? "The GM determines the price" : "Цену определяет ведущий"), d.name);
      if (lang === "ru") assert.ok(/[А-Яа-яЁё]/.test(d.name), d.name);
    }
  }
  const ids = new Set(items.map((d) => d._id));
  const links = packDocs("starship-equipment").flatMap((j) =>
    j.pages.flatMap((pg) => [...pg.text.content.matchAll(/starship-upgrades\.Item\.([A-Za-z0-9]{16})/g)].map((x) => x[1]))
  );
  assert.equal(links.length, ENTRIES.length * 2);
  assert.ok(links.every((l) => ids.has(l)));
});

test("i18n: upgrade UI labels exist in English and Russian; partials balanced; both sheets include sections", async () => {
  installFoundryMock();
  const { STATION_UPGRADES_PARTIAL, SHIP_UPGRADES_PARTIAL, UPGRADE_ITEM_PARTIAL } =
    await import("../../scripts/ui/sheet/sheet-upgrades.mjs");
  const en = loadLang("en"),
    ru = loadLang("ru");
  const keys = Object.keys(en).filter((k) => k.startsWith("SF2eTSC.upgrades."));
  assert.ok(keys.length > 40);
  for (const k of keys) assert.ok(ru[k], `ru missing ${k}`);
  for (const code of [
    "needsStation",
    "escapePodsFull",
    "noStation",
    "incompatible",
    "capacity",
    "unknown",
    "tooMany",
    "notInstalled",
    "gmOnly",
    "invalidOp"
  ])
    assert.ok(en[`SF2eTSC.upgrades.errors.${code}`], code);
  for (const st of Object.keys(UPGRADE_USAGE)) assert.ok(en[`SF2eTSC.upgrades.usageKey.${st}`] && ru[`SF2eTSC.upgrades.usageKey.${st}`]);
  assert.equal(en["SF2eTSC.upgrades.title"], "Installed Upgrades");
  assert.equal(ru["SF2eTSC.upgrades.title"], "Установленные улучшения");
  const all = [STATION_UPGRADES_PARTIAL, SHIP_UPGRADES_PARTIAL, UPGRADE_ITEM_PARTIAL];
  for (const k of new Set(all.join("").match(/SF2eTSC\.upgrades\.[A-Za-z.]+[A-Za-z]/g))) assert.ok(en[k] && ru[k], k);
  for (const p of all)
    for (const b of ["if", "each", "unless"])
      assert.equal(
        (p.match(new RegExp(`\\{\\{#${b}\\b`, "g")) ?? []).length,
        (p.match(new RegExp(`\\{\\{/${b}\\}\\}`, "g")) ?? []).length,
        b
      );
  for (const t of ["templates/starship-sheet.hbs"]) {
    const s = fs.readFileSync(path.join(root, t), "utf8");
    assert.ok(s.includes("{{> tscStationUpgrades upgradeSection}}") && s.includes("{{> tscShipUpgrades shipUpgrades}}"), t);
    assert.ok(!s.includes("upgradeCatalog"), t);
  }
});
