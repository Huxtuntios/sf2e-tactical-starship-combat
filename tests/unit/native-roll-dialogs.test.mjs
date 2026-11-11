import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";
import { rollEventOptions, rollNativeCheck } from "../../scripts/starship/stats.mjs";

test("native check rolls leave dialog policy to SF2e unless the click supplies Shift", async () => {
  const { setUser } = installFoundryMock();
  setUser("p1");
  game.user.settings = { showCheckDialogs: true };
  const event = { shiftKey: false, ctrlKey: false, metaKey: false };
  let passed;
  const statistic = {
    check: {
      roll: async (options) => {
        passed = options;
        return { total: 17, degreeOfSuccess: 2, dice: [{ total: 12 }] };
      }
    }
  };

  const result = await rollNativeCheck({ statistic, dc: 15, event });

  assert.equal(passed.skipDialog, undefined);
  assert.equal(passed.event, event);
  assert.equal(result.native, true);
  assert.equal(result.total, 17);
});

test("Shift toggles the initiating user's SF2e check-dialog setting and preserves visibility modifiers", () => {
  const { setUser, settings } = installFoundryMock();
  setUser("p1");
  game.user.settings = { showCheckDialogs: true, showDamageDialogs: false };
  settings.set("messageMode", "public");
  CONFIG.ChatMessage.modes.public = {};
  CONFIG.ChatMessage.modes.blind = {};

  assert.deepEqual(rollEventOptions({ shiftKey: false, ctrlKey: false, metaKey: false }), {
    skipDialog: false,
    messageMode: "public"
  });
  assert.deepEqual(rollEventOptions({ shiftKey: true, ctrlKey: false, metaKey: false }), {
    skipDialog: true,
    messageMode: "public"
  });
  assert.deepEqual(rollEventOptions({ shiftKey: false, ctrlKey: true, metaKey: false }), {
    skipDialog: false,
    messageMode: "blind"
  });
  assert.deepEqual(rollEventOptions({ shiftKey: true, ctrlKey: false, metaKey: false }, "damage"), {
    skipDialog: false,
    messageMode: "public"
  });

  game.user.settings.showCheckDialogs = false;
  assert.deepEqual(rollEventOptions({ shiftKey: true, ctrlKey: false, metaKey: false }), {
    skipDialog: false,
    messageMode: "public"
  });
});

test("native modifier clones pass the module's typed modifiers and cancellation never starts a fallback roll", async () => {
  installFoundryMock();
  game.pf2e.Modifier = class {
    constructor(data) {
      Object.assign(this, data);
    }
  };
  let cloneData;
  let calls = 0;
  const statistic = {
    clone(data) {
      cloneData = data;
      return this;
    },
    check: {
      async roll() {
        calls++;
        return null;
      }
    }
  };
  const diceBefore = globalThis.__dice.length;
  const messagesBefore = game.messages.size;

  const result = await rollNativeCheck({
    statistic,
    extraModifiers: [{ label: "Tracking", type: "item", value: 1 }],
    modifierOnly: 99
  });

  assert.equal(result, null);
  assert.equal(calls, 1);
  assert.equal(cloneData.modifiers[0].label, "Tracking");
  assert.equal(cloneData.modifiers[0].type, "item");
  assert.equal(cloneData.modifiers[0].modifier, 1);
  assert.equal(globalThis.__dice.length, diceBefore);
  assert.equal(game.messages.size, messagesBefore);
});
