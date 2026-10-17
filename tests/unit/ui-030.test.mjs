import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { linkChecks, checkLinksHTML, checkChatContent } from "../../scripts/content/inline-checks.mjs";
import { parseKv, formatKv, parseCsv } from "../../scripts/ui/sheet-edit.mjs";
import { actorFix } from "../../scripts/content/world-maintenance.mjs";
import { buildHazardActorData, buildShipActorData, ICONS } from "../../scripts/content/ship-docs.mjs";

test("saves, basic saves, skills, flat checks become @Check enrichers", () => {
  assert.equal(linkChecks("must attempt a DC 32 Will save."), "must attempt a @Check[will|dc:32]{DC 32 Will save}.");
  assert.equal(linkChecks("(DC 34 basic Reflex save)"), "(@Check[reflex|dc:34|basic]{DC 34 basic Reflex save})");
  assert.equal(
    linkChecks("DC 31 Computers or Crafting check"),
    "@Check[computers|dc:31]{DC 31 Computers} or @Check[crafting|dc:31]{Crafting} check"
  );
  assert.match(linkChecks("DC 38 Occultism (master) or Religion (master)"), /@Check\[religion\|dc:38\]/);
  assert.equal(linkChecks("DC 5 flat check"), "@Check[flat|dc:5]{DC 5 flat check}");
  assert.equal(linkChecks("counteract DC 33)"), "counteract DC 33)");
});
test("linkChecks is idempotent", () => {
  const once = linkChecks("DC 18 Computers");
  assert.equal(linkChecks(once), once);
});
test("module check links are escaped anchors and post enrichers", () => {
  const h = checkLinksHTML("<b> DC 20 Will save");
  assert.match(h, /^&lt;b&gt;/);
  assert.match(h, /class="tsc-check" data-check="will\|dc:20"/);
  assert.equal(checkChatContent("will|dc:20", "DC 20 Will save"), "<p>@Check[will|dc:20]{DC 20 Will save}</p>");
});
test("editor kv/csv parsing", () => {
  assert.deepEqual(parseKv("fire 5, cold 10, physical: 3"), { fire: 5, cold: 10, physical: 3 });
  assert.deepEqual(parseKv("computers +12"), { computers: 12 });
  assert.equal(formatKv({ fire: 5 }), "fire 5");
  assert.deepEqual(parseCsv(" tech, , undead "), ["tech", "undead"]);
});
test("content builders use module icons and clickable checks", () => {
  const h = buildHazardActorData({
    id: "x",
    name: "X",
    level: 1,
    description: "DC 20 Will save",
    disable: "DC 15 Piloting (trained)",
    actions: [],
    strikes: []
  });
  assert.equal(h.img, ICONS.hazard);
  assert.equal(h.prototypeToken.texture.src, ICONS.hazard);
  assert.match(h.system.details.description, /@Check\[will\|dc:20\]/);
  assert.match(h.system.details.disable, /@Check\[piloting\|dc:15\]/);
  const s = buildShipActorData({ id: "y", name: "Y", level: 1, hp: 10, stations: [], strikes: [], actions: [] });
  assert.equal(s.img, ICONS.npc);
});
test("world repair replaces the missing core ship icon and links hazard checks", () => {
  const ship = {
    type: "npc",
    img: "icons/svg/ship.svg",
    prototypeToken: { texture: { src: "icons/svg/ship.svg" } },
    flags: { "sf2e-tactical-starship-combat": { starship: {} } },
    system: {}
  };
  const u = actorFix(ship);
  assert.equal(u.img, ICONS.npc);
  assert.equal(u["prototypeToken.texture.src"], ICONS.npc);
  const hz = {
    type: "hazard",
    img: "custom.webp",
    prototypeToken: { texture: { src: "custom.webp" } },
    flags: { "sf2e-tactical-starship-combat": { starshipHazard: {} } },
    system: { details: { description: "<p>DC 20 Will save</p>" } }
  };
  const v = actorFix(hz);
  assert.equal(v.img, undefined);
  assert.match(v["system.details.description"], /@Check/);
  assert.deepEqual(actorFix({ type: "npc", img: "icons/svg/ship.svg", flags: {} }), {});
});
test("sheet tabs do not use the reserved ApplicationV2 'tab' action and the editor partial exists", () => {
  for (const f of ["starship-sheet"]) {
    const s = [`templates/${f}.hbs`, `templates/${f}-header.hbs`, "templates/starship-sheet-tabs.hbs"]
      .map((x) => fs.readFileSync(x, "utf8"))
      .join("\n");
    assert.ok(!s.includes('data-action="tab"'), f);
    assert.ok(s.includes('data-action="tscTab"'), f);
    assert.ok(s.includes("templates/ship-editor.hbs"), f);
  }
  assert.ok(fs.existsSync("templates/ship-editor.hbs"));
  assert.ok(fs.readFileSync("scripts/main.mjs", "utf8").includes('"ship-editor"'));
});
test("no reference to the non-existent core icon remains in code", () => {
  const code = ["scripts/content/ship-docs.mjs", "scripts/ui/starship-builder.mjs", "scripts/content/importer.mjs"]
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  assert.ok(!/["'`]icons\/svg\/ship\.svg/.test(code.replace(/LEGACY_ICONS = \[[^\]]*\]/, "")));
});
