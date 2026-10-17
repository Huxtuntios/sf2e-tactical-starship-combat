import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { rateEntry, suggestHazards, hazardKind, entryXP } from "../../scripts/engine/encounter.mjs";

const hazards = JSON.parse(fs.readFileSync("data/hazards/hazards.json", "utf8")).hazards;

test("0.8.2 hazard kind and XP", () => {
  assert.equal(hazardKind({ isComplex: true }), "complexHazard");
  assert.equal(hazardKind({ isComplex: false }), "simpleHazard");
  assert.equal(entryXP({ kind: "simpleHazard", level: 5 }, 5), 8);
  assert.equal(entryXP({ kind: "complexHazard", level: 5 }, 5), 40);
});

test("0.8.2 rateEntry: threat of one enemy alone", () => {
  assert.deepEqual(rateEntry({ kind: "ship", level: 7 }, { partyLevel: 5 }), {
    xp: 80,
    threat: "moderate",
    beyond: false,
    share: 100,
    tooHigh: false
  });
  assert.equal(rateEntry({ kind: "simpleHazard", level: 5 }, { partyLevel: 5 }).threat, "minor");
  assert.equal(rateEntry({ kind: "complexHazard", level: 5 }, { partyLevel: 5 }).threat, "trivial");
  assert.equal(rateEntry({ kind: "complexHazard", level: 9 }, { partyLevel: 5 }).threat, "extreme");
  assert.equal(rateEntry({ kind: "ship", level: 11 }, { partyLevel: 5 }).tooHigh, true);
  assert.equal(rateEntry({ kind: "ship", level: 5 }, { partyLevel: 5, partySize: 2, target: "low" }).share, 80);
});

test("0.8.2 suggestHazards stays inside the target band", () => {
  const s = suggestHazards({ partyLevel: 5, partySize: 4, threat: "moderate", hazards, currentXP: 40, limit: 50 });
  assert.ok(s.length > 0);
  for (const h of s) assert.ok(40 + h.xp <= 119, h.id);
  assert.ok(s[0].fills, "best fit first");
  const firstNonFill = s.findIndex((h) => !h.fills);
  if (firstNonFill > 0) assert.ok(s.slice(firstNonFill).every((h) => !h.fills));
  assert.deepEqual(suggestHazards({ partyLevel: 5, threat: "low", hazards, currentXP: 200 }), []);
  assert.deepEqual(suggestHazards({ partyLevel: 5, threat: "nope", hazards }), []);
});

test("0.8.2 encounter builder shows hazard threat and suggestions", () => {
  const t = fs.readFileSync("templates/encounter-builder.hbs", "utf8");
  assert.match(t, /hazardSuggestions/);
  assert.match(t, /data-action="importHazard"/);
  assert.equal((t.match(/rating\.threatClass/g) || []).length, 3);
  for (const lg of ["en", "ru"]) {
    const e = JSON.parse(fs.readFileSync(`lang/${lg}.json`, "utf8"));
    const enc = e.SF2eTSC?.encounter ?? e.encounter;
    for (const k of ["alone", "minor", "shareHint", "hazardSuggestions", "fills", "noHazardSuggestions", "importedHazard"])
      assert.ok(enc[k], `${lg}:${k}`);
  }
});
