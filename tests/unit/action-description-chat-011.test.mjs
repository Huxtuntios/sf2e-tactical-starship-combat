import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeCharacter, makeShip } from "../helpers/foundry-mock.mjs";
import { registerHandler } from "../../scripts/socket.mjs";

const M = "sf2e-tactical-starship-combat";

async function scenario() {
  installFoundryMock();
  foundry.applications.sheets = { ActorSheetV2: class {} };
  const content = await loadContentFromDisk();
  game.packs = new Map();
  const crew = makeCharacter({ id: "operator", name: "Operator", owners: ["p1"] });
  const ship = makeShip({
    id: "aurora",
    name: "Aurora",
    owners: ["p1"],
    stations: [{ id: "pilot", name: "Pilot's Console", type: "pilot", grade: "commercial", helmedBy: crew.uuid }],
    crew: [{ actorUuid: crew.uuid, name: crew.name, role: "crew", stationId: "pilot", userId: "p1" }]
  });
  return { content, crew, ship };
}

function targetFor(ship, crew, stationId = "pilot") {
  return {
    dataset: { actionId: "evade", shipUuid: ship.uuid, crewUuid: crew.uuid, stationId },
    textContent: "Evade",
    closest: () => ({ querySelector: () => ({ innerHTML: "<p>Fallback description</p>" }) })
  };
}

const event = () => ({ preventDefault() {}, stopPropagation() {} });

function assertChatOnlySideEffects(ship, before) {
  assert.equal(game.messages.size, 1);
  const message = [...game.messages.values()][0];
  assert.equal(message.rolls.length, 0);
  assert.equal(globalThis.__writes.length, 0);
  assert.equal(globalThis.__socket.length, 0);
  assert.deepEqual(ship.flags[M], before);
  assert.deepEqual([...game.user.targets], ["Token.untouched"]);
  return message;
}

test("chat-only description sends one standard message with source and game info, without execution side effects", async () => {
  const { content, crew, ship } = await scenario();
  game.user.targets = new Set(["Token.untouched"]);
  const before = structuredClone(ship.flags[M]);
  const diceBefore = [...globalThis.__dice];
  const { sendActionDescription } = await import("../../scripts/ui/action-controls.mjs");
  assert.equal(typeof sendActionDescription, "function");
  await sendActionDescription.call({ document: ship }, event(), targetFor(ship, crew));
  const message = assertChatOnlySideEffects(ship, before);
  assert.deepEqual(globalThis.__dice, diceBefore);
  assert.equal(message.flags[M].card, undefined);
  assert.deepEqual(message.flags[M].actionDescription, {
    actionId: "evade",
    shipUuid: ship.uuid,
    crewUuid: crew.uuid,
    stationId: "pilot",
    sourceText: content.actions.get("evade").text,
    resultText: ""
  });
  assert.match(message.content, /<h3>Evade<\/h3>/);
  assert.match(message.content, /Aurora/);
  assert.match(message.content, /Operator/);
  assert.match(message.content, /Pilot&#39;s Console/);
  assert.match(message.content, /1–2/);
  assert.match(message.content, /Your starship gains a \+1 circumstance bonus/);
  assert.doesNotMatch(message.content, /Result:/);
});

test("HTML action descriptions preserve tags and link numeric checks, damage, and contextual DCs", async () => {
  const { crew } = await scenario();
  crew.skills = { crafting: { dc: { value: 10 } } };
  const sourceText = "<p>DC 20 Reflex save and 1d6 fire damage and your Crafting DC.</p>";
  const { sendActionDescriptionToChat } = await import("../../scripts/ui/action-controls.mjs");
  await sendActionDescriptionToChat({
    action: { id: "inline-html-probe", name: "Inline HTML probe", cost: 1, text: sourceText },
    crew
  });
  const message = [...game.messages.values()][0];
  assert.equal(message.flags[M].actionDescription.sourceText, sourceText);
  assert.match(
    message.content,
    /<div class="tsc-action-source-text"><p>@Check\[reflex\|dc:20\]\{Reflex save\} and @Damage\[1d6\[fire\]\]\{1d6 fire damage\} and your Crafting DC \(10\)\.<\/p><\/div>/
  );
  assert.equal((message.content.match(/@Check\[/g) ?? []).length, 1);
  assert.equal((message.content.match(/@Damage\[/g) ?? []).length, 1);
});

test("plain action descriptions escape HTML before linking native enrichers", async () => {
  const { crew } = await scenario();
  const sourceText = "Use <strong>DC 20 Reflex save</strong>, @Check[will|dc:14]{Will save}, and 1d6 fire damage.";
  const { sendActionDescriptionToChat } = await import("../../scripts/ui/action-controls.mjs");
  await sendActionDescriptionToChat({
    action: { id: "inline-plain-probe", name: "Inline plain probe", cost: 1, text: sourceText },
    crew
  });
  const message = [...game.messages.values()][0];
  assert.equal(message.flags[M].actionDescription.sourceText, sourceText);
  assert.match(
    message.content,
    /<div class="tsc-action-source-text"><p>Use &lt;strong&gt;@Check\[reflex\|dc:20\]\{Reflex save\}&lt;\/strong&gt;, @Check\[will\|dc:14\]\{Will save\}, and @Damage\[1d6\[fire\]\]\{1d6 fire damage\}\.<\/p><\/div>/
  );
});

test("a completed action result is appended separately and cancelled results are omitted", async () => {
  const { crew, ship } = await scenario();
  const { sendActionDescription } = await import("../../scripts/ui/action-controls.mjs");
  assert.equal(typeof sendActionDescription, "function");
  const result = { ok: true, degreeLabel: "Success", reports: ["Evade applied."] };
  await sendActionDescription.call({}, event(), targetFor(ship, crew), { result });
  let message = [...game.messages.values()][0];
  assert.equal(message.flags[M].actionDescription.resultText, "Result: Success\n\nConsequences:\nEvade applied.");
  assert.match(message.content, /Result: Success/);
  assert.match(message.content, /Evade applied\./);
  game.messages.clear();
  await sendActionDescription.call({}, event(), targetFor(ship, crew), {
    result: { ok: true, cancelled: true, degreeLabel: "Critical Success", reports: ["Must not appear"] }
  });
  message = [...game.messages.values()][0];
  assert.equal(message.flags[M].actionDescription.resultText, "");
  assert.doesNotMatch(message.content, /Must not appear|Critical Success|Result:/);
});

test("station HUD, ship action list and Sensor Map dock each expose the same chat-only path", async () => {
  const { crew, ship } = await scenario();
  game.user.targets = new Set(["Token.untouched"]);
  const { StationHUD } = await import("../../scripts/ui/station-hud.mjs");
  const { StarshipSheet } = await import("../../scripts/ui/starship-sheet.mjs");
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  for (const cls of [StationHUD, StarshipSheet, SensorMapApplication]) {
    game.messages.clear();
    globalThis.__writes.length = 0;
    globalThis.__socket.length = 0;
    const before = structuredClone(ship.flags[M]);
    const handler = cls.DEFAULT_OPTIONS.actions.sendActionDescription;
    assert.equal(typeof handler, "function", cls.name);
    await handler.call({ document: ship }, event(), targetFor(ship, crew));
    assertChatOnlySideEffects(ship, before);
  }
});

test("an action options dialog can send the description without executing the action", async () => {
  const { content, crew, ship } = await scenario();
  const { runAction } = await import("../../scripts/ui/action-runner.mjs");
  const action = { ...content.actions.get("evade"), id: "repair-hull-drone", cost: 2 };
  let requests = 0;
  registerHandler("executeAction", async () => {
    requests++;
    return { ok: true };
  });
  let prompts = 0;
  let sendButton;
  foundry.applications.api.DialogV2.prompt = async (config) => {
    prompts++;
    sendButton = config.buttons?.find((button) => button.action === "sendDescription");
    return sendButton ? sendButton.callback() : null;
  };
  await runAction(action, { ship, crew, station: ship.flags[M].starship.stations[0] });
  assert.equal(prompts, 1);
  assert.ok(sendButton, "the action dialog must offer a chat-only description button");
  assert.equal(game.messages.size, 1);
  assert.equal(requests, 0);
  assert.equal(globalThis.__writes.length, 0);
  assert.equal(globalThis.__socket.length, 0);
});

test("ship-specific NPC source text remains immutable when sent to chat", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  game.packs = new Map();
  const ship = makeShip({
    id: "npc",
    name: "NPC ship",
    role: "npc",
    extra: { npcActions: [{ name: "Charity Lance", cost: 3, text: "Original NPC rules." }] }
  });
  const before = structuredClone(ship.flags[M]);
  const { sendActionDescription } = await import("../../scripts/ui/action-controls.mjs");
  assert.equal(typeof sendActionDescription, "function");
  const target = {
    dataset: { actionId: "inline:charity-lance", shipUuid: ship.uuid },
    textContent: "Charity Lance",
    closest: () => ({ querySelector: () => ({ innerHTML: "Prepared NPC description" }) })
  };
  await sendActionDescription.call({}, event(), target);
  const message = [...game.messages.values()][0];
  assert.equal(message.flags[M].actionDescription.sourceText, "Original NPC rules.");
  assert.match(message.content, /Original NPC rules\./);
  assert.deepEqual(ship.flags[M], before);
  assert.equal(globalThis.__writes.length, 0);
});

function render(template, context) {
  const h = Handlebars.create();
  h.registerHelper("localize", (key) => key);
  h.registerHelper("eq", (a, b) => a === b);
  for (const name of [
    "tscOccupant",
    "tscStationUpgrades",
    "tscShipUpgrades",
    "tscUpgradeItem",
    "modules/sf2e-tactical-starship-combat/templates/crew-ship.hbs"
  ])
    h.registerPartial(name, "");
  return h.compile(readFileSync(new URL(`../../templates/${template}.hbs`, import.meta.url), "utf8"))(context);
}

test("action rows render an accessible send-description control in every action surface", () => {
  const actions = [{ id: "evade", name: "Evade", icon: "◆–◆◆", enabled: true, html: "<p>Rules</p>", desc: "<p>Rules</p>" }];
  for (const [template, context] of [
    ["station-hud", { crewUuid: "Actor.operator", shipUuid: "Actor.ship", stationId: "pilot", actions }],
    ["sensor-map-dock", { dock: { crewUuid: "Actor.operator", shipUuid: "Actor.ship", stationId: "pilot", actions } }],
    ["starship-sheet", { tab: "stations", stations: [{ id: "pilot", helmedBy: "Actor.operator", actionList: actions }], ship: {} }]
  ]) {
    const html = render(template, context);
    const button = html.match(/<button[^>]+data-action="sendActionDescription"[^>]*>/)?.[0];
    assert.ok(button, template);
    assert.match(button, /data-action-id="evade"/);
    assert.match(button, /aria-label="[^"]+"/);
    assert.doesNotMatch(button, /\bdisabled\b/);
  }
});
