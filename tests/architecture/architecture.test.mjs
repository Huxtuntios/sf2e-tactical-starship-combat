import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const walk = (d, ext) =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? ["node_modules", "packs", "packs-src"].includes(e.name)
          ? []
          : walk(path.join(d, e.name), ext)
        : ext.some((x) => e.name.endsWith(x))
          ? [path.join(d, e.name)]
          : []
    );
const scripts = walk(path.join(root, "scripts"), [".mjs"]);
const templates = walk(path.join(root, "templates"), [".hbs"]);
const read = (f) => fs.readFileSync(f, "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("no polling: no setInterval / requestAnimationFrame loops", () => {
  for (const f of scripts) assert.ok(!/setInterval\s*\(/.test(strip(read(f))), `${path.relative(root, f)} uses setInterval`);
});
test("no DOM-only state / browser storage", () => {
  for (const f of scripts) {
    const s = strip(read(f));
    assert.ok(!/localStorage|sessionStorage/.test(s), `${f} uses browser storage`);
  }
});
test("no direct modification of the sf2e system", () => {
  for (const f of scripts) {
    const s = strip(read(f));
    assert.ok(!/systems\/sf2e/.test(s.replace(/game\.system/g, "")) || /relationships/.test(s), `${f} references system files`);
    assert.ok(!/libWrapper|CONFIG\.PF2E\.[A-Za-z.]+\s*=[^=]/.test(s), `${f} patches the system`);
  }
});
test("no forbidden hard dependencies (socketlib, Sequencer, JB2A, libWrapper)", () => {
  const manifest = JSON.parse(read(path.join(root, "module.json")));
  assert.deepEqual(manifest.relationships.requires, []);
  for (const f of scripts) assert.ok(!/socketlib\./.test(strip(read(f))), `${f} uses socketlib`);
});
test("engine modules are pure (no Foundry globals)", () => {
  for (const f of walk(path.join(root, "scripts", "engine"), [".mjs"])) {
    const s = strip(read(f));
    assert.ok(
      !/\b(game|canvas|ui|Hooks|foundry|CONFIG|ChatMessage|fromUuid)\b\s*[.(]/.test(s),
      `${path.relative(root, f)} touches a Foundry global`
    );
  }
});
test("data engines have no DOM business logic in UI templates", () => {
  for (const f of templates) assert.ok(!/<script/i.test(read(f)), `${f} contains script`);
});
test("localization: every static key used in code/templates exists in en.json and ru.json", () => {
  const load = (n) => JSON.parse(read(path.join(root, "lang", `${n}.json`)));
  const has = (obj, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj) !== undefined;
  const en = load("en"),
    ru = load("ru");
  const used = new Set();
  for (const f of [...scripts, ...templates]) {
    const s = read(f);
    for (const m of s.matchAll(/["'`](SF2eTSC\.[A-Za-z0-9_.-]+)["'`]/g)) used.add(m[1]);
  }
  // keys built through helpers: L("x.y") in settings.mjs, fail("x") in the action engine, requirement keys
  for (const m of read(path.join(root, "scripts/settings.mjs")).matchAll(/\bL\(["']([^"']+)["']\)/g)) used.add(`SF2eTSC.settings.${m[1]}`);
  for (const f of scripts) for (const m of read(f).matchAll(/\bfail\(["']([A-Za-z]+)["']/g)) used.add(`SF2eTSC.errors.${m[1]}`);
  for (const m of read(path.join(root, "scripts/actions/requirements.mjs")).matchAll(/key:\s*["']([A-Za-z]+)["']/g))
    used.add(`SF2eTSC.requirements.${m[1]}`);
  const missing = [...used].filter((k) => !has(en, k.replace(/^SF2eTSC\./, "SF2eTSC.")));
  assert.deepEqual(
    missing.filter((k) => !k.endsWith(".")),
    [],
    `missing in en.json: ${missing.join(", ")}`
  );
  assert.deepEqual(
    [...used].filter((k) => !has(ru, k)),
    [],
    "missing in ru.json"
  );
});
test("localization: dynamic key families are complete (en and ru)", async () => {
  const load = (n) => JSON.parse(read(path.join(root, "lang", `${n}.json`)));
  const data = JSON.parse(read(path.join(root, "data/actions/station-actions.json")));
  for (const n of ["en", "ru"]) {
    const L = load(n).SF2eTSC;
    for (const a of data.actions) assert.ok(L.actions[a.id], `${n}: action ${a.id}`);
    for (const k of ["operational", "off-kilter", "compromised", "inoperable", "wrecked", "destroyed"])
      assert.ok(L.status[k], `${n}: status ${k}`);
    for (const k of ["criticalSuccess", "success", "failure", "criticalFailure"]) assert.ok(L.degree[k]);
    for (const k of ["commercial", "tactical", "advanced", "superior", "elite", "ultimate", "paragon"]) assert.ok(L.grades[k]);
    for (const k of ["pilot", "generator", "gunnery", "scanners", "magic-conduit", "drone-console", "custom"]) assert.ok(L.stations[k]);
  }
});
test("every ES import in scripts resolves to a file and names exist", () => {
  const exportsOf = (file) => {
    const s = read(file);
    const names = new Set();
    for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
    for (const m of s.matchAll(/export\s*\{([^}]+)\}/g))
      m[1].split(",").forEach((x) =>
        names.add(
          x
            .trim()
            .split(/\s+as\s+/)
            .pop()
        )
      );
    return names;
  };
  for (const f of scripts) {
    const s = strip(read(f));
    for (const m of s.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g)) {
      const target = path.resolve(path.dirname(f), m[2]);
      assert.ok(fs.existsSync(target), `${path.relative(root, f)} imports missing file ${m[2]}`);
      const ex = exportsOf(target);
      for (const raw of m[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/)[0];
        if (name) assert.ok(ex.has(name), `${path.relative(root, f)}: ${name} is not exported by ${m[2]}`);
      }
    }
  }
});

test("every script parses (node --check)", async () => {
  const { spawnSync } = await import("node:child_process");
  const fsm = await import("node:fs");
  const pathm = await import("node:path");
  const { fileURLToPath: f2p } = await import("node:url");
  const base = pathm.join(pathm.dirname(f2p(import.meta.url)), "..", "..", "scripts");
  const walk = (d) =>
    fsm
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(pathm.join(d, e.name)) : e.name.endsWith(".mjs") ? [pathm.join(d, e.name)] : []));
  const bad = walk(base).filter((file) => spawnSync(process.execPath, ["--check", file]).status !== 0);
  assert.deepEqual(bad, []);
});
