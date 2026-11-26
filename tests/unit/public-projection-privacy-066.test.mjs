import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { publicMapActorData, resolveSensorActorSync, sanitizePublicMapActors } from "../../scripts/sensor/map-object.mjs";

const M = "sf2e-tactical-starship-combat";

function sourceData() {
  return {
    _id: "source",
    name: "Public Ship",
    type: "vehicle",
    img: "ship.webp",
    ownership: { default: 0, p1: 3 },
    system: { attributes: { hp: { value: 20, max: 20 } }, details: { privateNotes: "secret", description: "public" } },
    flags: {
      foreign: { secret: "foreign-secret" },
      [M]: {
        starship: { isStarship: true, role: "player", hp: { value: 20, max: 20 }, gmNotes: "gm-secret", notes: "public" },
        tacticalCopyOf: "Actor.source",
        historyUndoReceipt: { secret: true }
      }
    },
    items: [
      { _id: "public-item", name: "Public Item", type: "effect", ownership: { default: 1 } },
      { _id: "private-item", name: "Private Item", type: "effect", ownership: { default: 0 } }
    ]
  };
}

test("public Actor projection allowlists module data and removes private notes, foreign flags and private Items", () => {
  installFoundryMock();
  const projection = publicMapActorData(sourceData());
  assert.ok(projection);
  assert.equal(projection.name, "Public Ship");
  assert.equal(projection.system.attributes.hp.value, 20);
  assert.equal(projection.system.details.privateNotes, undefined);
  assert.equal(projection.system.details.description, "public");
  assert.deepEqual(Object.keys(projection.flags), [M]);
  assert.equal(projection.flags[M].tacticalCopyOf, undefined);
  assert.equal(projection.flags[M].historyUndoReceipt, undefined);
  assert.equal(projection.flags[M].starship.gmNotes, undefined);
  assert.equal(projection.flags[M].starship.notes, "public");
  assert.deepEqual(
    projection.items.map((item) => item._id),
    ["public-item"]
  );
});

test("public projection rejects NPC or non-visible source roles", () => {
  installFoundryMock();
  const npc = sourceData();
  npc.flags[M].starship.role = "npc";
  assert.equal(publicMapActorData(npc), null);
  const hidden = sourceData();
  hidden.ownership = { default: 0 };
  assert.equal(publicMapActorData(hidden), null);
});

test("public map-only resolution re-sanitizes stored projections and rejects tampered roles", () => {
  installFoundryMock();
  game.user = game.users.get("p1");
  const data = sourceData();
  data.flags.foreign = { secret: "stored-secret" };
  const combat = makeStarshipCombat({
    objects: [{ key: "map-public", actorUuid: "map-public", type: "starship", publicActor: data }]
  });
  const actor = resolveSensorActorSync(combat, "map-public");
  assert.ok(actor);
  assert.equal(actor.flags.foreign, undefined);
  assert.deepEqual([...actor.items.keys()], ["public-item"]);

  const npc = sourceData();
  npc.flags[M].starship.role = "npc";
  combat.flags[M].tsc.objects[0].publicActor = npc;
  assert.equal(resolveSensorActorSync(combat, "map-public"), null);
});

test("active GM repair strips unsafe data already stored in public Combat projections", async () => {
  installFoundryMock();
  game.user = game.users.get("gm");
  const data = sourceData();
  data.flags.foreign = { secret: "stored-secret" };
  const combat = makeStarshipCombat({
    objects: [{ key: "map-public", actorUuid: "map-public", type: "starship", publicActor: data }]
  });
  await sanitizePublicMapActors(combat);
  const stored = combat.flags[M].tsc.objects[0].publicActor;
  assert.equal(stored.flags.foreign, undefined);
  assert.deepEqual(
    stored.items.map((item) => item._id),
    ["public-item"]
  );
});
