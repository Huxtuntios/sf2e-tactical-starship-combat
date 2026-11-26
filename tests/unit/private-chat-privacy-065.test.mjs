import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { sendActionDescriptionToChat } from "../../scripts/ui/action-controls.mjs";
import { postDamageCard, postHazardCard, postIntegrityCard, postSimpleCard } from "../../scripts/chat/chat-cards.mjs";
import { rollFlatCheck } from "../../scripts/starship/stats.mjs";
import { isPrivateSensorActor } from "../../scripts/sensor/private-contacts.mjs";

const M = "sf2e-tactical-starship-combat";

function privateActor(name, type = "vehicle") {
  return {
    id: name,
    uuid: `map-${name}`,
    name,
    type,
    flags: {
      [M]: {
        sensorContactInstance: { privateContact: true },
        ...(type === "vehicle" ? { starship: { isStarship: true, role: "npc" } } : {})
      }
    },
    system: { attributes: { hp: { value: 10, max: 10 } } },
    testUserPermission: () => false
  };
}

const gmIds = () => ChatMessage.getWhisperRecipients("GM").map((user) => user.id);

test("private action descriptions are whispered while public descriptions remain public", async () => {
  installFoundryMock();
  const action = { id: "inline:secret-orders", name: "Secret Orders", cost: 1, text: "Whisper only." };
  const secret = privateActor("Secret NPC");
  const privateMessage = await sendActionDescriptionToChat({ action, ship: secret });
  assert.deepEqual(privateMessage.whisper, gmIds());
  assert.match(privateMessage.content, /Secret NPC/);

  const publicMessage = await sendActionDescriptionToChat({
    action,
    ship: { ...secret, uuid: "Actor.public", id: "public", name: "Public Ship", flags: {} }
  });
  assert.deepEqual(publicMessage.whisper, []);
});

test("simple, integrity, hazard and damage cards inherit private actor whispering", async () => {
  installFoundryMock();
  const secret = privateActor("Secret NPC");
  const hazard = privateActor("Secret Hazard", "hazard");
  const cards = [
    await postSimpleCard({ actor: secret, title: "Secret", body: "Secret" }),
    await postIntegrityCard({ actor: secret, dc: 10, degreeLabel: "Success", delta: 1, newValue: 0 }),
    await postHazardCard({ hazard, zone: 1, effectText: "Secret", title: "Routine" }),
    await postDamageCard({ actor: secret, source: "Secret", result: { hullDamage: 1 } }),
    await postDamageCard({
      actor: { ...secret, uuid: "Actor.public-target", id: "public-target", name: "Public Target", flags: {} },
      source: "Secret attacker",
      result: { hullDamage: 1 },
      whisperGM: true
    })
  ];
  for (const card of cards) assert.deepEqual(card.whisper, gmIds());
});

test("private hull integrity flat checks and fallback roll messages are whispered", async () => {
  installFoundryMock();
  const secret = privateActor("Secret NPC");
  const result = await rollFlatCheck({ actor: secret, dc: 10, label: "Secret Hull", secret: true });
  assert.ok(result.roll);
  assert.deepEqual(game.messages.contents.at(-1).whisper, gmIds());
});

test("private actor detection fails closed when the private registry is malformed", async () => {
  installFoundryMock();
  game.user = game.users.get("gm");
  const combat = makeStarshipCombat();
  game.journal.clear();
  game.journal.set("broken-store", {
    id: "broken-store",
    ownership: { default: 0 },
    flags: {
      [M]: {
        privateSensor: {
          schema: 1,
          combatId: combat.id,
          contacts: [],
          completedReveals: [{}]
        }
      }
    },
    testUserPermission: () => false
  });
  const reused = {
    id: "reused-private",
    uuid: "Actor.reused-private",
    name: "Reused Private NPC",
    type: "vehicle",
    flags: { [M]: { starship: { isStarship: true, role: "npc" } } },
    system: { attributes: { hp: { value: 10, max: 10 } } },
    testUserPermission: () => false
  };
  assert.equal(isPrivateSensorActor(reused, combat), true);
  const message = await sendActionDescriptionToChat({
    action: { id: "inline:secret-orders", name: "Secret Orders", cost: 1, text: "Whisper only." },
    ship: reused
  });
  assert.deepEqual(message.whisper, gmIds());
});
