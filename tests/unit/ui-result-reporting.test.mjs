import test from "node:test";
import assert from "node:assert/strict";
import { failedUiChecks, fixtureReady } from "../../tools/ui-result-utils.mjs";

test("failed UI reports include keyboard checks and width-prefixed measurements", () => {
  const result = {
    checks: [{ name: "native-select-keyboard-selection", pass: false }],
    measurements: [
      {
        width: 380,
        checks: [
          { name: "layout", pass: false },
          { name: "other", pass: true }
        ]
      }
    ]
  };
  assert.deepEqual(failedUiChecks(result), ["native-select-keyboard-selection", "380: layout"]);
});

test("effect-target keyboard follow-up is skipped after a recorded fixture failure", () => {
  assert.equal(fixtureReady({ passed: false, checks: [{ name: "fixture-runtime", pass: false }] }), false);
  assert.equal(fixtureReady({ passed: true, checks: [] }), true);
});
