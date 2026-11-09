import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Drone Block manual reminder uses the operator's level, not the ship's", () => {
  const data = JSON.parse(readFileSync("data/actions/station-actions.json", "utf8"));
  const text = JSON.stringify(data);
  assert.match(text, /resistance equal to half your level against the triggering Strike/);
  assert.doesNotMatch(text, /resistance equal to half its level \(round up\) against the triggering Strike/);
});
