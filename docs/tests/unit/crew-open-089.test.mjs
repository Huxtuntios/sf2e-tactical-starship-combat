import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const r = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("0.8.9: dead +1/-1 spend buttons are gone", () => {
  for (const f of ["templates/crew-panel.hbs", "templates/crew-ship.hbs"]) assert.ok(!r(f).includes('data-action="spend"'), f);
});
test("0.8.9: crew panel and sheet Crew tab share one card partial", () => {
  assert.match(r("templates/crew-panel.hbs"), /templates\/crew-ship\.hbs/);
  assert.match(r("templates/starship-sheet.hbs"), /templates\/crew-ship\.hbs" crewShip/);
  assert.match(r("scripts/main.mjs"), /"crew-ship"/);
  assert.match(r("scripts/ui/sheet/sheet-context.mjs"), /crewShip: sheet\.isNpc \? null : crewShipView/);
});
test("0.8.9: stations and crew tabs can (re)open Station Actions and Crew Manager", () => {
  const sh = r("templates/starship-sheet.hbs");
  const st = sh.slice(sh.indexOf('(eq tab "stations")'));
  assert.match(st.slice(0, 900), /data-action="openStationHud"/);
  assert.match(st.slice(0, 900), /data-action="openCrewManager"/);
  const js = r("scripts/ui/starship-sheet.mjs");
  for (const k of ["openStationHud:", "openCrewManager:", "ready:", "remove:", "wireCrewSelects("]) assert.ok(js.includes(k), k);
  assert.match(r("scripts/ui/launchers.mjs"), /openApps\(CrewManager\)/);
});
test("0.8.9: crew manager handlers cover every action in the card", () => {
  const card = r("templates/crew-ship.hbs");
  const cm = r("scripts/ui/crew-manager.mjs");
  for (const a of new Set([...card.matchAll(/data-action="([a-zA-Z]+)"/g)].map((m) => m[1])))
    assert.match(cm, new RegExp(`\\b${a}: guard`), a);
});
