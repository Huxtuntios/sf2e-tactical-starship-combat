/** Render actual sheet templates with offline Foundry mocks. This is not a live Foundry test. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../tests/helpers/foundry-mock.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "sheet-smoke");
fs.mkdirSync(out, { recursive: true });
const { settings } = installFoundryMock({ lang: "ru" });
await loadContentFromDisk();
const { paintSheetTheme } = await import("../scripts/ui/sheet/sheet-theme.mjs");
const { OCCUPANT_PARTIAL } = await import("../scripts/crew/occupant.mjs");
const { STATION_UPGRADES_PARTIAL, SHIP_UPGRADES_PARTIAL, UPGRADE_ITEM_PARTIAL } = await import("../scripts/ui/sheet/sheet-upgrades.mjs");
const { buildSheetContext } = await import("../scripts/ui/sheet/sheet-context.mjs");
const h = Handlebars.create();
h.registerHelper("localize", (k) => game.i18n.localize(k));
h.registerHelper("eq", (a, b) => a === b);
for (const [key, value] of Object.entries({
  tscOccupant: OCCUPANT_PARTIAL,
  tscStationUpgrades: STATION_UPGRADES_PARTIAL,
  tscShipUpgrades: SHIP_UPGRADES_PARTIAL,
  tscUpgradeItem: UPGRADE_ITEM_PARTIAL
}))
  h.registerPartial(key, value);
for (const file of fs.readdirSync(`${root}/templates`).filter((f) => f.endsWith(".hbs")))
  h.registerPartial(`modules/sf2e-tactical-starship-combat/templates/${file}`, fs.readFileSync(`${root}/templates/${file}`, "utf8"));
const render = (name, ctx) => h.compile(fs.readFileSync(`${root}/templates/${name}.hbs`, "utf8"))(ctx);
for (const role of ["player", "npc"])
  for (const theme of ["dark", "light"])
    for (const tab of ["overview", "stations", "equipment", "notes", "config"]) {
      settings.set("starshipSheetTheme", theme);
      const actor = makeShip({
        id: "demo",
        name: role === "player" ? "Звездолёт игроков" : "Звездолёт НИП",
        role,
        hp: 100,
        sp: 30,
        stations: [
          { id: "pilot", name: "Пульт пилота", type: "pilot", grade: "tactical", malfunctioning: true },
          { id: "gunnery", name: "Орудийная станция", type: "gunnery", grade: "tactical" }
        ],
        extra: { notes: "Заметки корабля — не меняются при выборе темы." }
      });
      actor.img = `${rootUrl}/assets/icons/starship.svg`;
      const sheet = { document: actor, isNpc: role === "npc", tab, tabs: ["overview", "stations", "equipment", "notes", "config"] };
      const ctx = await buildSheetContext(sheet);
      ctx.warnings = ["Тестовое предупреждение о неисправности"];
      const content = ["starship-sheet-header", "starship-sheet-tabs", "starship-sheet"].map((name) => render(name, ctx)).join("\n");
      const html = `<!doctype html><meta charset="utf-8"><style>h2{color:#fff}thead{background:#302932;color:#fff}</style><link rel="stylesheet" href="${rootUrl}/styles/main.css"><style>body{font:14px Arial;margin:0;padding:20px;background:#777}.application{width:780px;height:740px}.window-content{height:calc(100% - 30px);box-sizing:border-box;overflow:auto}.window-header{padding:8px}.tsc-sheet-head{margin-bottom:8px}#result{font:10px monospace;color:white;background:#111;padding:4px;max-width:1000px}</style><main id="app" class="sf2e-tsc tsc-sheet application"><header class="window-header">${role} — ${tab}</header><section class="window-content">${content}</section></main><aside id="map" class="sf2e-tsc tsc-sensor-map" style="--tsc-bg:#112233"></aside><pre id="result">waiting</pre><script type="module">
import {wireSheetTheme,paintSheetTheme} from '${rootUrl}/scripts/ui/sheet/sheet-theme.mjs';
let saved='${theme}',writes=0;globalThis.game={settings:{get:()=>saved,set:async(module,key,value)=>{if(key!=='starshipSheetTheme')throw new Error('wrong setting');saved=value;writes++;}},i18n:{localize:(k)=>k,format:(k)=>k}};
const app=document.querySelector('#app');const sheet={element:app,tab:'${tab}'};wireSheetTheme(sheet);const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
check('removed-ship-controls',!app.querySelector('[data-qol-toolbar],[data-qol-compact],[data-qol-search]'));
check('ship-title-contrast',getComputedStyle(app.querySelector('.tsc-sheet-head h2')).color===getComputedStyle(app).getPropertyValue('--tsc-text').trim().replace('#172b45','rgb(23, 43, 69)').replace('#e3ecfa','rgb(227, 236, 250)'));
if('${tab}'==='overview'){const cells=[...app.querySelectorAll('.tsc-stat-grid > div,.tsc-stat-grid > button')];check('centered-stats',cells.length>0&&cells.every(c=>getComputedStyle(c).textAlign==='center'&&getComputedStyle(c).alignItems==='center'));}
if('${tab}'==='config'){const th=app.querySelector('th');check('table-header-contrast',!!th&&getComputedStyle(th).backgroundColor==='${theme === "light" ? "rgb(255, 255, 255)" : "rgb(22, 33, 51)"}'&&getComputedStyle(th).color==='${theme === "light" ? "rgb(23, 43, 69)" : "rgb(227, 236, 250)"}');}
check('theme',app.dataset.sheetTheme==='${theme}');check('selector',app.querySelector('[data-sheet-theme-select]').value==='${theme}');
check('theme-text',getComputedStyle(app).getPropertyValue('--tsc-text').trim()==='${theme === "light" ? "#172b45" : "#e3ecfa"}');
const input=app.querySelector('input:not([type=checkbox]),textarea,select');check('input-background',getComputedStyle(input).backgroundColor==='${theme === "light" ? "rgb(238, 243, 249)" : "rgb(11, 17, 27)"}');
const note=app.querySelector('textarea[name=notes]');if(note)note.value='Unsaved draft';
const pick=app.querySelector('[data-sheet-theme-select]');pick.value='${theme === "light" ? "dark" : "light"}';pick.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,10));
check('immediate-switch',app.dataset.sheetTheme===saved&&saved!=='${theme}'&&writes===1);check('tab-preserved',sheet.tab==='${tab}');check('draft-preserved',!note||note.value==='Unsaved draft');
check('map-untouched',getComputedStyle(document.querySelector('#map')).getPropertyValue('--tsc-bg').trim()==='#112233');
saved='${theme}';paintSheetTheme(app);const old=app.querySelector('.tsc-sheet-head');old.replaceWith(old.cloneNode(true));wireSheetTheme(sheet);check('partial-header',app.querySelector('[data-sheet-theme-select]').value==='${theme}');
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`;
      fs.writeFileSync(
        `${out}/${role}-${theme}-${tab}.html`,
        html.replaceAll('src="modules/sf2e-tactical-starship-combat/', `src="${rootUrl}/`)
      );
    }
// Ensure the imported renderer remains part of the checked tool import graph.
if (typeof paintSheetTheme !== "function") throw new Error("Missing renderer");
console.log(`Wrote 20 sheet fixtures to ${out}`);
