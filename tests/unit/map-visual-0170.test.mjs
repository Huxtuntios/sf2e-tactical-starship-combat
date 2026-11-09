import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import {
  normalizeAngle,
  normalizeObjectTransform,
  normalizeMapAppearance,
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
  const obj = form({ objectMode: true, transform: {}, directions: [] });
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
