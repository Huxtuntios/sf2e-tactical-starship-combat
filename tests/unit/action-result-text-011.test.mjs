import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
const strings = {
  "SF2eTSC.chat.result": "Result",
  "SF2eTSC.attackCard.consequences": "Consequences",
  "SF2eTSC.chat.manualResolve": "GM must resolve manually:",
  "SF2eTSC.degree.criticalSuccess": "Critical Success",
  "SF2eTSC.degree.success": "Success",
  "SF2eTSC.degree.failure": "Failure",
  "SF2eTSC.degree.criticalFailure": "Critical Failure"
};
const localize = (key) => strings[key] ?? key;

async function resultTextModule() {
  const mod = await import("../../scripts/actions/result-text.mjs").catch(() => null);
  assert.ok(mod, "the shared action result text module must exist");
  return mod;
}

test("action result text includes degree, checks, consequences and manual resolution", async () => {
  const { formatActionResultText } = await resultTextModule();
  const result = {
    ok: true,
    degreeLabel: "Critical Success",
    lines: [{ label: "Check", value: "24 vs DC 20" }],
    reports: ["Shield restored.", "⚠ Target is out of range."],
    manual: ["Move the ship manually."]
  };
  assert.equal(
    formatActionResultText(result, { localize }),
    [
      "Result: Critical Success",
      "Check: 24 vs DC 20",
      "",
      "Consequences:",
      "Shield restored.",
      "⚠ Target is out of range.",
      "",
      "GM must resolve manually:",
      "Move the ship manually."
    ].join("\n")
  );
});

test("action result text appends explicit outcomes in native degree order and skips automation-only entries", async () => {
  const { formatActionResultText } = await resultTextModule();
  const result = {
    ok: true,
    degree: 2,
    outcomes: {
      criticalSuccess: [{ type: "manual", text: "Undamaged." }],
      success: [
        { type: "text", text: "Half damage." },
        { type: "applyEffect", text: "AUTOMATION_ONLY" }
      ],
      failure: [{ type: "manual", text: "Full damage." }],
      criticalFailure: [{ type: "text", text: "Double damage." }]
    }
  };
  assert.equal(
    formatActionResultText(result, { localize }),
    [
      "Result: Success",
      "",
      "Critical Success: Undamaged.",
      "Success: Half damage.",
      "Failure: Full damage.",
      "Critical Failure: Double damage."
    ].join("\n")
  );
});

test("action result text omits outcome legends when no rolled degree is stored", async () => {
  const { formatActionResultText } = await resultTextModule();
  assert.equal(
    formatActionResultText(
      { ok: true, degreeLabel: "Success", outcomes: { success: [{ type: "manual", text: "Half damage." }] } },
      { localize }
    ),
    "Result: Success"
  );
});

test("action result text derives a missing degree label from the system degree", async () => {
  const { formatActionResultText } = await resultTextModule();
  assert.equal(formatActionResultText({ ok: true, degree: 1 }, { localize }), "Result: Failure");
});

test("cancelled, dry-run and empty results do not claim a completed outcome", async () => {
  const { formatActionResultText } = await resultTextModule();
  for (const result of [null, {}, { ok: true, cancelled: true, degreeLabel: "Success" }, { ok: true, dryRun: true, reports: ["Changed"] }])
    assert.equal(formatActionResultText(result, { localize }), "");
});

test("source description and execution result stay separate and immutable", async () => {
  const { formatActionDescription } = await resultTextModule();
  const action = Object.freeze({ id: "evade", text: "<p>Original rules text.</p>" });
  const result = Object.freeze({
    ok: true,
    degreeLabel: "Success",
    reports: Object.freeze(["Evade applied."])
  });
  const before = structuredClone({ action, result });
  const parts = formatActionDescription(action, result, { localize });
  assert.deepEqual(parts, {
    sourceText: "<p>Original rules text.</p>",
    resultText: "Result: Success\n\nConsequences:\nEvade applied."
  });
  assert.deepEqual({ action, result }, before);
});

test("station action cards expose the shared result text without replacing source text or visuals", async () => {
  installFoundryMock();
  const { postActionCard } = await import("../../scripts/chat/chat-cards.mjs");
  const action = Object.freeze({ id: "evade", name: "Evade", text: "Original rules text." });
  const ship = makeShip({ id: "aurora", name: "Aurora" });
  await postActionCard({
    actor: ship,
    action,
    degreeLabel: "Success",
    lines: [{ label: "Check", value: "21 vs DC 20" }],
    reports: ["Evade applied."]
  });
  assert.equal(game.messages.size, 1);
  const message = [...game.messages.values()][0];
  assert.equal(message.flags[M].actionResultText, "Result: Success\nCheck: 21 vs DC 20\n\nConsequences:\nEvade applied.");
  assert.match(message.content, /tsc-degree/);
  assert.match(message.content, /Evade applied\./);
  assert.doesNotMatch(message.content, /Original rules text\./);
  assert.equal(action.text, "Original rules text.");
  assert.equal(globalThis.__writes.length, 0);
});
