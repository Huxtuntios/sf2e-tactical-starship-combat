import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter } from "../helpers/foundry-mock.mjs";
import { buildNpcAction, npcActionDescription, slugifyName } from "../../scripts/actions/npc-inline.mjs";
import { collectNpcActions } from "../../scripts/actions/npc-rows.mjs";
import { buildShipActorData } from "../../scripts/content/ship-docs.mjs";
import { MockActor } from "../helpers/foundry-mock.mjs";
import { stripChecks } from "../../scripts/content/content-i18n.mjs";
import { contextDCs, linkContextDCs } from "../../scripts/rolls/context-dc.mjs";
import { setContentTranslations } from "../../scripts/content/content-i18n.mjs";

installFoundryMock();
const { npcRow } = await import("../../scripts/ui/sheet/sheet-rows.mjs");
const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");

test("NPC catalogue-named abilities open ship-specific full text, not a generic compendium Item", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { showActionDescription } = await import("../../scripts/ui/action-controls.mjs");
  const npc = makeShip({ role: "npc", extra: { npcActions: [{ name: "Evade", cost: "one-action", text: "NPC-specific full rules" }] } });
  game.packs = new Map([
    [
      "sf2e-tactical-starship-combat.starship-actions",
      {
        getIndex: async () => [{ _id: "generic", flags: { "sf2e-tactical-starship-combat": { packAction: { actionId: "evade" } } } }],
        folders: new Map(),
        getDocument: async () => ({
          sheet: {
            render() {
              assert.fail("generic Item discards the NPC-specific description");
            }
          }
        })
      }
    ]
  ]);
  let opened, renderOptions;
  CONFIG.Item = {
    documentClass: class {
      constructor(data) {
        this.sheet = {
          render(force, options) {
            opened = data;
            renderOptions = options;
          }
        };
      }
    }
  };
  const prepared = "<p>NPC-specific full rules</p>";
  await showActionDescription.call(
    { document: npc },
    { preventDefault() {}, stopPropagation() {} },
    { dataset: { actionId: "evade" }, textContent: "Evade", closest: () => ({ querySelector: () => ({ innerHTML: prepared }) }) }
  );
  assert.equal(opened.system.description.value, prepared);
  assert.equal(renderOptions?.editable, false);
  assert.equal(globalThis.__writes.length, 0);
});

for (const system of ["sf2e", "pf2e"]) {
  for (const lang of ["en", "ru"]) {
    test(`all 74 NPC compendium sources retain complete ability descriptions (${system}/${lang})`, async () => {
      installFoundryMock({ lang });
      game.system.id = system;
      const content = await loadContentFromDisk();
      let rowsChecked = 0,
        familyChecked = 0;
      for (const source of content.ships) {
        const document = buildShipActorData(source);
        const npc = new MockActor({ ...document, pack: "module.starships" });
        const data = npc.flags["sf2e-tactical-starship-combat"].starship;
        const before = npc.toObject();
        const entries = collectNpcActions(data, { actions: content.actions.values(), get: (id) => content.actions.get(id) });
        const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
        for (const entry of entries) {
          if (!entry.action) continue;
          const own = source.actions?.find(
            (a) =>
              slugifyName(a.name) === slugifyName(entry.action.name) ||
              (entry.id === "fortify-shield-points" && slugifyName(a.name) === "fortify-shields")
          );
          if (!own) continue;
          const description = stripChecks(npcActionDescription(entry.action));
          assert.ok(description.includes(own.text), `${source.id}: ${own.name} omitted its complete text`);
          if (own.familyText) {
            assert.ok(description.includes(own.familyText), `${source.id}: ${own.name} omitted family text`);
            familyChecked++;
          }
          assert.ok(
            ctx.npcActions.some((row) => row.id === entry.id && row.html),
            `${source.id}: ${entry.id} has no description`
          );
          rowsChecked++;
        }
        assert.deepEqual(npc.toObject(), before);
      }
      assert.equal(content.ships.length, 74);
      assert.ok(rowsChecked > 100);
      assert.equal(familyChecked, 11);
    });
  }
}

for (const lang of ["en", "ru"]) {
  test(`NPC family ability description includes full rules and its explicit save (${lang})`, async (t) => {
    t.after(() => setContentTranslations("en", {}));
    installFoundryMock({ lang });
    await loadContentFromDisk();
    const text = "DC 19, 2d8 piercing damage";
    const familyText =
      "The target attempts a Fortitude save against the listed DC. Critical Success The target is unaffected. Failure The target takes full damage and a station becomes malfunctioning.";
    setContentTranslations(
      lang,
      lang === "ru"
        ? {
            [text]: "КС 19, 2d8 колющего урона",
            [familyText]:
              "Цель совершает спасбросок Стойкости против указанного КС. Критический успех: цель не затронута. Провал: цель получает полный урон, и станция становится неисправной."
          }
        : {}
    );
    const npc = makeShip({ id: "npc", role: "npc", extra: { npcActions: [{ name: "Harpoon", cost: "two-actions", text, familyText }] } });
    const source = npc.toObject();
    const action = buildNpcAction(npc.flags["sf2e-tactical-starship-combat"].starship, "inline:harpoon");
    const row = npcRow(action, null, npc);
    assert.match(row.html, /(?:unaffected|не затронута)/);
    assert.match(row.html, /(?:malfunctioning|неисправной)/);
    assert.match(row.html, /fortitude\|dc:19/);
    assert.match(row.html, /(?:2d8|2d8)/);
    assert.deepEqual(npc.toObject(), source);
    setContentTranslations("en", {});
  });
}

for (const [text, check] of [
  ["DC 19 basic Fortitude save", /fortitude\|dc:19\|basic/],
  ["DC 19 Reflex save", /reflex\|dc:19/]
]) {
  test(`NPC explicit save takes precedence over family inference: ${text}`, async () => {
    installFoundryMock();
    await loadContentFromDisk();
    const npc = makeShip({
      role: "npc",
      extra: { npcActions: [{ name: "Explicit", cost: 1, text, familyText: "The target attempts a Fortitude save." }] }
    });
    const row = npcRow(buildNpcAction(npc.flags["sf2e-tactical-starship-combat"].starship, "inline:explicit"), null, npc);
    assert.match(row.html, check);
  });
}

for (const [name, id, station] of [
  ["Fortify Shields", "fortify-shield-points", "generator"],
  ["Engaged-Strike", "engaged-strike", "gunnery"]
]) {
  test(`NPC source alias retains its complete rules and native description: ${name}`, async () => {
    installFoundryMock();
    const content = await loadContentFromDisk();
    const text = "claw (page 208). Ship-specific complete rules.";
    const familyText = "Ship-specific family rules.";
    const npc = makeShip({
      role: "npc",
      stations: [{ id: station, type: station, actions: [name] }],
      extra: {
        fortify: 5,
        strikes: [{ name: "claw", kind: "melee", attack: 10, damage: "1d6 piercing", traits: [] }],
        npcActions: [{ name, cost: "one-action", text, familyText }]
      }
    });
    const entry = collectNpcActions(npc.flags["sf2e-tactical-starship-combat"].starship, {
      actions: content.actions.values(),
      get: (id) => content.actions.get(id)
    }).find((e) => e.id === id);
    assert.ok(entry?.action);
    const description = npcActionDescription(entry.action);
    assert.ok(description.includes(text));
    assert.ok(description.includes(familyText));
    game.packs = new Map([
      [
        "sf2e-tactical-starship-combat.starship-actions",
        {
          getIndex: async () => [{ _id: "generic", flags: { "sf2e-tactical-starship-combat": { packAction: { actionId: id } } } }],
          folders: new Map(),
          getDocument: async () => ({
            sheet: {
              render() {
                assert.fail("generic Item discards aliased NPC rules");
              }
            }
          })
        }
      ]
    ]);
    let opened;
    CONFIG.Item = {
      documentClass: class {
        constructor(data) {
          this.sheet = {
            render(force, options) {
              opened = data;
              assert.equal(options.editable, false);
            }
          };
        }
      }
    };
    const prepared = npcRow(entry.action, entry.station, npc).html;
    const { showActionDescription } = await import("../../scripts/ui/action-controls.mjs");
    await showActionDescription.call(
      { document: npc },
      { preventDefault() {}, stopPropagation() {} },
      {
        dataset: { actionId: id },
        textContent: name,
        closest: () => ({ querySelector: () => ({ innerHTML: prepared }) })
      }
    );
    assert.equal(opened.system.description.value, prepared);
    assert.equal(globalThis.__writes.length, 0);
  });
}

test("NPC station description uses the real optional operator's contextual DC", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const crew = makeCharacter({ id: "operator", name: "Operator" });
  crew.skills = { computers: { dc: { value: 25 }, mod: 15 } };
  const station = { id: "scanner", type: "scanners", helmedBy: crew.uuid };
  const npc = makeShip({ role: "npc", stations: [station], extra: { skills: { computers: 8 } } });
  const row = npcRow({ id: "inline:target-lock", name: "Target Lock", cost: 1, text: "Will save against your Computers DC" }, station, npc);
  assert.match(row.html, /will\|dc:25/);
});

test("NPC family ability with ambiguous saves does not invent a check", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const npc = makeShip({
    role: "npc",
    extra: { npcActions: [{ name: "Ambiguous", cost: 1, text: "DC 19", familyText: "Attempt a Fortitude save or a Will save." }] }
  });
  const row = npcRow(buildNpcAction(npc.flags["sf2e-tactical-starship-combat"].starship, "inline:ambiguous"), null, npc);
  assert.match(row.html, /Fortitude save or a Will save/);
  assert.doesNotMatch(row.html, /@Check\[|data-check=/);
});

for (const role of ["npc", "player"]) {
  test(`${role} contextual save DC uses NPC ship skills only for NPC ships`, async () => {
    installFoundryMock();
    await loadContentFromDisk();
    const ship = makeShip({ role, extra: { skills: { computers: 8, piloting: 7, crafting: 0 } } });
    const values = contextDCs(null, ship);
    if (role === "npc") {
      assert.equal(values.computers, 18);
      assert.equal(values.piloting, 17);
      assert.equal(values.crafting, 10);
      assert.match(linkContextDCs("Will save against your Computers DC", { ship }), /@Check\[will\|dc:18\]/);
    } else {
      assert.equal(values.computers, undefined);
      assert.equal(values.piloting, undefined);
    }
    assert.equal(values.class, null);
    assert.equal(values.spell, null);
  });
}

test("NPC ship statistics do not replace an explicitly supplied operator", async () => {
  installFoundryMock();
  const ship = makeShip({ role: "npc", extra: { skills: { computers: 8 } } });
  const crew = makeCharacter({ id: "operator", name: "Operator" });
  crew.skills = { computers: { dc: { value: 25 }, mod: 15 } };
  assert.equal(contextDCs(crew, ship).computers, 25);
});

test("NPC generic station action resolves its explicitly selected station without crew", async () => {
  const env = installFoundryMock();
  await loadContentFromDisk();
  env.settings.set("ruleEnforcement", "strict");
  const npc = makeShip({
    id: "npc",
    role: "npc",
    stations: [{ id: "scanner", type: "scanners", grade: "commercial" }],
    extra: { compromised: 1, skills: { computers: 8 } }
  });
  const { executeAction } = await import("../../scripts/actions/action-engine.mjs");
  const result = await executeAction({ userId: "gm", shipUuid: npc.uuid, stationId: "scanner", actionId: "jump-start", dryRun: true });
  assert.equal(result.ctx.station.id, "scanner");
  assert.equal(result.ctx.crew, null);
});

test("NPC skill adapter uses stored ship statistics and preserves native system effects", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  class Statistic {
    constructor(actor, data) {
      this.actor = actor;
      this.data = data;
      this.mod = data.modifiers.reduce((sum, m) => sum + m.modifier, 0);
      this.dc = { value: 10 + this.mod };
    }
    clone({ modifiers }) {
      return new Statistic(this.actor, { ...this.data, modifiers: [...this.data.modifiers, ...modifiers] });
    }
  }
  const npc = makeShip({ role: "npc", extra: { skills: { computers: 8 } } });
  npc._source = { system: { skills: { computers: { base: 6 } } } };
  npc.perception = new Statistic(npc, { modifiers: [{ modifier: 6 }] });
  npc.skills = { computers: new Statistic(npc, { modifiers: [{ modifier: 7 }] }) };
  const { crewStatistic } = await import("../../scripts/starship/stats.mjs");
  const stat = crewStatistic(npc, "computers");
  assert.equal(stat.mod, 9);
  assert.equal(stat.dc.value, 19);
  assert.equal(npc.skills.computers.mod, 7);
  assert.equal(contextDCs(null, npc).computers, 19);
});

test("NPC family description preserves basic-save semantics from the real statblock", async () => {
  installFoundryMock();
  const content = await loadContentFromDisk();
  const own = content.ships.flatMap((s) => s.actions ?? []).find((a) => a.name === "Chainsaw Prow");
  assert.ok(own.familyText.includes("basic Fortitude save"));
  const npc = makeShip({ role: "npc", extra: { npcActions: [own] } });
  const row = npcRow(buildNpcAction(npc.flags["sf2e-tactical-starship-combat"].starship, "inline:chainsaw-prow"), null, npc);
  assert.match(row.html, /fortitude\|dc:13\|basic/);
});

test("published Fortify Shields station action uses existing NPC fortify mechanics", async () => {
  installFoundryMock();
  const content = await loadContentFromDisk();
  const source = content.ships.find((s) => s.id === "dread-buccaneer");
  const { buildShipActorData } = await import("../../scripts/content/ship-docs.mjs");
  const npc = await Actor.create(buildShipActorData(source));
  const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
  const generator = ctx.stations.find((s) => s.type === "generator");
  assert.ok(generator.actionList.some((a) => a.id === "fortify-shield-points"));
  assert.ok(!generator.actionList.some((a) => a.id === "inline:fortify-shields"));
  const harpoon = ctx.npcActions.find((a) => a.id === "inline:piercing-harpoon");
  assert.match(harpoon.html, /Hull Breach/);
  assert.match(harpoon.html, /fortitude\|dc:19/);
  game.settings.set("sf2e-tactical-starship-combat", "ruleEnforcement", "strict");
  npc.flags["sf2e-tactical-starship-combat"].starship.stations.find((s) => s.type === "generator").malfunctioning = true;
  const { executeAction } = await import("../../scripts/actions/action-engine.mjs");
  await assert.rejects(
    () => executeAction({ userId: "gm", shipUuid: npc.uuid, actionId: "fortify-shield-points", dryRun: true }),
    /malfunction/i
  );
});
