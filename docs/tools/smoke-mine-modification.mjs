/** Проверка реального шаблона локальным Chromium; это не Foundry. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter } from "../tests/helpers/foundry-mock.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
installFoundryMock({ lang: "ru" });
await loadContentFromDisk();
const { OCCUPANT_PARTIAL } = await import("../scripts/crew/occupant.mjs");
const { STATION_UPGRADES_PARTIAL, SHIP_UPGRADES_PARTIAL, UPGRADE_ITEM_PARTIAL } = await import("../scripts/ui/sheet/sheet-upgrades.mjs");
const { buildSheetContext } = await import("../scripts/ui/sheet/sheet-context.mjs");
const h = Handlebars.create();
h.registerHelper("localize", (k) => game.i18n.localize(k));
h.registerHelper("eq", (a, b) => a === b);
for (const [k, v] of Object.entries({
  tscOccupant: OCCUPANT_PARTIAL,
  tscStationUpgrades: STATION_UPGRADES_PARTIAL,
  tscShipUpgrades: SHIP_UPGRADES_PARTIAL,
  tscUpgradeItem: UPGRADE_ITEM_PARTIAL
}))
  h.registerPartial(k, v);
for (const file of fs.readdirSync(`${root}/templates`).filter((f) => f.endsWith(".hbs")))
  h.registerPartial(`modules/sf2e-tactical-starship-combat/templates/${file}`, fs.readFileSync(`${root}/templates/${file}`, "utf8"));
const operator = makeCharacter({ id: "pilot", name: "Pilot", owners: ["p1"] });
const ship = makeShip({
  id: "ship",
  name: "Ship",
  owners: ["p1"],
  stations: [{ id: "s1", type: "drone-console", grade: "commercial", helmedBy: operator.uuid }],
  crew: [{ actorUuid: operator.uuid, role: "crew", stationId: "s1" }],
  extra: {
    upgrades: [{ id: "shell", ref: "mine-deployment-shell", stationId: "s1" }],
    drones: [
      {
        id: "aboard",
        stationId: "s1",
        tscVersion: 1,
        ref: "pyrotechnics-drone",
        deployed: false,
        tscInstallMinePlan: { entries: [{ mine: "A", mod: "Smart Mine" }] }
      },
      {
        id: "d1",
        stationId: "s1",
        tscVersion: 1,
        ref: "pyrotechnics-drone",
        deployed: true,
        mines: [
          {
            id: "m1",
            droneId: "d1",
            shipUuid: "Actor.ship",
            operatorUuid: operator.uuid,
            zone: 3,
            state: "armed",
            tscMineModification: { type: "smart" }
          }
        ]
      }
    ]
  }
});
for (const role of ["gm", "p1"]) {
  game.user = game.users.get(role);
  const ctx = await buildSheetContext({
    document: ship,
    isNpc: false,
    tab: "stations",
    tabs: ["overview", "stations", "equipment", "notes", "config"]
  });
  const content = h.compile(fs.readFileSync(`${root}/templates/starship-sheet.hbs`, "utf8"))(ctx);
  const html = `<!doctype html><meta charset="utf-8"><main id="app">${content}</main><pre id="result">waiting</pre><script>
  const app=document.querySelector('#app'); const btn=app.querySelector('[data-action="modifyDroneMine"]'); const install=app.querySelector('[data-action="installMinePlan"]');
  const checks=[{name:'gm-only-control',pass:${role === "gm"} ? !!btn : !btn}, {name:'mine-context',pass:${role === "gm"} ? btn?.dataset.mineId==='m1' && btn.dataset.droneId==='d1' && btn.dataset.stationId==='s1' && btn.dataset.zone==='3' : true}, {name:'install-gm-only',pass:${role === "gm"} ? !!install && install.dataset.droneId==='aboard' : !install}, {name:'install-plan-visibility',pass:${role === "gm"} ? app.textContent.includes('Smart Mine') : !app.textContent.includes('Smart Mine')}, {name:'recorded-label',pass:${role === "gm"} ? app.textContent.includes('Умная мина') && app.textContent.includes('перед применением проверьте срок') : true}];
  document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});</script>`;
  fs.writeFileSync(`${out}/${role}.html`, html.replaceAll('src="modules/sf2e-tactical-starship-combat/', `src="${rootUrl}/`));
}
console.log("Wrote 2 mine modification fixtures to " + out);
