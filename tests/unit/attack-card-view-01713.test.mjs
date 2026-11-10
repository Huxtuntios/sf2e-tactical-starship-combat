import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { CARD_FLAG } from "../../scripts/chat/attack-card/model.mjs";
import { makeCardRenderer } from "../../scripts/chat/attack-card/view.mjs";

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
