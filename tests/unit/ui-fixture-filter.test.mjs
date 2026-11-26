import test from "node:test";
import assert from "node:assert/strict";
import { selectUiFixtures } from "../../tools/ui-fixture-filter.mjs";

const fixtures = [
  ["one.mjs", "one"],
  ["two.mjs", "two"],
  ["three.mjs", "three"]
];

test("UI fixture filters trim names and preserve suite order", () => {
  assert.deepEqual(selectUiFixtures(fixtures, "one, three"), [fixtures[0], fixtures[2]]);
  assert.deepEqual(selectUiFixtures(fixtures, "three,one"), [fixtures[0], fixtures[2]]);
});

test("unset UI fixture filter runs the complete suite", () => {
  assert.equal(selectUiFixtures(fixtures, undefined), fixtures);
  assert.equal(selectUiFixtures(fixtures, ""), fixtures);
});

test("unknown or empty UI fixture filters fail before browser startup", () => {
  assert.throws(() => selectUiFixtures(fixtures, "one,missing"), /missing/);
  assert.throws(() => selectUiFixtures(fixtures, " , "), /TSC_UI_FOLDER/);
});
