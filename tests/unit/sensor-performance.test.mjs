import test from "node:test";
import assert from "node:assert/strict";
import { MapActorCache } from "../../scripts/sensor/map-actor-cache.mjs";
import { backgroundReady, paintMapBackground, releaseMapBackground, MAP_BACKGROUND_TIMEOUT } from "../../scripts/ui/map-background.mjs";
import { installFoundryMock, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { computeShipStats } from "../../scripts/starship/stats.mjs";
import { Content } from "../../scripts/content/loader.mjs";

const user = { id: "player", isGM: false, role: 1 };
const known = (uuid) => ({ known: true, type: "starship", actorUuid: uuid });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

function imageMocks(t, { encode = null, tainted = false } = {}) {
  const images = [],
    canvases = [],
    created = [],
    revoked = [];
  const previousImage = globalThis.Image,
    previousDocument = globalThis.document;
  globalThis.Image = class {
    constructor() {
      images.push(this);
      this.assignments = [];
    }
    set src(value) {
      this.assignments.push(value);
    }
    finish(width, height) {
      this.naturalWidth = width;
      this.naturalHeight = height;
      this.onload?.();
    }
  };
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (callback, type) => {
          canvas.encoded = [canvas.width, canvas.height, type];
          if (tainted) throw new Error("SecurityError");
          if (encode) encode(callback);
          else callback({ type });
        }
      };
      canvases.push(canvas);
      return canvas;
    }
  };
  t.mock.method(URL, "createObjectURL", (blob) => {
    created.push(blob);
    return `blob:test-${created.length}`;
  });
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  t.after(() => {
    globalThis.Image = previousImage;
    globalThis.document = previousDocument;
  });
  return { images, canvases, created, revoked, layer: { dataset: {}, style: { backgroundImage: "none" } } };
}

installFoundryMock();
const { SensorMapApplication, invalidateSensorMapActors } = await import("../../scripts/ui/sensor-map-app.mjs");

test("production context: 320 known objects share actor/data/stats through repeated zones/detail/dock renders", async () => {
  installFoundryMock();
  const ships = Array.from({ length: 8 }, (_, i) => makeShip({ id: `cached-${i}`, name: `Ship ${i}`, role: "npc" }));
  const objects = Array.from({ length: 320 }, (_, i) => ({
    key: `object-${i}`,
    actorUuid: ships[i % 8].uuid,
    name: `Object ${i}`,
    type: "starship",
    zone: (i % 12) + 1
  }));
  makeStarshipCombat({ objects });
  const app = new SensorMapApplication();
  let resolutions = 0,
    reads = 0,
    stats = 0;
  app.actorCache = new MapActorCache({
    resolve: async (uuid) => {
      resolutions++;
      return ships.find((s) => s.uuid === uuid);
    },
    read: (actor) => {
      reads++;
      return readStarship(actor);
    },
    stats: (actor) => {
      stats++;
      return computeShipStats(actor);
    }
  });
  app.selected = "object-0";
  for (let i = 0; i < 6; i++) {
    const context = await app._prepareContext({ parts: ["zones", "detail"] });
    assert.equal(context.zones.flatMap((z) => z.objects).length, 320);
    assert.equal(context.detail.canAddToInitiative, true);
    assert.equal(context.dock, undefined);
  }
  assert.deepEqual([resolutions, reads, stats], [8, 8, 1]);
  // A dock-only context must neither resolve map actors nor normalize/decorate the zones.
  const dock = await app._prepareContext({ parts: ["dock"] });
  assert.deepEqual(dock.zones, []);
  assert.equal(dock.detail, null);
  assert.deepEqual(dock.dock, { none: true });
  assert.deepEqual([resolutions, reads, stats], [8, 8, 1]);
  ships[0].system.attributes.hp.value = 9;
  app.invalidateActorCache(ships[0]);
  const changed = await app._prepareContext({ parts: ["zones", "detail"] });
  assert.ok(
    changed.zones
      .flatMap((z) => z.objects)
      .find((o) => o.key === "object-0")
      .hp.startsWith("9/")
  );
  assert.deepEqual([resolutions, reads, stats], [9, 9, 2]);
  Content.stations = new Map(Content.stations);
  await app._prepareContext({ parts: ["zones", "detail"] });
  assert.deepEqual([resolutions, reads, stats], [17, 17, 3]);
  app._cleanup();
  assert.equal(app.actorCache.entries.size, 0);
  assert.equal(app.actorCache.active.size, 0);
});

test("unknown/private identity never enters asynchronous cache or player detail/art", async () => {
  installFoundryMock();
  game.user.isGM = false;
  const combat = makeStarshipCombat({
    objects: [
      {
        key: "public-contact",
        actorUuid: "Actor.private-secret",
        type: "starship",
        name: "SECRET",
        zone: 2,
        detection: { party: "observed" }
      },
      { key: "hidden-contact", actorUuid: "Actor.hidden-secret", type: "starship", name: "HIDDEN", zone: 3, hidden: true }
    ]
  });
  const app = new SensorMapApplication();
  app.selected = "public-contact";
  const calls = [];
  app.actorCache = new MapActorCache({
    resolve: async (uuid) => {
      calls.push(uuid);
      return null;
    }
  });
  const context = await app._prepareContext({ parts: ["zones", "detail"] });
  assert.deepEqual(calls, []);
  assert.equal(app.actorCache.active.size, 0);
  const serialized = JSON.stringify(context);
  assert.ok(!serialized.includes("Actor.private-secret") && !serialized.includes("SECRET") && !serialized.includes("Actor.hidden-secret"));
  assert.equal(context.detail.canOpen, false);
  combat.flags["sf2e-tactical-starship-combat"].tsc.objects = [];
  await app._prepareContext({ parts: ["dock"] });
  assert.equal(app.actorCache.entries.size, 0);
});

test("production context prunes actors when known contacts become unknown or permissions are revoked", async () => {
  installFoundryMock();
  game.user.isGM = false;
  const actor = makeShip({ id: "visible-enemy", name: "Enemy", role: "npc" });
  let allowed = true;
  actor.testUserPermission = () => allowed;
  const combat = makeStarshipCombat({
    objects: [{ key: "contact", actorUuid: actor.uuid, type: "starship", name: actor.name, zone: 1, detection: { party: "identified" } }]
  });
  const object = combat.flags["sf2e-tactical-starship-combat"].tsc.objects[0];
  const app = new SensorMapApplication();
  app.selected = "contact";
  await app._prepareContext({ parts: ["zones", "detail"] });
  assert.equal(app.actorCache.entries.size, 1);
  allowed = false;
  const denied = await app._prepareContext({ parts: ["zones", "detail"] });
  assert.equal(app.actorCache.entries.size, 0);
  assert.equal(denied.detail.vitals, null);
  assert.equal(denied.detail.canOpen, false);
  allowed = true;
  await app._prepareContext({ parts: ["zones", "detail"] });
  assert.equal(app.actorCache.entries.size, 1);
  object.detection.party = "observed";
  const unknown = await app._prepareContext({ parts: ["zones", "detail"] });
  assert.equal(app.actorCache.entries.size, 0);
  assert.equal(app.actorCache.active.size, 0);
  assert.ok(!JSON.stringify(unknown).includes(actor.uuid));
});

test("pending resolutions coalesce; invalidation, pruning and close reject obsolete results", async () => {
  for (const operation of ["invalidate", "prune", "dispose"]) {
    const pending = deferred();
    let calls = 0;
    const actor = { uuid: "Actor.a", testUserPermission: () => true };
    const cache = new MapActorCache({
      resolve: () => {
        calls++;
        return pending.promise;
      }
    });
    cache.setVisible([known(actor.uuid), known(actor.uuid)], user);
    const a = cache.get(actor.uuid),
      b = cache.get(actor.uuid);
    await Promise.resolve();
    assert.equal(calls, 1);
    if (operation === "prune") cache.setVisible([], user);
    else if (operation === "dispose") cache.dispose();
    else cache.invalidate(actor);
    pending.resolve(actor);
    assert.deepEqual(await Promise.all([a, b]), [null, null]);
    assert.equal(cache.entries.size, 0);
  }
});

test("exported hook invalidates an app still preparing its first render and unregisters on cleanup", async () => {
  installFoundryMock();
  const actor = makeShip({ id: "first-render", name: "Ship", role: "npc" });
  makeStarshipCombat({ objects: [{ key: "first", actorUuid: actor.uuid, type: "starship", name: actor.name, zone: 1 }] });
  const pending = deferred();
  const app = new SensorMapApplication();
  app.actorCache = new MapActorCache({ resolve: () => pending.promise });
  const preparation = app._prepareContext({ parts: ["zones"] });
  await Promise.resolve();
  invalidateSensorMapActors(actor);
  pending.resolve(actor);
  const context = await preparation;
  assert.equal(app.actorCache.entries.size, 0);
  assert.equal(context.zones[0].objects[0].hp, null);
  assert.ok(app._actorCacheHook);
  app._cleanup();
  assert.equal([...Hooks._hooks.values()].flat().length, 0);
});

test("world Actor invalidation also rejects an unresolved linked Token.Actor alias", async () => {
  const pending = deferred();
  const cache = new MapActorCache({ resolve: () => pending.promise });
  const alias = "Scene.a.Token.b.Actor.c";
  cache.setVisible([known(alias)], user);
  const result = cache.get(alias);
  await Promise.resolve();
  cache.invalidate({ uuid: "Actor.world" });
  pending.resolve({ uuid: "Actor.world", testUserPermission: () => true });
  assert.equal(await result, null);
  assert.equal(cache.entries.size, 0);
});

test("missing, rejected, null and denied documents are not negatively cached; permissions are rechecked", async () => {
  let actor = null,
    calls = 0,
    allowed = true;
  const cache = new MapActorCache({
    resolve: async () => {
      calls++;
      return actor;
    }
  });
  cache.setVisible([known("Actor.a"), known(null), known("")], user);
  assert.equal(await cache.get(null), null);
  assert.equal(await cache.get("Actor.a"), null);
  actor = { uuid: "Actor.a", testUserPermission: () => allowed };
  assert.equal((await cache.get(actor.uuid)).actor, actor);
  assert.equal(calls, 2);
  allowed = false;
  assert.equal(await cache.get(actor.uuid), null);
  assert.equal(cache.entries.size, 0);
  allowed = true;
  assert.ok(await cache.get(actor.uuid));
  cache.setVisible([known(actor.uuid)], { ...user, id: "different" });
  assert.equal(cache.entries.size, 0);
  const failing = new MapActorCache({
    resolve: async () => {
      throw new Error("unavailable");
    }
  });
  failing.setVisible([known(actor.uuid)], user);
  assert.equal(await failing.get(actor.uuid), null);
  assert.equal(failing.entries.size, 0);
});

test("crew invalidation recomputes derived stats without re-resolving ships; compendium/synthetic actors evict", async () => {
  for (const uuid of ["Compendium.module.ships.Actor.a", "Scene.a.Token.b.Actor.c"]) {
    let computes = 0;
    const actor = { uuid, testUserPermission: () => true };
    const cache = new MapActorCache({
      resolve: async () => actor,
      ship: () => true,
      read: () => ({ stations: [{ helmedBy: "Actor.crew" }] }),
      stats: () => ++computes
    });
    cache.setVisible([known(uuid)], user);
    const entry = await cache.get(uuid);
    assert.equal(cache.stats(entry), 1);
    cache.invalidate({ uuid: "Actor.crew" });
    assert.equal(cache.stats(entry), 2);
    assert.equal(await cache.get(uuid), entry);
    cache.invalidate({ uuid });
    assert.equal(cache.entries.size, 0);
    assert.equal(cache.data(entry), null);
  }
});

test("giant 8100x11700 becomes aspect-preserving lossless 2836x4096 blob; decoded image/canvas are released", async (t) => {
  const { layer, images, canvases, created, revoked } = imageMocks(t);
  assert.equal(paintMapBackground(layer, "giant.png"), undefined);
  assert.equal(layer.style.backgroundImage, "none");
  images[0].finish(8100, 11700);
  await backgroundReady(layer);
  assert.equal(layer.dataset.backgroundSource, "giant.png");
  assert.equal(layer.dataset.backgroundState, "scaled");
  assert.deepEqual(canvases[0].encoded, [2836, 4096, "image/png"]);
  assert.deepEqual([canvases[0].width, canvases[0].height], [0, 0]);
  assert.equal(images[0].assignments.at(-1), "");
  const display = layer.style.backgroundImage;
  for (let i = 0; i < 25; i++) paintMapBackground(layer, "giant.png");
  assert.equal(layer.style.backgroundImage, display);
  assert.equal(images.length, 1);
  assert.equal(created.length, 1);
  releaseMapBackground(layer);
  assert.deepEqual(revoked, ["blob:test-1"]);
});

test("unrelated settings retain the scaled background; explicit same-path refresh reloads it", async (t) => {
  installFoundryMock();
  const { layer, images, canvases, revoked } = imageMocks(t);
  const app = new SensorMapApplication();
  app._backgroundLayer = layer;
  t.after(() => app._cleanup());
  paintMapBackground(layer, "giant.png", app.backgroundRevision);
  images[0].finish(8100, 11700);
  await backgroundReady(layer);
  const revision = app.backgroundRevision,
    display = layer.style.backgroundImage;
  for (const key of ["uiState", "starshipSheetTheme", "showUnknownContacts"]) {
    assert.equal(app.wants("settings", { key: `sf2e-tactical-starship-combat.${key}` }), true);
    assert.equal(app.backgroundRevision, revision);
    paintMapBackground(layer, "giant.png", app.backgroundRevision);
    assert.equal(layer.style.backgroundImage, display);
  }
  assert.equal(images.length, 1);
  assert.equal(canvases.length, 1);
  assert.deepEqual(revoked, []);
  app.invalidateBackground();
  assert.ok(app.backgroundRevision > revision);
  paintMapBackground(layer, "giant.png", app.backgroundRevision);
  assert.equal(images.length, 2);
  assert.equal(images[1].assignments[0], `giant.png?tsc-map-revision=${app.backgroundRevision}`);
  images[1].finish(8100, 11700);
  await backgroundReady(layer);
  assert.equal(canvases.length, 2);
  assert.equal(layer.dataset.backgroundSource, "giant.png");
  assert.deepEqual(revoked, ["blob:test-1"]);
});

test("ordinary 512 image retains original source/quality; revision reloads and source changes revoke blobs", async (t) => {
  const { layer, images, canvases, revoked } = imageMocks(t);
  paintMapBackground(layer, "ordinary.png");
  images[0].finish(512, 512);
  await backgroundReady(layer);
  assert.equal(layer.style.backgroundImage, 'url("ordinary.png")');
  assert.equal(canvases.length, 0);
  paintMapBackground(layer, "ordinary.png", 1);
  assert.equal(images.length, 2);
  assert.equal(images[1].assignments[0], "ordinary.png?tsc-map-revision=1");
  assert.equal(layer.dataset.backgroundSource, "ordinary.png");
  images[1].finish(512, 512);
  await backgroundReady(layer);
  paintMapBackground(layer, "giant.png");
  images[2].finish(8100, 11700);
  await backgroundReady(layer);
  paintMapBackground(layer, "");
  assert.deepEqual(revoked, ["blob:test-1"]);
  assert.equal(layer.style.backgroundImage, "none");
});

test("source-change/load/encode races and close cannot repaint or leak obsolete blobs", async (t) => {
  const callbacks = [];
  const { layer, images, created } = imageMocks(t, { encode: (callback) => callbacks.push(callback) });
  paintMapBackground(layer, "old.png");
  const oldReady = backgroundReady(layer);
  const oldOnLoad = images[0].onload;
  paintMapBackground(layer, "new.png");
  oldOnLoad();
  await oldReady;
  images[1].finish(8100, 11700);
  await Promise.resolve();
  const encoding = backgroundReady(layer);
  releaseMapBackground(layer);
  callbacks[0]({ type: "image/png" });
  await encoding;
  assert.equal(created.length, 0);
  assert.equal(layer.style.backgroundImage, "none");
  assert.equal(layer.dataset.backgroundState, "disposed");
  assert.ok(images.every((image) => image.assignments.at(-1) === ""));
});

test("tainted/unavailable canvas falls back to native original without altering source", async (t) => {
  const { layer, images, canvases, created } = imageMocks(t, { tainted: true });
  paintMapBackground(layer, "https://example.invalid/giant.png");
  images[0].finish(8100, 11700);
  await backgroundReady(layer);
  assert.equal(layer.dataset.backgroundState, "native");
  assert.equal(layer.dataset.backgroundWarning, "native-fallback");
  assert.equal(layer.dataset.backgroundWidth, "8100");
  assert.equal(layer.dataset.backgroundHeight, "11700");
  assert.equal(layer.style.backgroundImage, 'url("https://example.invalid/giant.png")');
  assert.equal(created.length, 0);
  assert.equal(canvases[0].width, 0);
});

test("failed and timed-out image loads clean handlers; explicit revision permits retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { layer, images } = imageMocks(t);
  paintMapBackground(layer, "bad.png");
  images[0].onerror();
  await backgroundReady(layer);
  assert.equal(layer.dataset.backgroundState, "error");
  assert.equal(images[0].onload, null);
  paintMapBackground(layer, "bad.png", 1);
  t.mock.timers.tick(MAP_BACKGROUND_TIMEOUT);
  await backgroundReady(layer);
  assert.equal(layer.dataset.backgroundState, "error");
  assert.equal(images[1].onerror, null);
  assert.equal(images[1].assignments.at(-1), "");
});
