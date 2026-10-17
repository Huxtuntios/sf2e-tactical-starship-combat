import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import {
  DEFAULT_MAP_APPEARANCE,
  normalizeMapAppearance,
  safeImagePath,
  objectArtwork,
  MAP_PALETTES
} from "../../scripts/sensor/appearance.mjs";
import { defaultSensorState, normalizeSensorState, viewFor } from "../../scripts/engine/sensor-ops.mjs";
import { applySensorOp, sanitizeSensorPayload } from "../../scripts/sensor/map-model.mjs";
import { paintMapAppearance } from "../../scripts/ui/map-appearance-render.mjs";

const read = (name) => fs.readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const appearance = (overrides = {}) => normalizeMapAppearance({ ...DEFAULT_MAP_APPEARANCE, ...overrides });
const obj = {
  key: "Actor.a",
  actorUuid: "Actor.a",
  name: "Secret ship",
  type: "starship",
  zone: 2,
  art: "art/secret.webp",
  detection: { party: "identified" }
};
const state = () => defaultSensorState({ objects: [structuredClone(obj)] });

test("0.11.0 old combats acquire valid appearance without migration or mutation", () => {
  const old = defaultSensorState();
  assert.deepEqual(normalizeMapAppearance(normalizeSensorState(old).appearance), DEFAULT_MAP_APPEARANCE);
  assert.equal(old.appearance, undefined);
  assert.deepEqual(normalizeMapAppearance(null), DEFAULT_MAP_APPEARANCE);
  assert.deepEqual(normalizeMapAppearance("broken"), DEFAULT_MAP_APPEARANCE);
});

test("0.11.0 settings whitelist, bounds and malformed values", () => {
  const a = normalizeMapAppearance({
    theme: "invalid",
    mode: "bad",
    artSize: 400,
    opacity: -1,
    fade: 9,
    blur: Infinity,
    textColor: "red; color:black",
    mutedColor: "#00aBcD",
    extra: "ignored"
  });
  assert.equal(a.theme, "dark");
  assert.equal(a.mode, "art");
  assert.equal(a.artSize, 128);
  assert.equal(a.opacity, 0);
  assert.equal(a.fade, 1);
  assert.equal(a.blur, 2);
  assert.equal(a.textColor, "");
  assert.equal(a.mutedColor, "#00aBcD");
  assert.equal(a.extra, undefined);
  assert.equal(appearance({ artSize: -10 }).artSize, 32);
  assert.equal(appearance({ blur: 50 }).blur, 20);
  for (const key of ["opacity", "fade", "blur"]) assert.equal(appearance({ [key]: 0 })[key], 0);
  assert.equal(appearance({ opacity: "" }).opacity, 0.35);
});

test("0.11.0 image paths support Foundry, unicode, HTTP and reject injection protocols", () => {
  for (const path of [
    "worlds/my-world/art/корабль 1.webp",
    "/modules/test/art.svg",
    "https://cdn.example/art.png?q=1&x=2",
    "art/pilot's ship.png"
  ])
    assert.equal(safeImagePath(path), path);
  for (const path of [
    null,
    {},
    "",
    " javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "vbscript:foo",
    "file:///etc/passwd",
    "ftp://example.com/a.png",
    'a";color:red',
    "a\nb.png",
    "a\\b.png",
    "a<svg>.png"
  ])
    assert.equal(safeImagePath(path), "", String(path));
});

test("0.11.0 map art overrides portraits; ships and hazards resolve their own images", () => {
  assert.equal(
    objectArtwork({ ...obj, known: true }, appearance(), () => ({ img: "portrait.png" })),
    "art/secret.webp"
  );
  for (const type of ["starship", "hazard"]) {
    const known = { ...obj, type, art: "", known: true };
    assert.equal(
      objectArtwork(known, appearance(), () => ({ img: "portrait.png" })),
      "portrait.png"
    );
    assert.equal(
      objectArtwork(known, appearance(), () => ({ prototypeToken: { texture: { src: "token.webp" } } })),
      "token.webp"
    );
    assert.equal(
      objectArtwork(known, appearance(), () => null),
      ""
    );
  }
  assert.equal(objectArtwork({ type: "custom", known: true, art: "art/planet.webp" }, appearance()), "art/planet.webp");
});

test("0.11.0 simple mode never resolves documents or destroys stored art", () => {
  let lookups = 0;
  const s = state();
  assert.equal(
    objectArtwork({ ...obj, known: true }, appearance({ mode: "simple" }), () => {
      lookups++;
    }),
    ""
  );
  assert.equal(lookups, 0);
  assert.equal(s.objects[0].art, obj.art);
});

test("0.11.0 unidentified and hidden contacts never expose or resolve artwork", () => {
  for (const level of ["undetected", "hidden", "observed", "identified"]) {
    const s = state();
    s.objects[0].detection.party = level;
    const objects = viewFor(s);
    let lookups = 0;
    if (level === "undetected") {
      assert.equal(objects.length, 0);
      continue;
    }
    const o = objects[0];
    const image = objectArtwork(o, appearance(), () => {
      lookups++;
      return { img: "secret.png" };
    });
    if (level !== "identified") {
      assert.equal(image, "");
      assert.equal(o.art, undefined);
      assert.equal(o.actorUuid, undefined);
      assert.equal(lookups, 0);
    } else {
      assert.equal(image, obj.art);
      assert.equal(o.actorUuid, obj.actorUuid);
    }
  }
});

test("0.11.0 GM and owner views preserve artwork; GM-hidden objects stay absent for other players", () => {
  const s = state();
  s.objects[0].hidden = true;
  assert.equal(viewFor(s).length, 0);
  assert.equal(viewFor(s, { isGM: true })[0].art, obj.art);
  assert.equal(viewFor(s, { ownKeys: [obj.key] })[0].art, obj.art);
});

test("0.11.0 appearance and art ops are immutable, serializable and resettable", () => {
  const s = state();
  const next = applySensorOp(s, {
    op: "appearance",
    appearance: { theme: "light", mode: "simple", background: "art/bg.webp", opacity: 0, blur: 0 }
  });
  assert.equal(s.appearance, undefined);
  assert.equal(next.appearance.theme, "light");
  assert.equal(next.appearance.opacity, 0);
  assert.equal(next.appearance.blur, 0);
  assert.deepEqual(normalizeSensorState(JSON.parse(JSON.stringify(next))).appearance, next.appearance);
  const art = applySensorOp(next, { op: "art", key: obj.key, art: "art/new.webp" });
  assert.equal(art.objects[0].art, "art/new.webp");
  assert.equal(next.objects[0].art, obj.art);
  assert.equal(applySensorOp(art, { op: "art", key: obj.key, art: "" }).objects[0].art, "");
  assert.deepEqual(applySensorOp(art, { op: "appearance", appearance: {} }).appearance, DEFAULT_MAP_APPEARANCE);
});

test("0.11.0 a map-only art change cannot alter actor UUID, mechanics or other object fields", () => {
  const s = state();
  const next = applySensorOp(s, { op: "art", key: obj.key, art: "javascript:foo", actorUuid: "Actor.bad", zone: 12 });
  assert.equal(next.objects[0].art, "");
  assert.equal(next.objects[0].actorUuid, obj.actorUuid);
  assert.equal(next.objects[0].zone, 2);
  assert.deepEqual(applySensorOp(s, { op: "art", key: "missing", art: "x.png" }), s);
});

test("0.11.0 players cannot submit appearance/art or add independent images", () => {
  for (const op of ["art", "appearance", "add", "remove"]) {
    const payload = { op, key: obj.key, art: "x.png", appearance: { theme: "light" } };
    assert.equal(sanitizeSensorPayload({ isGM: false }, state(), payload), null);
    assert.equal(sanitizeSensorPayload({ isGM: true }, state(), payload), payload);
  }
});

function mockRoot(images = []) {
  const css = new Map();
  const viewport = {
    classList: {
      toggle: (key, value) => {
        viewport[key] = value;
      }
    }
  };
  const background = { style: {} };
  return {
    dataset: {},
    style: { setProperty: (k, v) => css.set(k, v) },
    css,
    viewport,
    background,
    querySelector: (selector) => (selector === ".tsc-map-viewport" ? viewport : background),
    querySelectorAll: () => images
  };
}

test("0.11.0 rendering applies both themes, custom colors and background-only filters", () => {
  const root = mockRoot();
  paintMapAppearance(root, {
    appearance: { theme: "light", textColor: "#112233", background: "art/bg.webp", opacity: 0.5, fade: 0.8, blur: 4 }
  });
  assert.equal(root.dataset.mapTheme, "light");
  assert.equal(root.css.get("--tsc-text"), "#112233");
  assert.equal(root.css.get("--tsc-bg"), MAP_PALETTES.light.bg);
  assert.equal(root.css.get("--tsc-dim"), MAP_PALETTES.light.dim);
  assert.equal(root.background.style.filter, "grayscale(0.8) blur(4px)");
  assert.equal(root.background.style.opacity, "0.5");
  assert.equal(root.viewport["has-background"], true);
  paintMapAppearance(root, { appearance: {} });
  assert.equal(root.dataset.mapTheme, "dark");
  assert.equal(root.css.get("--tsc-text"), MAP_PALETTES.dark.text);
  assert.equal(root.background.style.backgroundImage, "none");
  assert.equal(root.viewport["has-background"], false);
});

test("0.11.0 partial renders reapply background and art sizing to replaced roots", () => {
  const context = { appearance: { background: "art/bg.webp", artSize: 128, opacity: 0 } };
  const first = mockRoot(),
    replacement = mockRoot();
  paintMapAppearance(first, context);
  paintMapAppearance(replacement, context);
  assert.deepEqual(replacement.background.style, first.background.style);
  assert.equal(replacement.css.get("--tsc-art-size"), "128px");
  assert.equal(replacement.background.style.opacity, "0");
});

test("0.11.0 broken and already-failed images fall back once to the old symbol", () => {
  for (const complete of [false, true]) {
    const handlers = [],
      image = {
        dataset: {},
        complete,
        naturalWidth: 0,
        hidden: false,
        nextElementSibling: { hidden: true },
        addEventListener: (name, fn) => handlers.push(fn)
      };
    const root = mockRoot([image]);
    paintMapAppearance(root, {});
    paintMapAppearance(root, {});
    assert.equal(handlers.length, 1);
    if (!complete) handlers[0]();
    assert.equal(image.hidden, true);
    assert.equal(image.nextElementSibling.hidden, false);
  }
});

test("0.11.0 templates expose GM controls and escape artwork paths", () => {
  const h = Handlebars.create();
  h.registerHelper("localize", (k) => k);
  const html = h.compile(read("templates/sensor-map-zones.hbs"))({
    zones: [{ zone: 1, objects: [{ key: "x", label: "X", art: 'evil.png" onerror="alert(1)' }] }]
  });
  assert.match(html, /class="tsc-map-background"/);
  assert.match(html, /class="tsc-object-art"/);
  assert.ok(!html.includes('src="evil.png" onerror='));
  assert.match(html, /&quot;/);
  const toolbar = h.compile(read("templates/sensor-map-bar.hbs"));
  assert.ok(!toolbar({ isGM: false }).includes('data-action="mapAppearance"'));
  assert.ok(toolbar({ isGM: true }).includes('data-action="mapAppearance"'));
  const form = h.compile(read("templates/map-appearance.hbs"));
  assert.match(form({ objectMode: true }), /name="art"/);
  assert.match(form({ a: {} }), /name="background"/);
});

test("0.11.0 glossary terminology is consistent in UI, build inputs and all compiled source documents", () => {
  const ui = JSON.parse(read("lang/ru.json")).SF2eTSC;
  const glossary = JSON.parse(read("lang/content/glossary.json"));
  assert.equal(ui.ui.ac, "КД");
  assert.equal(ui.ui.traits, "Признаки");
  assert.equal(glossary.terms.ac, ui.ui.ac);
  assert.equal(glossary.terms.traits, ui.ui.traits);
  const roots = ["lang", "docs", "data", "tools/i18n/ru", "packs-src"];
  const walk = (path) =>
    fs
      .readdirSync(path, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(`${path}/${e.name}`) : /\.(json|md)$/.test(e.name) ? [`${path}/${e.name}`] : []));
  for (const dir of roots.filter((name) => fs.existsSync(new URL(`../../${name}`, import.meta.url))))
    for (const file of walk(new URL(`../../${dir}`, import.meta.url).pathname)) {
      const text = fs.readFileSync(file, "utf8");
      assert.ok(!/(?<![А-Яа-яЁё])(?:КБ|[Чч]ерт(?:а|ы|у|ой|ами|е)?)(?![А-Яа-яЁё])/.test(text), file);
    }
});
