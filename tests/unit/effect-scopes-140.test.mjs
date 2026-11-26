import test from "node:test";
import assert from "node:assert/strict";
import {
  EFFECT_MECHANICS,
  normalizeEffectTargets,
  mechanicForSelector,
  matchesEffectScope,
  applicableEffects
} from "../../scripts/starship/effect-scopes.mjs";

test("normalizes and deduplicates effect targets", () => {
  const targets = normalizeEffectTargets({
    entire: false,
    mechanics: ["ac", "ac"],
    stations: ["gun-1", "gun-1"],
    actions: [
      { stationId: "gun-1", actionId: "strike" },
      { stationId: "gun-1", actionId: "strike" }
    ],
    weapons: ["laser-1", "laser-1"],
    crew: ["Actor.crew-1", "Actor.crew-1"]
  });
  assert.deepEqual(targets.mechanics, ["ac"]);
  assert.deepEqual(targets.stations, ["gun-1"]);
  assert.equal(targets.actions.length, 1);
  assert.deepEqual(targets.weapons, ["laser-1"]);
  assert.deepEqual(targets.crew, ["Actor.crew-1"]);
  assert.deepEqual(EFFECT_MECHANICS, ["abilities", "skills", "attacks", "saves", "ac", "defenses"]);
});

test("maps selectors to mechanics", () => {
  assert.equal(mechanicForSelector("ac"), "ac");
  assert.equal(mechanicForSelector("reflex"), "saves");
  assert.equal(mechanicForSelector("attack"), "attacks");
  assert.equal(mechanicForSelector("station-check"), "skills");
});

test("matches entire, station, action, weapon, and crew-only scopes", () => {
  assert.equal(matchesEffectScope({ targets: { entire: true } }, { selector: "ac" }), true);
  assert.equal(
    matchesEffectScope({ targets: { entire: false, stations: ["gun-1"] } }, { selector: "station-check", stationId: "gun-1" }),
    true
  );
  assert.equal(
    matchesEffectScope(
      { targets: { entire: false, actions: [{ stationId: "gun-1", actionId: "strike" }] } },
      { selector: "station-check", stationId: "gun-1", actionId: "strike" }
    ),
    true
  );
  assert.equal(matchesEffectScope({ targets: { entire: false, weapons: ["laser-1"] } }, { selector: "attack", weaponId: "laser-1" }), true);
  assert.equal(matchesEffectScope({ targets: { entire: false, crew: ["Actor.crew-1"] } }, { selector: "ac" }), false);
});

test("deduplicates applicable effects by id", () => {
  const effects = [
    { id: "one", targets: { entire: true } },
    { id: "one", targets: { entire: true } },
    { id: "two", targets: { entire: false, mechanics: ["ac"] } }
  ];
  assert.deepEqual(
    applicableEffects(effects, { selector: "ac" }).map((effect) => effect.id),
    ["one", "two"]
  );
});
