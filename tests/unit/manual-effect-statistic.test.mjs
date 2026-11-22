import test from "node:test";
import assert from "node:assert/strict";
import { effectModifiers } from "../../scripts/starship/effects.mjs";

test("station check modifiers cannot modify a station DC", () => {
  const fx = [{ id: "a", slug: "boost", modifiers: [{ selector: "station-check", value: 2, type: "status" }] }];
  assert.equal(effectModifiers(fx, "station-check", { statistic: "dc" }).length, 0);
  assert.equal(effectModifiers(fx, "station-check", { statistic: "check" }).length, 1);
});
test("explicit check and DC selections retain ordinary native both semantics", () => {
  const fx = ["check", "dc", "both"].map((statistic) => ({
    id: statistic,
    slug: "manual",
    manual: true,
    statistic,
    modifiers: [{ selector: "reflex", value: 1, type: "status" }]
  }));
  assert.deepEqual(
    effectModifiers(fx, "reflex", { statistic: "dc" }).map((m) => m.slug),
    ["tsc-dc-0", "tsc-both-0"]
  );
  assert.deepEqual(
    effectModifiers(fx, "reflex", { statistic: "check" }).map((m) => m.slug),
    ["tsc-check-0", "tsc-both-0"]
  );
});
