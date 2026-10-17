/** Local DOM smoke fixture; not a substitute for a live Foundry v14 test. */
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "ui-smoke");
fs.mkdirSync(out, { recursive: true });
const lang = JSON.parse(fs.readFileSync(`${root}/lang/ru.json`, "utf8"));
const h = Handlebars.create();
h.registerHelper("localize", (key) => key.split(".").reduce((o, k) => o?.[k], lang) ?? key);
const svg = (name, body) => {
  fs.writeFileSync(`${out}/${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${body}</svg>`);
  return `${name}.svg`;
};
const ship = svg(
  "ship",
  '<path fill="#44b8f5" stroke="#e9f9ff" stroke-width="3" d="M64 8 95 100 64 85 33 100Z"/><path fill="#ffa05b" d="M55 91 64 121 73 91Z"/>'
);
const planet = svg(
  "planet",
  '<circle cx="64" cy="64" r="43" fill="#9671cf"/><ellipse cx="64" cy="64" rx="62" ry="18" fill="none" stroke="#f3cc7d" stroke-width="8" transform="rotate(-22 64 64)"/>'
);
const nebula = svg(
  "nebula",
  '<defs><radialGradient id="g"><stop stop-color="#3298d0"/><stop offset="1" stop-color="#112345"/></radialGradient></defs><path fill="url(#g)" d="M0 0h128v128H0z"/><g fill="#fff"><circle cx="24" cy="22" r="1"/><circle cx="78" cy="41" r="1"/><circle cx="100" cy="90" r="1"/></g>'
);
const zones = Array.from({ length: 12 }, (_, i) => ({ zone: i + 1, label: String(i + 1).padStart(2, "0"), cover: i === 4, objects: [] }));
zones[1].objects.push({
  key: "ship",
  label: "Корабль игроков",
  icon: "🚀",
  art: ship,
  status: "operational",
  statusLabel: "В строю",
  type: "starship",
  arrow: "→",
  hp: "75/100",
  sp: "20/30",
  hpPct: 75,
  spPct: 67,
  selected: true
});
zones[3].objects.push({ key: "planet", label: "Дальняя планета", icon: "◐", art: planet, status: "operational", type: "planet" });
zones[5].objects.push({ key: "unknown", label: "Контакт α", icon: "○", status: "operational", type: "contact" });
zones[6].objects.push({
  key: "failed",
  label: "Недоступный арт",
  icon: "⚠",
  art: "file:///missing-test-image.png",
  status: "operational",
  type: "hazard"
});
const context = {
  isGM: true,
  zoneCount: 12,
  zones,
  combat: { round: 2, turn: "Пилот" },
  detail: {
    key: "ship",
    label: "Корабль игроков",
    canMove: true,
    rows: [
      { k: "КД", v: 23 },
      { k: "Очки корпуса", v: "75/100" }
    ]
  },
  log: ["Карта сенсоров готова"]
};
const render = (name, ctx = context) => h.compile(fs.readFileSync(`${root}/templates/${name}.hbs`, "utf8"))(ctx);
for (const theme of ["dark", "light"]) {
  const body = ["bar", "zones", "detail"].map((name) => render(`sensor-map-${name}`)).join("\n");
  const appearance = { theme, background: nebula, artSize: 64, opacity: 0.65, blur: 2, fade: 0.25 };
  const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${rootUrl}/styles/main.css"><style>body{margin:0;padding:24px;font:14px Arial;background:#777}.application{height:520px;width:1120px}.window-content{height:100%;box-sizing:border-box}.tsc-zone-objects button{width:100%}#result{position:fixed;bottom:4px;font:12px monospace;color:white;background:#222;padding:4px}</style><main id="app" class="sf2e-tsc tsc-sensor-map application"><section class="window-content">${body}</section></main><pre id="result">waiting</pre><script type="module">
import {paintMapAppearance} from '${rootUrl}/scripts/ui/map-appearance-render.mjs';
const app=document.querySelector('#app');const context={appearance:${JSON.stringify(appearance)}};paintMapAppearance(app,context);
const checks=[];const check=(name,value)=>checks.push({name,pass:!!value});
await new Promise(r=>setTimeout(r,250));
check('theme',app.dataset.mapTheme==='${theme}');check('background',getComputedStyle(app.querySelector('.tsc-map-background')).backgroundImage!=='none');
check('art-size',getComputedStyle(app.querySelector('.tsc-object-art')).width==='64px'); document.body.dataset.artWidth=getComputedStyle(app.querySelector('.tsc-object-art')).width;
const failed=app.querySelector('[data-object-key="failed"] img');check('broken-image-fallback',failed.hidden&&!failed.nextElementSibling.hidden);
check('images-not-blurred',getComputedStyle(app.querySelector('.tsc-object-art')).filter==='none');
check('background-filter',getComputedStyle(app.querySelector('.tsc-map-background')).filter.includes('blur(2px)'));
const zoneRoot=app.querySelector('.tsc-zones');check('scrolls',zoneRoot.scrollWidth>zoneRoot.clientWidth);zoneRoot.scrollLeft=100;check('scroll-position',zoneRoot.scrollLeft>0);
const old=app.querySelector('.tsc-map-viewport');old.replaceWith(old.cloneNode(true));paintMapAppearance(app,context);check('partial-render-background',getComputedStyle(app.querySelector('.tsc-map-background')).backgroundImage!=='none');
const before=getComputedStyle(app).getPropertyValue('--tsc-text');paintMapAppearance(app,{appearance:{theme:'${theme}',textColor:'#123456'}});check('custom-color',getComputedStyle(app).getPropertyValue('--tsc-text')==='#123456');check('clear-background',getComputedStyle(app.querySelector('.tsc-map-background')).backgroundImage==='none');
paintMapAppearance(app,context);check('theme-color-reset',getComputedStyle(app).getPropertyValue('--tsc-text')===before);
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(x=>x.pass)});
</script>`;
  fs.writeFileSync(`${out}/map-${theme}.html`, html);
  const form = render("map-appearance", {
    a: appearance,
    themes: [{ id: theme, label: theme, selected: true }],
    modes: [{ id: "art", label: "Арты", selected: true }],
    textColor: "#d8e4f5",
    mutedColor: "#8aa0c0",
    accentColor: "#38bdf8"
  });
  fs.writeFileSync(
    `${out}/form-${theme}.html`,
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${rootUrl}/styles/main.css"><style>body{background:#777;font:14px Arial}.application{width:500px;margin:20px auto}fieldset{border:1px solid #405574}</style><form class="application sf2e-tsc tsc-map-appearance"><div class="window-content">${form}</div></form>`
  );
}
console.log(`Wrote DOM smoke fixtures to ${out}`);
