import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat, loadContentFromDisk } from "../helpers/foundry-mock.mjs";
import { initialShipTransform } from "../../scripts/sensor/appearance.mjs";
import { normalizeStarship, defaultStarship } from "../../scripts/engine/validation.mjs";
import { dropActorOnMap } from "../../scripts/sensor/actor-drop.mjs";
import { defaultSensorState } from "../../scripts/engine/sensor-ops.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";

const empty = () => defaultSensorState({ enabled: true, zones: 12 });
const TRANSFORM = { rotation: 90, flipX: true, flipY: false, baseDirection: "left" };

test("initialShipTransform prefers a stored transform, else faces the sheet heading", () => {
  assert.deepEqual(initialShipTransform(null, "left"), { rotation: 0, flipX: false, flipY: false, baseDirection: "left" });
  assert.deepEqual(initialShipTransform(null, undefined), { rotation: 0, flipX: false, flipY: false, baseDirection: "right" });
  assert.deepEqual(initialShipTransform({ rotation: 90, baseDirection: "left", flipX: true }, "right"), TRANSFORM);
});

test("starship data normalizes and persists mapTransform", () => {
  assert.equal(defaultStarship().mapTransform, null);
  assert.equal(normalizeStarship({}).data.mapTransform, null);
  assert.deepEqual(normalizeStarship({ mapTransform: { rotation: 90, baseDirection: "left", flipX: true } }).data.mapTransform, TRANSFORM);
  assert.equal(normalizeStarship({ mapTransform: "bad" }).data.mapTransform, null);
});

test("dropping a ship with a stored transform reuses it instead of the heading default", () => {
  installFoundryMock();
  const ship = makeShip({ id: "stored" });
  ship.flags[MODULE_ID].starship.heading = "right";
  ship.flags[MODULE_ID].starship.mapTransform = { rotation: 90, flipX: true, baseDirection: "left" };
  const o = dropActorOnMap(empty(), ship, 1, { publicActor: true }).state.objects[0];
  assert.deepEqual(o.mapTransform, TRANSFORM);
});

test("editing object art orientation remembers it on the Actor and copies inherit it", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { sensorUpdate } = await import("../../scripts/sensor/map-handlers.mjs");
  const { getTsc } = await import("../../scripts/combat/tsc-state.mjs");
  const { createActorCopy } = await import("../../scripts/combat/copies.mjs");
  const { readStarship } = await import("../../scripts/starship/starship-state.mjs");
  const ship = makeShip({ id: "orient", role: "player" });
  const combat = makeStarshipCombat();
  const user = game.users.get("gm");
  await sensorUpdate({ user, payload: { combatId: combat.id, op: "dropActor", actorUuid: ship.uuid, zone: 2, publicActor: true } });
  const object = getTsc(combat).objects[0];
  const instance = fromUuidSync(object.actorUuid);
  await sensorUpdate({
    user,
    payload: {
      combatId: combat.id,
      op: "objectVisual",
      key: object.key,
      visual: { transform: { rotation: 90, baseDirection: "left", flipX: true } }
    }
  });
  assert.deepEqual(readStarship(instance).mapTransform, TRANSFORM);
  assert.deepEqual(getTsc(combat).objects[0].mapTransform, TRANSFORM);
  const copy = await createActorCopy(instance, { name: "copy" });
  assert.deepEqual(readStarship(copy).mapTransform, TRANSFORM);
});

test("object orientation menu offers left/right for a ship with a horizontal base direction", async () => {
  installFoundryMock();
  const { MapAppearanceApplication } = await import("../../scripts/ui/map-appearance-app.mjs");
  const ship = makeShip({ id: "menu" });
  const combat = makeStarshipCombat({
    objects: [{ key: ship.uuid, type: "starship", heading: "left", mapTransform: { baseDirection: "left" } }]
  });
  const app = new MapAppearanceApplication(combat, ship.uuid);
  const ctx = await app._prepareContext();
  assert.deepEqual(
    ctx.directions.map((d) => d.id),
    ["left", "right"]
  );
  assert.equal(ctx.directions.find((d) => d.selected).id, "left");
});

test("a legacy saved direction is preserved until the GM explicitly changes it", async () => {
  installFoundryMock();
  const { MapAppearanceApplication, objectVisualFromForm } = await import("../../scripts/ui/map-appearance-app.mjs");
  const ship = makeShip({ id: "legacy" });
  const combat = makeStarshipCombat({
    objects: [{ key: ship.uuid, type: "starship", heading: "left", mapTransform: { baseDirection: "unknown" }, art: "" }]
  });
  const app = new MapAppearanceApplication(combat, ship.uuid);
  const ctx = await app._prepareContext();
  assert.deepEqual(
    ctx.directions.map((d) => d.id),
    ["unknown", "left", "right"]
  );
  assert.equal(ctx.directions.find((d) => d.selected).id, "unknown");
  const visual = objectVisualFromForm(
    {
      baseDirection: "unknown",
      rotation: 0,
      flipX: false,
      flipY: false,
      art: "new-art.webp",
      autoMirrorOverride: "inherit",
      arrowAppearanceMode: "inherit"
    },
    app._objectSnapshot,
    app._appearanceSnapshot
  );
  assert.equal(visual.art, "new-art.webp");
  assert.equal(visual.transform, undefined);
});
