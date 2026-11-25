import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { CARD_FLAG } from "../../scripts/chat/attack-card/model.mjs";
import { makeCardRenderer } from "../../scripts/chat/attack-card/view.mjs";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";

test("open declaration displays effective target bonus with separate MAP baseline", () => {
  const { renderAttackCard } = makeCardRenderer();
  const html = renderAttackCard({
    flags: {
      [MODULE_ID]: {
        [CARD_FLAG]: {
          status: "open",
          ship: { name: "Attacker" },
          action: { name: "Strike" },
          weapon: { name: "Laser" },
          range: {},
          map: { current: -5, choice: "1", profile: { map1: -5, map2: -10 } },
          targets: [{ key: "enemy", label: "Enemy", available: true, zone: 1, distance: 1, effectiveAttackBonus: 11 }]
        }
      }
    }
  });
  assert.match(html, /data-tsc-effective-bonus="16">\+11</);
  assert.match(html, /data-tsc-map-penalty="-10"/);
});

test("selecting MAP updates effective target bonuses without changing stored card data", async () => {
  installFoundryMock();
  const { setMapChoice } = await import("../../scripts/chat/attack-card/client.mjs");
  const buttons = ["0", "1", "2"].map((choice, i) => ({
    dataset: { tscMapChoice: choice, tscMapPenalty: String(-5 * i) },
    classList: { toggle() {} },
    setAttribute() {}
  }));
  const value = { dataset: { tscEffectiveBonus: "16" }, textContent: "+16" };
  setMapChoice({ querySelectorAll: (selector) => (selector === "[data-tsc-map-choice]" ? buttons : [value]) }, "2");
  assert.equal(value.textContent, "+6");
});

test("manual Drone Block damage result renders its label and resistance details", () => {
  const { renderAttackCard } = makeCardRenderer({
    t: (key, data) => (key === "SF2eTSC.droneBlock.manualResult" ? `Manual resistance ${data.resistance} against ${data.amount}` : key)
  });
  const card = {
    status: "resolved",
    ship: { name: "Attacker" },
    action: { name: "Strike" },
    weapon: { name: "Laser" },
    range: {},
    result: {
      targetLabel: "Defender",
      pendingDamage: { formula: "2d6", damageType: "fire", extraTypes: [], crit: false }
    },
    damageRoll: { total: 7, formula: "2d6" },
    damageApplied: true,
    damageResult: { manual: true, amount: 7, resistance: 0 }
  };
  const html = renderAttackCard({ flags: { [MODULE_ID]: { [CARD_FLAG]: card } } });
  assert.match(html, /SF2eTSC\.rolls\.damageApplied/);
  assert.match(html, /Manual resistance 0 against 7/);
  assert.doesNotMatch(html, />undefined</);
});

test("manual Drone Shield Protocol result shows its GM follow-up", () => {
  const { renderAttackCard } = makeCardRenderer({
    t: (key, data) =>
      key === "SF2eTSC.droneBlock.protocolManualTitle"
        ? "Protocol follow-up"
        : key === "SF2eTSC.droneBlock.protocolManualResult"
          ? `Track resistance ${data.resistance}, two blocks, shield and Fetch and Fix manually`
          : key
  });
  const card = {
    status: "resolved",
    ship: { name: "Attacker" },
    action: { name: "Strike" },
    weapon: { name: "Laser" },
    range: {},
    result: { targetLabel: "Defender", pendingDamage: { formula: "2d6", damageType: "fire", extraTypes: [], crit: false } },
    damageRoll: { total: 7, formula: "2d6" },
    damageApplied: true,
    damageResult: { manual: true, protocolManual: true, amount: 7, resistance: 3 }
  };
  const html = renderAttackCard({ flags: { [MODULE_ID]: { [CARD_FLAG]: card } } });
  assert.match(html, /Protocol follow-up/);
  assert.match(html, /Track resistance 3, two blocks, shield and Fetch and Fix manually/);
});
