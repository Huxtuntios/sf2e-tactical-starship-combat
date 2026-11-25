import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadLang } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { CARD_FLAG } from "../../scripts/chat/attack-card/model.mjs";
import { makeCardRenderer } from "../../scripts/chat/attack-card/view.mjs";

const render = (card) => makeCardRenderer({ t: (key) => key }).renderAttackCard({ flags: { [MODULE_ID]: { [CARD_FLAG]: card } } });
const ru = loadLang("ru");
const renderRu = (card) =>
  makeCardRenderer({
    t: (key, data = {}) => String(ru[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => (name in data ? String(data[name]) : match)),
    has: (key) => key in ru
  }).renderAttackCard({ flags: { [MODULE_ID]: { [CARD_FLAG]: card } } });
const baseCard = () => ({
  status: "resolved",
  ship: { name: "Attacker" },
  action: { name: "Strike", builtin: "strike" },
  weapon: {
    name: "Plasma cannon",
    profile: { plasma: true, area: true, shape: { type: "burst", value: 2 }, save: { type: "reflex", basic: true, dc: 15 } }
  },
  range: {},
  targets: [],
  result: {
    targetLabel: "Defender",
    pendingDamage: {
      formula: "2d6",
      damageType: "fire",
      targets: [{ targetUuid: "Actor.one", targetKey: "Actor.one" }],
      save: { type: "reflex", basic: true, dc: 15 }
    }
  }
});

test("resolved area plasma card shows shape and one Damage plus Save control", () => {
  const html = render(baseCard());
  assert.match(html, /SF2eTSC\.attackCard\.attackShape/);
  assert.match(html, /SF2eTSC\.attackCard\.shape\.burst/);
  assert.equal((html.match(/data-tsc-attack="damage"/g) ?? []).length, 1);
  assert.equal((html.match(/data-tsc-attack="save"/g) ?? []).length, 1);
  assert.match(html, /SF2eTSC\.attackCard\.damage/);
  assert.match(html, /SF2eTSC\.attackCard\.save/);
  assert.doesNotMatch(html, /data-tsc-attack="apply"/);
});

test("plasma apply appears only after damage and every target save are rolled", () => {
  const card = baseCard();
  card.damageRoll = { total: 8, formula: "2d6" };
  assert.doesNotMatch(render(card), /data-tsc-attack="apply"/);
  card.saveRolls = [{ targetUuid: "Actor.one", degree: 2, total: 20, multiplier: 0.5 }];
  const html = render(card);
  assert.equal((html.match(/data-tsc-attack="damage"/g) ?? []).length, 1);
  assert.equal((html.match(/data-tsc-attack="save"/g) ?? []).length, 1);
  assert.equal((html.match(/data-tsc-attack="apply"/g) ?? []).length, 1);
});

test("resolved plasma card renders a native save-outcome legend without losing per-target data or controls", () => {
  const card = baseCard();
  card.weapon.damageType = "void";
  card.result.pendingDamage.damageType = "void";
  card.damageRoll = { total: 8, formula: "2d6" };
  card.saveRolls = [
    { targetUuid: "Actor.one", degree: 3, total: 25, multiplier: 0, label: "Defender" },
    { targetUuid: "Actor.two", degree: 2, total: 20, multiplier: 0.5, label: "Second" },
    { targetUuid: "Actor.three", degree: 1, total: 10, multiplier: 1, label: "Third" },
    { targetUuid: "Actor.four", degree: 0, total: 1, multiplier: 2, label: "Fourth" }
  ];
  card.saveTargetUUIDs = card.saveRolls.map((save) => save.targetUuid);
  card.damageResults = [
    { target: "Defender", rolled: 0, damageType: "void", shield: 0, hull: 0 },
    { target: "Second", rolled: 4, damageType: "void", shield: 4, hull: 0 },
    { target: "Third", rolled: 8, damageType: "void", shield: 8, hull: 0 },
    { target: "Fourth", rolled: 16, damageType: "void", shield: 8, hull: 8 }
  ];
  const html = renderRu(card);
  const labels = ["Критический успех", "Успех", "Провал", "Критический провал"];
  const texts = [
    "Цель не получает урона.",
    "Цель получает половину урона (пустота).",
    "Цель получает полный урон (пустота).",
    "Цель получает двойной урон (пустота)."
  ];
  let previous = -1;
  for (const [index, label] of labels.entries()) {
    const position = html.indexOf(`<strong>${label}:</strong>`);
    assert.ok(position > previous, `${label} must follow the native degree order`);
    assert.ok(html.includes(texts[index]), texts[index]);
    previous = position;
  }
  assert.equal((html.match(/class="tsc-outcome [^"]*is-rolled/g) ?? []).length, 4);
  for (const text of ["Defender", "Second", "Third", "Fourth", "25", "20", "10", "×0", "×0.5", "×1", "×2", "ОЩ −4", "ОК −8"])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/data-tsc-attack="damage"/g) ?? []).length, 1);
  assert.equal((html.match(/data-tsc-attack="save"/g) ?? []).length, 1);
  assert.equal((html.match(/data-tsc-attack="apply"/g) ?? []).length, 1);
});

test("plasma save legends are omitted before resolution, after cancellation and for non-basic saves", () => {
  for (const status of ["open", "resolving", "void"]) {
    const card = baseCard();
    card.status = status;
    assert.doesNotMatch(renderRu(card), /tsc-outcomes/, status);
  }
  const card = baseCard();
  card.weapon.profile.save.basic = false;
  card.result.pendingDamage.save.basic = false;
  assert.doesNotMatch(renderRu(card), /tsc-outcomes/);
  const failed = baseCard();
  failed.error = "Attack failed.";
  assert.doesNotMatch(renderRu(failed), /tsc-outcomes/);
});

test("non-area plasma without save metadata gets Damage only and never an invented Save", () => {
  const card = baseCard();
  card.weapon.profile = { plasma: true, area: false, shape: { type: "single", value: null }, save: null };
  delete card.result.pendingDamage.save;
  card.damageRoll = { total: 8, formula: "2d6" };
  const html = render(card);
  assert.equal((html.match(/data-tsc-attack="damage"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-tsc-attack="save"/);
  assert.equal((html.match(/data-tsc-attack="apply"/g) ?? []).length, 1);
});

test("non-plasma card keeps the legacy damage label and has no plasma shape or Save", () => {
  const card = baseCard();
  card.weapon = { name: "Coilgun" };
  delete card.result.pendingDamage.save;
  const html = render(card);
  assert.match(html, /SF2eTSC\.rolls\.rollDamage/);
  assert.doesNotMatch(html, /SF2eTSC\.attackCard\.attackShape/);
  assert.doesNotMatch(html, /data-tsc-attack="save"/);
  assert.equal((html.match(/data-tsc-attack="damage"/g) ?? []).length, 1);
});

test("plasma control and shape labels exist in both EN and RU", () => {
  const en = JSON.parse(readFileSync(new URL("../../lang/en.json", import.meta.url))).SF2eTSC.attackCard;
  const ru = JSON.parse(readFileSync(new URL("../../lang/ru.json", import.meta.url))).SF2eTSC.attackCard;
  for (const key of ["attackShape", "damage", "save"]) assert.equal(typeof en[key], "string", `EN ${key}`);
  for (const key of ["damage", "save"]) assert.equal(typeof ru[key], "string", `RU ${key}`);
  assert.equal(typeof en.shape.single, "string");
  assert.equal(typeof ru.shape.single, "string");
});
