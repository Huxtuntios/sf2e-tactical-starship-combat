/** Real HUD/Crew templates, parsed by local Chromium. Not a live Foundry test. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Handlebars from "handlebars";
import { installFoundryMock } from "../tests/helpers/foundry-mock.mjs";
import { OCCUPANT_PARTIAL } from "../scripts/crew/occupant.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "window-smoke");
fs.mkdirSync(out, { recursive: true });
installFoundryMock({ lang: "ru" });
const h = Handlebars.create();
h.registerHelper("localize", (k) => game.i18n.localize(k));
h.registerHelper("eq", (a, b) => a === b);
h.registerPartial("tscOccupant", OCCUPANT_PARTIAL);
h.registerPartial(
  "modules/sf2e-tactical-starship-combat/templates/crew-ship.hbs",
  fs.readFileSync(`${root}/templates/crew-ship.hbs`, "utf8")
);
const occupant = { name: "Оператор", img: "", missing: false, empty: false };
for (const kind of ["hud", "crew"])
  for (const theme of ["dark", "light"])
    for (const populated of [false, true]) {
      const themes = ["dark", "light"].map((id) => ({ id, label: id === "light" ? "Светлая" : "Тёмная", selected: id === theme }));
      const context =
        kind === "hud"
          ? {
              none: !populated,
              sheetThemes: themes,
              station: "Пульт пилота",
              ship: "Корабль",
              crew: "Оператор",
              occupant,
              hp: { value: 100, max: 100 },
              sp: { value: 20, max: 30 },
              hpPct: 100,
              spPct: 66,
              malfunctioning: true,
              actions: [
                { id: "boost-thrusters", name: "Форсаж двигателей", icon: "◆", enabled: true, text: "Описание", desc: "Действие станции" }
              ],
              dcRows: [{ label: "Пилотирование", value: 25 }]
            }
          : {
              empty: !populated,
              isGM: true,
              sheetThemes: themes,
              ships: populated
                ? [
                    {
                      name: "Звездолёт игроков",
                      uuid: "Actor.ship",
                      canAssign: true,
                      posts: [{ id: "p", name: "Пилот", occupant, malf: true }],
                      rows: [
                        {
                          actorUuid: "Actor.crew",
                          occupant,
                          player: "Игрок",
                          role: "Экипаж",
                          canChange: true,
                          mine: true,
                          stations: [{ id: "p", name: "Пилот", mine: true, occupied: false }],
                          stationId: "p",
                          ready: true
                        }
                      ],
                      free: [{ id: "g", name: "Орудийная станция" }]
                    }
                  ]
                : []
            };
      const template = kind === "hud" ? "station-hud" : "crew-panel";
      const html = h.compile(fs.readFileSync(`${root}/templates/${template}.hbs`, "utf8"))(context);
      const classes = kind === "hud" ? "tsc-hud" : "tsc-crew-manager";
      fs.writeFileSync(
        `${out}/${kind}-${theme}-${populated ? "populated" : "empty"}.html`,
        `<!doctype html><meta charset="utf-8">
<style>body{font:14px Arial;background:#777}h3{color:white}thead,th{background:#332c35;color:black}.application{width:760px;margin:20px}.window-header{padding:8px}#result{white-space:pre-wrap;background:#111;color:white}</style>
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<main id="app" class="application sf2e-tsc ${classes}"><header class="window-header">${kind === "hud" ? "Действия станций" : "Менеджер экипажа"}</header><div class="window-content">${html}</div></main>
<template id="part">${html}</template><pre id="result">waiting</pre>
<script type="module">
let saved='${theme}';const writes=[];globalThis.game={settings:{get:()=>saved,set:async(m,k,v)=>{writes.push([m,k,v]);saved=v}},i18n:{localize:k=>k}};
const {wireSheetTheme}=await import('${rootUrl}/scripts/ui/sheet/sheet-theme.mjs');
const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});const app=document.querySelector('#app');
const nodes=[...document.querySelector('#part').content.childNodes].filter(n=>n.nodeType===1||(n.nodeType===3&&n.textContent.trim()));
check('ApplicationV2-single-root',nodes.length===1&&nodes[0].nodeType===1);check('picker-inside-root',nodes[0].querySelectorAll('[data-sheet-theme-select]').length===1);
wireSheetTheme({element:app});wireSheetTheme({element:app});check('initial-theme',app.dataset.sheetTheme==='${theme}');
const light='rgb(23, 43, 69)',dark='rgb(227, 236, 250)';const expected='${theme}'==='light'?light:dark;
check('window-header-contrast',getComputedStyle(app.querySelector('.window-header')).color===expected);
const th=app.querySelector('th');check('table-header-contrast',!th||getComputedStyle(th).color===expected);
const draft=document.createElement('input');draft.value='Несохранённый выбор';app.querySelector('.window-content').append(draft);
const original=app.querySelector('[data-action]');const pick=app.querySelector('[data-sheet-theme-select]');pick.value='${theme}'==='light'?'dark':'light';pick.dispatchEvent(new Event('change'));
await new Promise(r=>setTimeout(r,20));check('immediate-theme-switch',app.dataset.sheetTheme===pick.value&&pick.value!=='${theme}');
check('one-client-setting-write',writes.length===1&&writes[0][1]==='starshipSheetTheme');check('no-render-or-draft-loss',draft.value==='Несохранённый выбор'&&(!original||app.contains(original)));
const reopened=app.cloneNode(true);document.body.append(reopened);wireSheetTheme({element:reopened});check('reopened-inherits-client-theme',reopened.dataset.sheetTheme===saved);reopened.remove();
pick.value='${theme}';pick.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,20));
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`
      );
    }
console.log(`Wrote 8 HUD/Crew fixtures to ${out}`);
