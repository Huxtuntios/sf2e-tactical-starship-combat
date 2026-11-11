import test from "node:test";
import assert from "node:assert/strict";
import { DEGREE } from "../../scripts/constants.mjs";
import { resolveSeekBuiltin } from "../../scripts/actions/effects-exec.mjs";
import { defaultSensorState, findObject } from "../../scripts/engine/sensor-ops.mjs";
import { rollNativeCheck } from "../../scripts/starship/stats.mjs";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";

function seekContext(objects, sensorRange = 3) {
  return {
    shipUuid: "Actor.seeker",
    stats: { sensorRange },
    reports: [],
    draft: {
      tsc: defaultSensorState({
        objects: [
          { key: "Actor.seeker", zone: 2, detection: { party: "observed" } },
          ...objects.map((object) => ({ zone: 3, detection: { party: "hidden" }, ...object }))
        ]
      })
    }
  };
}

async function nativeResult(total, natural, degree = DEGREE.CRITICAL_SUCCESS) {
  const roll = { total, dice: [{ total: natural }], degreeOfSuccess: degree };
  const result = await rollNativeCheck({ statistic: { check: { roll: async () => roll } }, dc: null, createMessage: false });
  assert.equal(result.natural, natural);
  assert.equal(result.native, true);
  return result;
}

test("Seek upgrades natural 20 total 20 against DC 25 from hidden to observed", async () => {
  installFoundryMock();
  const ctx = seekContext([{ key: "hidden", stealthDC: 25 }]);
  const original = structuredClone(ctx.draft.tsc);
  await resolveSeekBuiltin(ctx, await nativeResult(20, 20, DEGREE.FAILURE));
  const contact = findObject(ctx.draft.tsc, "hidden");
  assert.deepEqual(contact.detection, { party: "observed", "Actor.seeker": "observed" });
  assert.ok(contact.designation);
  assert.equal(ctx.draft.tsc.contactCounter, 1);
  assert.equal(ctx.reports.length, 1);
  assert.equal(original.objects[1].detection.party, "hidden");
});

test("Seek natural 1 lowers a total-based success to failure", async () => {
  installFoundryMock();
  const ctx = seekContext([{ key: "hidden", stealthDC: 25 }]);
  await resolveSeekBuiltin(ctx, await nativeResult(25, 1));
  assert.deepEqual(findObject(ctx.draft.tsc, "hidden").detection, { party: "hidden" });
  assert.equal(ctx.draft.tsc.contactCounter, 0);
  assert.deepEqual(ctx.reports, [game.i18n.localize("SF2eTSC.chat.nothingFound")]);
});

test("Seek ordinary success, critical success and failures preserve their detection transitions", async () => {
  installFoundryMock();
  for (const [total, dc, current, expected] of [
    [25, 25, "hidden", "observed"],
    [25, 25, "undetected", "hidden"],
    [35, 25, "undetected", "observed"],
    [24, 25, "hidden", "hidden"],
    [15, 25, "undetected", "undetected"]
  ]) {
    const ctx = seekContext([{ key: "contact", stealthDC: dc, detection: { party: current } }]);
    await resolveSeekBuiltin(ctx, { total, natural: 10, degree: DEGREE.CRITICAL_SUCCESS, native: false });
    assert.equal(findObject(ctx.draft.tsc, "contact").detection.party, expected, `${total}/${dc}/${current}`);
  }
  const ctx = seekContext([{ key: "contact", stealthDC: 25 }]);
  await resolveSeekBuiltin(ctx, { total: 25, degree: DEGREE.CRITICAL_FAILURE });
  assert.equal(findObject(ctx.draft.tsc, "contact").detection.party, "observed", "missing natural keeps the total-based result");
});

test("Seek recalculates a natural 20 separately for every DC and excludes out-of-range or known contacts", async () => {
  installFoundryMock();
  const ctx = seekContext([
    { key: "critical", stealthDC: 20, detection: { party: "undetected" } },
    { key: "success", stealthDC: 25, detection: { party: "undetected" } },
    { key: "failure", stealthDC: 30 },
    { key: "boundary", stealthDC: 25, zone: 5, designation: "Existing" },
    { key: "far", stealthDC: 1, zone: 6 },
    { key: "observed", stealthDC: 1, detection: { party: "observed" } },
    { key: "identified", stealthDC: 1, detection: { party: "identified" } }
  ]);
  const original = structuredClone(ctx.draft.tsc);
  await resolveSeekBuiltin(ctx, await nativeResult(20, 20));
  assert.equal(findObject(ctx.draft.tsc, "critical").detection.party, "observed");
  assert.equal(findObject(ctx.draft.tsc, "success").detection.party, "hidden");
  assert.equal(findObject(ctx.draft.tsc, "failure").detection.party, "hidden");
  assert.equal(findObject(ctx.draft.tsc, "boundary").detection.party, "observed");
  assert.equal(findObject(ctx.draft.tsc, "boundary").designation, "Existing");
  for (const key of ["Actor.seeker", "failure", "far", "observed", "identified"])
    assert.deepEqual(findObject(ctx.draft.tsc, key), findObject(original, key), key);
  assert.equal(ctx.draft.tsc.contactCounter, 1);
  assert.equal(ctx.reports.length, 3);
});

test("Seek natural 1 lowers a critical success to success at only the easier DC", async () => {
  installFoundryMock();
  const ctx = seekContext([
    { key: "easy", stealthDC: 15, detection: { party: "undetected" } },
    { key: "hard", stealthDC: 25, detection: { party: "undetected" } }
  ]);
  await resolveSeekBuiltin(ctx, await nativeResult(25, 1));
  assert.equal(findObject(ctx.draft.tsc, "easy").detection.party, "hidden");
  assert.equal(findObject(ctx.draft.tsc, "hard").detection.party, "undetected");
  assert.equal(ctx.draft.tsc.contactCounter, 0);
});
