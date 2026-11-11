import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import {
  normalizeAngle,
  normalizeObjectTransform,
  normalizeMapAppearance,
  resolveArrowAppearance,
  visualTransform,
  changedFields
} from "../../scripts/sensor/appearance.mjs";
import { defaultSensorState, viewFor, normalizeSensorState } from "../../scripts/engine/sensor-ops.mjs";
import { applySensorOp, sanitizeSensorPayload } from "../../scripts/sensor/map-model.mjs";

const ship = {
  key: "Actor.x",
  actorUuid: "Actor.x",
  type: "starship",
  name: "Secret",
  zone: 2,
  heading: "left",
  art: "ship.webp",
  detection: { party: "identified" }
};
const state = () => defaultSensorState({ objects: [structuredClone(ship)] });
test("angles normalize, and flips compose without changing stored transform", () => {
  for (const [input, output] of [
    [-45, 315],
    [360, 0],
    [721, 1],
    [-720, 0],
    [Infinity, 0],
    ["not a number", 0]
  ])
    assert.equal(normalizeAngle(input), output);
  const t = { rotation: -45, flipX: true, flipY: true, baseDirection: "right" };
  assert.deepEqual(visualTransform(t, "left", true), {
    rotation: 315,
    flipX: true,
    flipY: true,
    baseDirection: "right",
    auto: true,
    scaleX: 1,
    scaleY: -1
  });
  assert.equal(visualTransform(t, "right", true).scaleX, -1);
  assert.equal(visualTransform(t, "left", false).scaleX, -1);
  assert.equal(t.rotation, -45);
  for (const baseDirection of ["up", "down"]) assert.equal(visualTransform({ baseDirection }, "left", true).auto, false);
  assert.equal(visualTransform({ baseDirection: "left" }, "right", true).scaleX, -1);
  assert.equal(visualTransform({}, "unknown", true).auto, false);
  assert.deepEqual(normalizeObjectTransform(null), { rotation: 0, flipX: false, flipY: false, baseDirection: "right" });
});
test("settings normalize invalid input and legacy maps retain defaults", () => {
  const a = normalizeMapAppearance({
    arrowMode: "bad",
    arrowImage: "javascript:bad",
    arrowSize: 400,
    arrowGap: -1,
    arrowPosition: "bad",
    arrowOpacity: 2,
    backgroundRotation: -45
  });
  assert.equal(a.arrowMode, "text");
  assert.equal(a.arrowImage, "");
  assert.equal(a.arrowSize, 64);
  assert.equal(a.arrowGap, 0);
  assert.equal(a.arrowPosition, "right");
  assert.equal(a.arrowOpacity, 1);
  assert.equal(a.backgroundRotation, 315);
  assert.equal(normalizeMapAppearance(normalizeSensorState(state()).appearance).autoMirror, false);
  assert.deepEqual(changedFields({ a: 1, b: 2 }, { a: 1, b: 3 }, ["a", "b"]), { b: 3 });
});
test("object auto-mirroring overrides the global setting and recomputes from each heading", () => {
  const transform = { rotation: 20, flipX: false, flipY: true, baseDirection: "right" };
  const auto = (heading, global, override) => visualTransform(transform, heading, global, override);

  assert.equal(auto("left", true, null).auto, true);
  assert.equal(auto("left", false, null).auto, false);
  assert.equal(auto("left", false, true).auto, true);
  assert.equal(auto("left", true, false).auto, false);
  assert.equal(auto("right", true, null).scaleX, 1);
  assert.equal(auto("left", true, null).scaleX, -1);
  assert.equal(auto("right", true, null).scaleX, 1);
  assert.equal(auto("left", true, true).scaleX, -1);
  assert.equal(auto("left", true, false).scaleX, 1);
  assert.equal(auto("left", true, true).scaleY, -1);
  assert.deepEqual(transform, { rotation: 20, flipX: false, flipY: true, baseDirection: "right" });

  let s = state();
  s.appearance = { autoMirror: true };
  s = applySensorOp(s, { op: "objectVisual", key: ship.key, visual: { autoMirrorOverride: false } });
  assert.equal(s.objects[0].autoMirrorOverride, false);
  assert.equal(viewFor(s)[0].autoMirrorOverride, false);
  const persisted = normalizeSensorState(JSON.parse(JSON.stringify(s)));
  assert.equal(persisted.objects[0].autoMirrorOverride, false);
  s = applySensorOp(s, { op: "objectVisual", key: ship.key, visual: { autoMirrorOverride: null } });
  assert.equal(s.objects[0].autoMirrorOverride, null);
  assert.equal(visualTransform(transform, "left", s.appearance.autoMirror, s.objects[0].autoMirrorOverride).auto, true);
  assert.equal(applySensorOp(s, { op: "objectVisual", key: ship.key, visual: { autoMirrorOverride: "false" } }), s);
  const legacy = state();
  assert.equal(viewFor(legacy)[0].autoMirrorOverride, null);
});
test("object arrow formats inherit live globals, override them, and reset without changing game state", () => {
  assert.deepEqual(resolveArrowAppearance({}, null), {
    arrowMode: "text",
    arrowImage: "",
    arrowSize: 18,
    arrowGap: 4,
    arrowPosition: "right",
    arrowOpacity: 1
  });
  const global = {
    arrowMode: "emoji",
    arrowImage: "global-arrow.webp",
    arrowSize: 20,
    arrowGap: 6,
    arrowPosition: "top",
    arrowOpacity: 0.6,
    autoMirror: true
  };
  let s = state();
  s.appearance = global;

  const inherited = viewFor(s)[0];
  assert.deepEqual(resolveArrowAppearance(s.appearance, inherited.arrowAppearance), {
    arrowMode: "emoji",
    arrowImage: "global-arrow.webp",
    arrowSize: 20,
    arrowGap: 6,
    arrowPosition: "top",
    arrowOpacity: 0.6
  });
  s = applySensorOp(s, { op: "appearancePatch", appearance: { arrowSize: 28, arrowOpacity: 0.9 } });
  assert.equal(resolveArrowAppearance(s.appearance, viewFor(s)[0].arrowAppearance).arrowSize, 28);
  assert.equal(resolveArrowAppearance(s.appearance, viewFor(s)[0].arrowAppearance).arrowOpacity, 0.9);

  const objectFormat = {
    arrowMode: "custom",
    arrowImage: "object-arrow.webp",
    arrowSize: 32,
    arrowGap: 3,
    arrowPosition: "left",
    arrowOpacity: 0.4
  };
  s = applySensorOp(s, { op: "objectVisual", key: ship.key, visual: { arrowAppearance: objectFormat } });
  assert.deepEqual(resolveArrowAppearance(s.appearance, viewFor(s)[0].arrowAppearance), objectFormat);
  s = normalizeSensorState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(resolveArrowAppearance(s.appearance, viewFor(s)[0].arrowAppearance), objectFormat);
  s = applySensorOp(s, { op: "appearancePatch", appearance: { arrowMode: "none", arrowSize: 40 } });
  assert.deepEqual(resolveArrowAppearance(s.appearance, viewFor(s)[0].arrowAppearance), objectFormat);

  s.objects[0].mapTransform = { rotation: 90, flipX: true, baseDirection: "right" };
  const originalGameData = {
    heading: s.objects[0].heading,
    zone: s.objects[0].zone,
    detection: structuredClone(s.objects[0].detection),
    actorUuid: s.objects[0].actorUuid
  };
  const transform = visualTransform(s.objects[0].mapTransform, s.objects[0].heading, s.appearance.autoMirror);
  assert.equal(transform.rotation, 90);
  assert.equal(transform.auto, true);
  assert.equal(transform.scaleX, 1);
  assert.equal(s.objects[0].heading, originalGameData.heading);
  assert.equal(s.objects[0].zone, originalGameData.zone);
  assert.deepEqual(s.objects[0].detection, originalGameData.detection);
  assert.equal(s.objects[0].actorUuid, originalGameData.actorUuid);

  s = applySensorOp(s, { op: "objectVisual", key: ship.key, visual: { arrowAppearance: null } });
  assert.equal(s.objects[0].arrowAppearance, null);
  const reset = resolveArrowAppearance(s.appearance, viewFor(s)[0].arrowAppearance);
  assert.equal(reset.arrowMode, "none");
  assert.equal(reset.arrowSize, 40);
  assert.equal(reset.arrowPosition, "top");
  assert.equal(s.objects[0].heading, originalGameData.heading);
});
test("arrow reset updates only form fields and persisted override clears on Save", async () => {
  const { installFoundryMock } = await import("../helpers/foundry-mock.mjs");
  installFoundryMock();
  const { resetArrowAppearanceForm, objectVisualFromForm } = await import("../../scripts/ui/map-appearance-app.mjs");
  const globalAppearance = {
    arrowMode: "emoji",
    arrowImage: "global-arrow.webp",
    arrowSize: 21,
    arrowGap: 5,
    arrowPosition: "bottom",
    arrowOpacity: 0.7
  };
  const controls = {
    arrowAppearanceMode: { value: "override" },
    arrowMode: { value: "custom" },
    arrowImage: { value: "draft-arrow.webp" },
    arrowSize: { value: "38" },
    arrowGap: { value: "12" },
    arrowPosition: { value: "left" },
    arrowOpacity: { value: "0.3" },
    art: { value: "unsaved-art.webp" },
    rotation: { value: "90" },
    flipX: { checked: true },
    flipY: { checked: true }
  };
  const preview = {
    src: "",
    hidden: true,
    removeAttribute(name) {
      if (name === "src") this.src = "";
    }
  };
  const form = {
    querySelector(selector) {
      const field = selector.match(/\[name="([^"]+)"\]/)?.[1];
      return field ? (controls[field] ?? null) : selector.includes("data-image-preview") ? preview : null;
    }
  };
  let s = state();
  s.appearance = globalAppearance;
  s.objects[0].arrowAppearance = {
    arrowMode: "custom",
    arrowImage: "saved-arrow.webp",
    arrowSize: 30,
    arrowGap: 8,
    arrowPosition: "left",
    arrowOpacity: 0.5
  };

  resetArrowAppearanceForm(form, globalAppearance);
  assert.equal(controls.arrowAppearanceMode.value, "inherit");
  assert.deepEqual(
    Object.fromEntries(
      ["arrowMode", "arrowImage", "arrowSize", "arrowGap", "arrowPosition", "arrowOpacity"].map((key) => [key, controls[key].value])
    ),
    {
      arrowMode: "emoji",
      arrowImage: "global-arrow.webp",
      arrowSize: 21,
      arrowGap: 5,
      arrowPosition: "bottom",
      arrowOpacity: 0.7
    }
  );
  assert.equal(preview.src, "global-arrow.webp");
  assert.equal(preview.hidden, false);
  assert.equal(controls.art.value, "unsaved-art.webp");
  assert.equal(controls.rotation.value, "90");
  assert.equal(controls.flipX.checked, true);
  assert.equal(controls.flipY.checked, true);
  assert.equal(s.objects[0].arrowAppearance.arrowImage, "saved-arrow.webp");

  const visual = objectVisualFromForm(
    {
      art: controls.art.value,
      rotation: controls.rotation.value,
      flipX: controls.flipX.checked,
      flipY: controls.flipY.checked,
      baseDirection: "right",
      autoMirrorOverride: "inherit",
      arrowAppearanceMode: controls.arrowAppearanceMode.value,
      arrowMode: controls.arrowMode.value,
      arrowImage: controls.arrowImage.value,
      arrowSize: controls.arrowSize.value,
      arrowGap: controls.arrowGap.value,
      arrowPosition: controls.arrowPosition.value,
      arrowOpacity: controls.arrowOpacity.value
    },
    {
      art: "ship.webp",
      rotation: 0,
      flipX: false,
      flipY: false,
      baseDirection: "right",
      autoMirrorOverride: null,
      arrowAppearanceOverride: s.objects[0].arrowAppearance
    },
    globalAppearance
  );
  assert.deepEqual(visual, {
    transform: { rotation: 90, flipX: true, flipY: true },
    art: "unsaved-art.webp",
    arrowAppearance: null
  });
  s = applySensorOp(s, { op: "objectVisual", key: ship.key, visual });
  assert.equal(s.objects[0].arrowAppearance, null);
  assert.equal(s.objects[0].art, "unsaved-art.webp");
  assert.equal(s.objects[0].mapTransform.rotation, 90);
  assert.equal(s.objects[0].mapTransform.flipX, true);
  assert.equal(s.objects[0].mapTransform.flipY, true);
  assert.equal(s.objects[0].heading, "left");
});
test("visual edits preserve game state, other objects and unknown data", () => {
  const s = state();
  s.objects[0].mapTransform = { custom: "preserve", rotation: 25 };
  s.objects.push({ ...ship, key: "Actor.y" });
  s.appearance = { unknown: 7, arrowSize: 18 };
  const visual = applySensorOp(s, {
    op: "objectVisual",
    key: ship.key,
    visual: { transform: { rotation: 405, flipX: true, zone: 12 }, zone: 12, actorUuid: "evil" }
  });
  assert.deepEqual(visual.objects[0].mapTransform, { custom: "preserve", rotation: 45, flipX: true, flipY: false, baseDirection: "right" });
  assert.equal(visual.objects[0].zone, 2);
  assert.equal(visual.objects[0].heading, "left");
  assert.equal(visual.objects[0].actorUuid, ship.actorUuid);
  assert.deepEqual(visual.objects[1], s.objects[1]);
  assert.deepEqual(
    applySensorOp(visual, { op: "objectVisual", key: ship.key, visual: { transform: { rotation: 405, flipX: true } } }),
    visual
  );
  const settings = applySensorOp(visual, { op: "appearancePatch", appearance: { arrowMode: "emoji", arbitrary: "ignore" } });
  assert.equal(settings.appearance.unknown, 7);
  assert.equal(settings.appearance.arbitrary, undefined);
  assert.equal(settings.appearance.arrowMode, "emoji");
  const loaded = normalizeSensorState(JSON.parse(JSON.stringify(settings)));
  assert.deepEqual(loaded.objects[0].mapTransform, settings.objects[0].mapTransform);
  assert.deepEqual(loaded.appearance, settings.appearance);
});
test("visual permissions and unidentified contact privacy remain enforced", () => {
  const s = state();
  for (const op of ["objectVisual", "appearancePatch"]) {
    const p = { op, key: ship.key };
    assert.equal(sanitizeSensorPayload({ isGM: false }, s, p), null);
    assert.equal(sanitizeSensorPayload({ isGM: true }, s, p), p);
  }
  s.objects[0].mapTransform = { rotation: 90, baseDirection: "up" };
  s.objects[0].detection.party = "observed";
  const unknown = viewFor(s)[0];
  assert.equal(unknown.mapTransform, undefined);
  assert.equal(unknown.art, undefined);
});
test("templates contain distinct controls and escape custom image paths", () => {
  const h = Handlebars.create();
  h.registerHelper("localize", (k) => k);
  const form = h.compile(fs.readFileSync(new URL("../../templates/map-appearance.hbs", import.meta.url), "utf8"));
  const all = form({ a: {}, arrowModes: [{ id: "custom", label: "Custom" }], positions: [] });
  for (const name of [
    "arrowMode",
    "arrowImage",
    "arrowSize",
    "arrowGap",
    "arrowPosition",
    "arrowOpacity",
    "autoMirror",
    "backgroundRotation",
    "backgroundFlipX",
    "backgroundFlipY"
  ])
    assert.match(all, new RegExp(`name="${name}"`));
  const obj = form({
    objectMode: true,
    transform: {},
    directions: [],
    autoMirrorOptions: [{ id: "inherit", selected: true }, { id: "on" }, { id: "off" }],
    arrowAppearance: {
      arrowMode: "custom",
      arrowImage: "object-arrow.webp",
      arrowSize: 24,
      arrowGap: 7,
      arrowPosition: "left",
      arrowOpacity: 0.5
    },
    arrowModes: [{ id: "custom", selected: true }],
    positions: [{ id: "left", selected: true }],
    arrowAppearanceOptions: [{ id: "inherit" }, { id: "override", selected: true }],
    arrowAppearanceMode: "override",
    arrowAppearanceOverridden: true
  });
  assert.match(obj, /name="autoMirrorOverride"/);
  for (const id of ["inherit", "on", "off"]) assert.match(obj, new RegExp(`value="${id}"`));
  assert.match(obj, /name="arrowAppearanceMode"/);
  for (const id of ["inherit", "override"]) assert.match(obj, new RegExp(`value="${id}"`));
  for (const name of ["arrowMode", "arrowImage", "arrowSize", "arrowGap", "arrowPosition", "arrowOpacity"])
    assert.match(obj, new RegExp(`name="${name}"`));
  assert.match(obj, /data-action="resetArrowAppearance"/);
  assert.doesNotMatch(obj, /data-action="resetArrowAppearance" disabled/);
  for (const op of ["left", "right", "resetRotation", "resetFlipping", "resetAll"]) assert.match(obj, new RegExp(`data-op="${op}"`));
  const template = h.compile(fs.readFileSync(new URL("../../templates/sensor-map-zones.hbs", import.meta.url), "utf8"));
  const html = template({
    zones: [
      {
        zone: 1,
        objects: [
          { key: "x", arrow: "→", arrowCustom: true, arrowImage: 'x" onerror="bad', transform: { rotation: 45, scaleX: -1, scaleY: 1 } }
        ]
      }
    ]
  });
  assert.match(html, /rotate\(45deg\) scale\(-1, 1\)/);
  assert.ok(!html.includes('src="x" onerror='));
});

test("GM map requests serialize and duplicate absolute edits do not write again (mock)", async () => {
  const { installFoundryMock, makeStarshipCombat } = await import("../helpers/foundry-mock.mjs");
  const { registerSensorHandlers } = await import("../../scripts/sensor/map-handlers.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  const { getTsc } = await import("../../scripts/combat/tsc-state.mjs");
  installFoundryMock();
  const combat = makeStarshipCombat({ objects: [ship] });
  const update = combat.update.bind(combat);
  let writes = 0;
  combat.update = async (...args) => {
    writes++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return update(...args);
  };
  registerSensorHandlers();
  const responses = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (v) => responses.push(v) };
  const send = (payload, id, sender = "gm") =>
    dispatchSocketMessage(
      { kind: "request", type: "sensorUpdate", userId: sender, requestId: id, payload: { combatId: combat.id, ...payload } },
      sender,
      env
    );
  const a = { op: "objectVisual", key: ship.key, visual: { transform: { rotation: 45 } } };
  const b = { op: "objectVisual", key: ship.key, visual: { transform: { flipX: true } } };
  await Promise.all([send(a, "a"), send(b, "b"), send(a, "c")]);
  assert.equal(getTsc(combat).objects[0].mapTransform.rotation, 45);
  assert.equal(getTsc(combat).objects[0].mapTransform.flipX, true);
  assert.equal(writes, 2);
  await send({ op: "appearancePatch", appearance: { arrowMode: "none" } }, "d", "p1");
  assert.equal(responses.find((r) => r.requestId === "d").ok, false);
  assert.equal(writes, 2);
  assert.equal(responses.filter((r) => r.ok).length, 3);
});
