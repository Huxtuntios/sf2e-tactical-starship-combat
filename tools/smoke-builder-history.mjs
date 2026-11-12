/** Production builder/history templates in Chromium with mocked settings, not live Foundry. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Handlebars from "handlebars";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "theme-fixtures");
fs.mkdirSync(out, { recursive: true });
const lang = JSON.parse(fs.readFileSync(`${root}/lang/ru.json`, "utf8"));
const h = Handlebars.create();
h.registerHelper("localize", (key) => key.split(".").reduce((o, k) => o?.[k], lang) ?? key);
const contexts = {
  builder: {
    d: { name: "Рассветная дева", level: 1 },
    sizes: ["tiny", "small", "medium", "large", "huge", "gargantuan"].map((id) => ({ id, sel: id === "medium" })),
    frames: [{ id: "explorer", name: "Исследователь", sel: true }],
    stats: { hp: 24, sp: 11, ac: 15, fort: 8, ref: 6, will: 9, speed: 3, sensor: 6 },
    stations: [
      { id: "pilot", name: "Пульт пилота", checked: true },
      { id: "generator", name: "Генератор", checked: true }
    ],
    weapons: [{ id: "laser", name: "Лазер" }],
    characters: [{ uuid: "Actor__DOT__a", name: "Сариф" }]
  },
  history: {
    entries: Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      shipName: "Рассветная дева",
      shipUuid: "Actor.ship",
      time: "08.11.2026, 14:30",
      summary: "Корпус: 100 → 80; щиты: 30 → 10",
      reason: "Изменение после столкновения",
      fieldsText: "Корпус, щиты",
      effects: [],
      stations: []
    }))
  }
};
for (const kind of ["builder", "history"])
  for (const theme of ["light", "dark"]) {
    const template = kind === "builder" ? "starship-builder" : "history";
    const body = h.compile(fs.readFileSync(`${root}/templates/${template}.hbs`, "utf8"))(contexts[kind]);
    fs.writeFileSync(
      `${out}/${kind}-${theme}.html`,
      `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${rootUrl}/styles/main.css"><style>body{background:#888;font:14px Arial;margin:0;padding:15px}.application{width:780px;height:840px}.window-header{padding:8px}.window-content{height:calc(100% - 38px);box-sizing:border-box}#result{background:#222;color:white}</style><main class="application sf2e-tsc tsc-${kind}" id="app"><header class="window-header">${kind === "builder" ? "Конструктор кораблей" : "История изменений"}</header><div class="window-content">${body}</div></main><pre id="result">waiting</pre><script type="module">
globalThis.game={settings:{get:(m,k)=>m==='core'?{colorScheme:{applications:'${theme}'}}:'foundry'}};
const {paintSheetTheme}=await import('${rootUrl}/scripts/ui/sheet/sheet-theme.mjs');const app=document.querySelector('#app');paintSheetTheme(app);
const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
const text='${theme}'==='light'?'rgb(23, 43, 69)':'rgb(227, 236, 250)';const bg='${theme}'==='light'?'rgb(255, 255, 255)':'rgb(11, 17, 27)';
check('follow-foundry',app.dataset.sheetTheme==='${theme}');
check('header',getComputedStyle(app.querySelector('.window-header')).color===text);
for(const el of app.querySelectorAll('select, input:not([type=checkbox]), textarea')){ check('field-text',getComputedStyle(el).color===text);check('field-bg',getComputedStyle(el).backgroundColor===bg); }
for(const el of app.querySelectorAll('option')){check('option-text',getComputedStyle(el).color===text);check('option-bg',getComputedStyle(el).backgroundColor===bg)}
const input=app.querySelector('input');if(input) input.value='Черновик';paintSheetTheme(app,'${theme === "light" ? "dark" : "light"}');check('live-switch',app.dataset.sheetTheme==='${theme === "light" ? "dark" : "light"}');check('draft',!input||input.value==='Черновик');paintSheetTheme(app,'${theme}');
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`
    );
  }
console.log(`Wrote builder/history fixtures to ${out}`);
