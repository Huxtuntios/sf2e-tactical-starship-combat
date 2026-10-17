// 0.2.0 regression tests: MAP, per-station frequency, turn guard, Target Lock consumption, NPC statblock actions, content quality.
import test from "node:test";
globalThis.foundry ??= { utils: { randomID: () => Math.random().toString(36).slice(2, 18) } };
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { turnKey } from "../../scripts/engine/cost.mjs";
import { frequencyKey, isFrequencyAvailable, recordUse } from "../../scripts/engine/frequency.mjs";
import { makeEffect, effectsAgainst, consumedByStrike, offGuardAgainst, hasCondition } from "../../scripts/starship/effects.mjs";
import { buildNpcAction, npcInlineAction, slugifyName } from "../../scripts/actions/npc-inline.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const index = read("index.json");
const ships = index.starships.flatMap((f) => read(f).ships);
const hazards = read(index.hazards).hazards;
const actions = read(index.actions).actions;

test("turn key = round + combatant; index-only corrections keep the key", () => {
  const a = { round: 3, turn: 2, combatant: { id: "X" } };
  const corrected = { round: 3, turn: 3, combatant: { id: "X" } }; // compromised ship inserted before X
  assert.equal(turnKey(a), turnKey(corrected));
  assert.notEqual(turnKey(a), turnKey({ round: 4, turn: 2, combatant: { id: "X" } }));
  assert.equal(turnKey({ round: 1, combatant: null }), null);
});
test("frequency is tracked per battle station (two gunnery stations)", () => {
  const act = { id: "boost-thrusters", station: "pilot", frequency: { per: "round", uses: 1 } };
  const g1 = { id: "pilot-1" },
    g2 = { id: "pilot-2" };
  assert.equal(frequencyKey(act, g1), "pilot-1:boost-thrusters");
  assert.notEqual(frequencyKey(act, g1), frequencyKey(act, g2));
  assert.equal(frequencyKey(act, null), "boost-thrusters");
  assert.equal(frequencyKey({ ...act, frequencyScope: "ship" }, g1), "boost-thrusters");
  const now = { round: 2, turn: 0, time: 0 };
  const used = { [frequencyKey(act, g1)]: recordUse(null, now) };
  assert.equal(isFrequencyAvailable(act.frequency, used[frequencyKey(act, g1)], now), false);
  assert.equal(isFrequencyAvailable(act.frequency, used[frequencyKey(act, g2)], now), true);
});
test("Target Lock: off-guard only against the source ship and consumed by its next Strike", () => {
  const e = makeEffect(
    { slug: "target-lock", conditions: ["off-guard"], against: "source", consumeOn: "strike" },
    { sourceUuid: "Actor.me" }
  );
  assert.equal(e.against, "Actor.me");
  assert.equal(hasCondition([e], "off-guard"), false, "not globally off-guard");
  assert.equal(offGuardAgainst([e], "Actor.me"), true);
  assert.equal(offGuardAgainst([e], "Actor.other"), false);
  assert.deepEqual(consumedByStrike([e], "Actor.me"), [e]);
  assert.deepEqual(consumedByStrike([e], "Actor.other"), []);
  assert.equal(effectsAgainst([e], "Actor.other").length, 0);
  const g = makeEffect({ slug: "off-guard", conditions: ["off-guard"] }, { sourceUuid: "Actor.me" });
  assert.equal(hasCondition([g], "off-guard"), true);
});
test("action data: Hack Battle Station has no crit-failure backlash; Hack Munition does; Target Lock/Lock On are source-only", () => {
  const by = Object.fromEntries(actions.map((a) => [a.id, a]));
  assert.equal(by["hack-battle-station"].outcomes.criticalFailure, undefined);
  assert.ok(by["hack-munition"].outcomes.criticalFailure?.length);
  const tl = by["target-lock"].outcomes;
  assert.equal(tl.criticalSuccess, undefined);
  assert.equal(tl.success[0].effect.consumeOn, "strike");
  assert.equal(tl.success[0].effect.against, "source");
  assert.equal(tl.failure[0].effect.against, "source");
  assert.equal(by["lock-on"].effects[0].effect.against, "source");
});
test("NPC statblock actions are rebuilt from ship data (strike + manual)", () => {
  const nexus = ships.find((s) => s.id === "klokworx-nexus");
  const data = {
    strikes: nexus.strikes,
    npcActions: nexus.actions,
    stations: nexus.stations.map((s) => ({ type: s.type, actions: s.actions.map((a) => a.name) }))
  };
  const strike = buildNpcAction(data, "npc-strike:laser");
  assert.equal(strike.builtin, "npc-strike");
  assert.equal(strike.strike.attack, 27);
  assert.ok(strike.traits.includes("attack"));
  const inl = buildNpcAction(data, `inline:${slugifyName("Deploy Drone")}`);
  assert.equal(inl.cost, 1);
  assert.deepEqual(inl.frequency, { uses: 1, per: "turn" });
  assert.equal(inl.station, "drone-console");
  assert.equal(buildNpcAction(data, "inline:does-not-exist"), null);
  assert.equal(npcInlineAction("Living Starship", { cost: "passive", text: "x" }).passive, true);
});
test("content: 74 Tech Core starships with complete core statistics", () => {
  assert.equal(ships.length, 74);
  for (const s of ships) {
    for (const k of ["level", "perception", "sensorRange", "ac", "fort", "ref", "will", "hp", "speed"])
      assert.ok(Number.isInteger(s[k]), `${s.id}.${k}`);
    assert.ok(s.stations.length > 0, `${s.id} stations`);
    const names = s.actions.map((a) => a.name.toLowerCase());
    assert.equal(new Set(names).size, names.length, `${s.id} duplicate actions`);
    for (const a of s.actions)
      assert.ok(
        ["one-action", "two-actions", "three-actions", "reaction", "free-action", "passive"].includes(a.cost),
        `${s.id}/${a.name} cost ${a.cost}`
      );
    for (const st of s.strikes) {
      assert.ok(Number.isInteger(st.attack) && /\d+d\d+/.test(st.damage), `${s.id}/${st.name}`);
      if (st.kind === "ranged")
        assert.ok(
          st.traits.some((t) => /range/.test(t)),
          `${s.id}/${st.name} range`
        );
    }
  }
  const dom = ships.find((s) => s.id === "sovereign-dominator");
  assert.equal(dom.sp, 32, "PDF value (AoN dump shows 132)");
});
test("content: 32 hazards, stealth + complexity + routine for complex ones", () => {
  assert.equal(hazards.length, 32);
  for (const h of hazards) {
    assert.ok(Number.isInteger(h.stealthDC) || Number.isInteger(h.stealthBonus), `${h.id} stealth`);
    assert.ok(h.actions.length > 0, `${h.id} actions`);
    if (h.isComplex) assert.ok(h.routine || h.actions.length > 1, `${h.id} routine`);
  }
  assert.equal(hazards.find((h) => h.id === "astral-barnacles").isComplex, false);
  assert.equal(hazards.find((h) => h.id === "boarding-pod").isComplex, true);
});
