import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { postSimpleCard, postActionCard, postDamageCard, postHazardCard, postIntegrityCard } from "../../scripts/chat/chat-cards.mjs";
import { makeCardRenderer } from "../../scripts/chat/attack-card/view.mjs";

const shell = (html, kind) => {
  assert.match(html, new RegExp(`<article class="pf2e chat-card sf2e-tsc-card ${kind}`));
  assert.match(html, /class="card-header/);
  assert.match(html, /class="card-content(?: |")/);
  assert.match(html, /<h3>[^<]+<\/h3>/);
};

test("simple cards use the native chat-card shell and preserve initiator, title and body", async () => {
  installFoundryMock();
  const ship = makeShip({ id: "aurora", name: "Aurora" });
  await postSimpleCard({ actor: ship, title: "Refit complete", body: "<p>Shields restored.</p>" });
  const message = game.messages.contents.at(-1);
  shell(message.content, "simple");
  assert.match(message.content, /Aurora/);
  assert.match(message.content, /Refit complete/);
  assert.match(message.content, /Shields restored\./);
  assert.equal(message.flags[MODULE_ID].card, true);
});

test("action cards use the native shell and show only operation-relevant result content", async () => {
  installFoundryMock();
  const ship = makeShip({ id: "aurora", name: "Aurora" });
  const action = Object.freeze({ id: "evade", name: "Evade", text: "Original rules text." });
  await postActionCard({
    actor: ship,
    action,
    crewName: "Kathi",
    stationName: "Pilot's Console",
    degreeLabel: "Success",
    lines: [{ label: "Check", value: "21 vs DC 20" }],
    reports: ["Evade applied."],
    manual: ["Move the ship."]
  });
  const message = game.messages.contents.at(-1);
  shell(message.content, "action");
  for (const text of ["Aurora", "Evade", "Kathi", "Success", "21 vs DC 20", "Evade applied.", "Move the ship."])
    assert.ok(message.content.includes(text), text);
  assert.match(message.content, /Pilot(?:'|&#39;)s Console/);
  assert.doesNotMatch(message.content, /Original rules text\./);
  assert.equal(
    message.flags[MODULE_ID].actionResultText,
    "Result: Success\nCheck: 21 vs DC 20\n\nConsequences:\nEvade applied.\n\nGM must resolve manually:\nMove the ship."
  );
});

test("action cards render four native outcome sections and keep the rolled degree separate", async () => {
  installFoundryMock({ lang: "ru" });
  const ship = makeShip({ id: "aurora", name: "Aurora" });
  const outcomes = Object.freeze({
    criticalSuccess: Object.freeze([{ type: "manual", text: "Существо невредимо." }]),
    success: Object.freeze([
      {
        type: "text",
        text: "Существо получает половину урона пустотой, и не получает продолжительный урон кровотечением."
      }
    ]),
    failure: Object.freeze([{ type: "manual", text: "Существо получает полный урон." }]),
    criticalFailure: Object.freeze([
      {
        type: "text",
        text: "Существо получает двойной урон пустотой и двойной продолжительный урон кровотечением."
      }
    ])
  });
  const action = Object.freeze({
    id: "degree-probe",
    name: "Degree probe",
    outcomes: Object.freeze({
      ...outcomes,
      criticalSuccess: Object.freeze([...outcomes.criticalSuccess, { type: "applyEffect", text: "AUTOMATION_ONLY" }])
    })
  });
  await postActionCard({ actor: ship, action, degreeLabel: "Успех" });
  const message = game.messages.contents.at(-1);
  const data = message.flags[MODULE_ID].cardData;
  assert.equal(data.degree, 2);
  assert.deepEqual(data.action.outcomes, action.outcomes);
  const labels = ["Критический успех", "Успех", "Провал", "Критический провал"];
  const texts = [
    "Существо невредимо.",
    "Существо получает половину урона пустотой, и не получает продолжительный урон кровотечением.",
    "Существо получает полный урон.",
    "Существо получает двойной урон пустотой и двойной продолжительный урон кровотечением."
  ];
  let previous = -1;
  for (const [index, label] of labels.entries()) {
    const position = message.content.indexOf(`<strong>${label}:</strong>`);
    assert.ok(position > previous, `${label} must follow the native degree order`);
    assert.ok(message.content.includes(texts[index]), texts[index]);
    previous = position;
  }
  assert.match(message.content, /class="[^"]*tsc-outcome[^"]*success[^"]*is-rolled/);
  assert.match(message.content, /<div class="tsc-degree[^"]*"[^>]*>Успех<\/div>/);
  assert.doesNotMatch(message.content, /AUTOMATION_ONLY/);
});

test("action cards do not render outcome legends for cancelled, dry-run or failed results", async () => {
  installFoundryMock({ lang: "ru" });
  const ship = makeShip({ id: "aurora", name: "Aurora" });
  const action = {
    id: "degree-probe",
    name: "Degree probe",
    outcomes: {
      criticalSuccess: [{ type: "manual", text: "Не должно появиться." }],
      success: [{ type: "text", text: "Не должно появиться." }],
      failure: [{ type: "manual", text: "Не должно появиться." }],
      criticalFailure: [{ type: "text", text: "Не должно появиться." }]
    }
  };
  for (const result of [{ ok: true, cancelled: true }, { ok: true, dryRun: true }, { ok: false }]) {
    game.messages.clear();
    await postActionCard({ actor: ship, action, degree: 2, degreeLabel: "Успех", result });
    const message = game.messages.contents.at(-1);
    assert.deepEqual(message.flags[MODULE_ID].cardData.result, result);
    assert.doesNotMatch(message.content, /tsc-outcomes/);
    assert.doesNotMatch(message.content, /Не должно появиться/);
  }
});

test("damage cards use the native shell and include source, typed damage, mitigation and consequences", async () => {
  installFoundryMock();
  const ship = makeShip({ id: "aurora", name: "Aurora" });
  await postDamageCard({
    actor: ship,
    source: "Laser",
    result: {
      originalDamage: 12,
      mitigatedDamage: 8,
      shieldDamage: 5,
      hullDamage: 3,
      resistanceReduction: 2,
      hardnessReduction: 2,
      weaknessIncrease: 0,
      components: [
        { type: "fire", originalDamage: 7, mitigatedDamage: 5 },
        { type: "piercing", originalDamage: 5, mitigatedDamage: 3 }
      ],
      becameCompromised: true,
      newState: { compromised: 1 }
    }
  });
  const message = game.messages.contents.at(-1);
  shell(message.content, "damage");
  for (const text of ["Aurora", "Laser", "fire", "piercing", "12", "8", "5", "3", "Resistance", "Hardness", "Compromised 1"])
    assert.ok(message.content.includes(text), text);
  assert.deepEqual(message.flags[MODULE_ID].damage, message.flags[MODULE_ID].cardData.result);
});

test("single-type damage cards keep the evaluated damage type", async () => {
  installFoundryMock();
  const ship = makeShip({ id: "aurora", name: "Aurora" });
  await postDamageCard({
    actor: ship,
    source: "Laser",
    damageType: "fire",
    parts: [{ type: "fire", amount: 8 }],
    result: { originalDamage: 8, mitigatedDamage: 8, shieldDamage: 8, hullDamage: 0 }
  });
  const message = game.messages.contents.at(-1);
  assert.match(message.content, /Damage type/);
  assert.match(message.content, /fire/);
});

test("hazard cards use the native shell and include hazard, zone, trigger and effect", async () => {
  installFoundryMock();
  await postHazardCard({
    hazard: { name: "Plasma Storm" },
    zone: 3,
    title: "The storm surges.",
    effectText: "All ships take 1d6 fire damage."
  });
  const message = game.messages.contents.at(-1);
  shell(message.content, "hazard");
  for (const text of ["Plasma Storm", "Zone", "3", "The storm surges.", "1d6 fire damage"]) assert.ok(message.content.includes(text), text);
  assert.match(message.content, /@Damage\[1d6\[fire\]\]/);
});

test("hazard cards retain the localized default trigger text", async () => {
  installFoundryMock();
  await postHazardCard({ hazard: { name: "Plasma Storm" }, zone: 2, effectText: "Take 1d6 fire damage." });
  assert.match(game.messages.contents.at(-1).content, /Trigger activated\./);
});

test("integrity cards use the native shell and include DC, degree, state delta and outcome", async () => {
  installFoundryMock();
  const ship = makeShip({ id: "aurora", name: "Aurora" });
  await postIntegrityCard({ actor: ship, dc: 14, degreeLabel: "Failure", delta: 1, newValue: 2, outcomeText: "Still inoperable." });
  const message = game.messages.contents.at(-1);
  shell(message.content, "integrity");
  for (const text of ["Aurora", "Hull integrity check", "14", "Failure", "+1", "2", "Still inoperable."])
    assert.ok(message.content.includes(text), text);
});

test("starship attack fallback uses the same native shell without losing targets or results", () => {
  const labels = {
    "SF2eTSC.attackCard.attacker": "Attacker",
    "SF2eTSC.attackCard.attackType": "Attack type",
    "SF2eTSC.attackCard.noCrew": "Ship (no crew)",
    "SF2eTSC.ui.traits": "Traits",
    "SF2eTSC.chat.damage": "Damage",
    "SF2eTSC.attackCard.range": "Range",
    "SF2eTSC.attackCard.zones": "zones",
    "SF2eTSC.mods.attackBonus": "Attack bonus",
    "SF2eTSC.ui.map": "MAP",
    "SF2eTSC.attackCard.modifiers": "Modifiers",
    "SF2eTSC.attackCard.resultTitle": "Result",
    "SF2eTSC.attackCard.target": "Target",
    "SF2eTSC.chat.attack": "Attack",
    "SF2eTSC.ui.ac": "AC",
    "SF2eTSC.chat.result": "Outcome",
    "SF2eTSC.attackCard.type.ranged": "Ranged",
    "SF2eTSC.attackCard.status.resolved": "Resolved",
    "SF2eTSC.attackCard.consequences": "Consequences",
    "SF2eTSC.chat.resistance": "Resistance",
    "SF2eTSC.chat.hardness": "Hardness",
    "SF2eTSC.chat.weakness": "Weakness",
    "SF2eTSC.ui.sp": "SP",
    "SF2eTSC.ui.hp": "HP",
    "SF2eTSC.rolls.damageFormula": "Damage formula",
    "SF2eTSC.rolls.critical": "Critical"
  };
  const { renderAttackCard } = makeCardRenderer({ t: (key) => labels[key] ?? key, has: (key) => key in labels });
  const card = {
    status: "resolved",
    ship: { name: "Aurora" },
    crew: null,
    action: { name: "Spell Attack", builtin: "spell-attack" },
    weapon: { name: "Laser", traits: ["force"], damage: "1d6", damageType: "force" },
    attackType: "ranged",
    range: { zones: 5 },
    bonus: { value: 10 },
    map: { current: 0 },
    targets: [],
    result: {
      targetLabel: "Defender",
      attack: { total: 18, natural: 16, ac: 17, degreeLabel: "Success" },
      damage: [{ rolled: 6, damageType: "force", shield: 4, hull: 2, resisted: 0, hardness: 0, weakness: 0 }],
      reports: ["Shield depleted."]
    }
  };
  const html = renderAttackCard({ flags: { [MODULE_ID]: { attackCard: card } } });
  shell(html, "tsc-attack-card");
  for (const text of ["Aurora", "Spell Attack", "Laser", "Defender", "18", "Success", "SP −4", "HP −2", "Shield depleted."])
    assert.ok(html.includes(text), text);
});
