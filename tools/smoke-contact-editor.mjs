import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Handlebars from "handlebars";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = path.resolve(process.argv[2] ?? path.join(root, "dist", "ui-tests", "contact-editor"));
fs.mkdirSync(out, { recursive: true });
const h = Handlebars.create();
h.registerHelper("localize", (key) => key);
const template = fs.readFileSync(path.join(root, "templates", "sensor-contact-editor.hbs"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles", "main.css"), "utf8");
const base = {
  sources: [
    { id: "world", label: "World Actor", checked: true },
    { id: "compendium", label: "Compendium Actor", checked: false },
    { id: "custom", label: "Custom", checked: false }
  ],
  isCustom: false,
  isCompendium: false,
  loading: false,
  filter: "",
  choices: [{ uuid: "Actor.raider", kindLabel: "Starship", roleLabel: "NPC", name: "Raider", selected: true }],
  zones: [{ id: 2, selected: true }],
  detections: [
    { id: "undetected", label: "Undetected" },
    { id: "hidden", label: "Hidden" },
    { id: "observed", label: "Observed" },
    { id: "identified", label: "Identified", selected: true }
  ]
};
const world = h.compile(template)(base);
const compendium = h.compile(template)({
  ...base,
  sources: base.sources.map((source) => ({ ...source, checked: source.id === "compendium" })),
  isCompendium: true,
  choices: [
    {
      uuid: "Compendium.world.starships.Actor.tug",
      kindLabel: "Starship",
      roleLabel: "NPC",
      name: "Cargo Tug",
      pack: "Starship Pack",
      selected: true
    }
  ]
});
const largeWorld = h.compile(template)({
  ...base,
  choices: Array.from({ length: 520 }, (_, i) => ({
    uuid: `Actor.large-${i}`,
    kindLabel: "Hazard",
    name: `Large collection actor ${String(i).padStart(3, "0")}`,
    selected: i === 519
  }))
});
const checks = [
  { name: "world-starship-option", pass: world.includes("Starship · NPC — Raider") },
  { name: "compendium-starship-option", pass: compendium.includes("Starship · NPC — Cargo Tug — Starship Pack") },
  { name: "resizable-actor-list-markup", pass: largeWorld.includes('class="tsc-contact-editor-actor-list"') },
  { name: "compendium-copy-note", pass: compendium.includes("SF2eTSC.contactEditor.copyNote") },
  { name: "confirmation-controls-removed", pass: !world.includes('name="confirmed"') && !world.includes("contactEditor.detectionHint") }
];
const fixture = `<!doctype html><meta charset="utf-8"><style>${styles}
#large-window{display:flex;flex-direction:column;width:500px;height:560px}
#large-window>.window-content{height:100%;min-height:0;box-sizing:border-box}
</style><main id="world">${world}</main><main id="compendium">${compendium}</main>
<div id="large-window" class="sf2e-tsc tsc-contact-editor-window"><div class="window-content">${largeWorld}</div></div><pre id="result">waiting</pre>
<script type="module">
import {fitContactEditorActorList, readManualContactEditorActorListHeight} from '${rootUrl}/scripts/sensor/contact-editor-layout.mjs';
const checks=${JSON.stringify(checks)};
const largeWorldMarkup=${JSON.stringify(largeWorld)}, compendiumMarkup=${JSON.stringify(compendium)};
const world=document.querySelector('#world'), compendium=document.querySelector('#compendium');
checks.push({name:'source-choices',pass:world.querySelectorAll('input[name="source"]').length===3});
checks.push({name:'starship-actor-select',pass:world.querySelector('select[name="uuid"] option')?.value==='Actor.raider'});
checks.push({name:'compendium-source-select',pass:compendium.querySelector('select[name="uuid"] option')?.value==='Compendium.world.starships.Actor.tug'});
checks.push({name:'all-detection-states',pass:['undetected','hidden','observed','identified'].every(level=>world.querySelector('select[name="detection"] option[value="'+level+'"]'))});
checks.push({name:'no-confirmation-checkbox',pass:world.querySelector('input[name="confirmed"]')===null});
const app=document.querySelector('#large-window');
let list=app.querySelector('.tsc-contact-editor-actor-list');
const actorSelect=app.querySelector('select[name="uuid"]'), search=app.querySelector('input[name="filter"]');
const content=app.querySelector('.window-content');
let preferredHeight=null;
const fit=()=>fitContactEditorActorList(app,preferredHeight);
const observer=new ResizeObserver(fit);
observer.observe(content);
let picker=app.querySelector('.tsc-contact-editor-actor-picker');
observer.observe(picker);
fit();
const initialHeight=list.clientHeight;
const selectedUuid='Actor.large-519';
const hasLargeResult=actorSelect.options.length===520&&actorSelect.options[519].value===selectedUuid;
actorSelect.value=selectedUuid; search.value='Large collection actor 519';
const resizable=getComputedStyle(list).resize==='vertical';
const controlsClear=()=>{
  const activeList=app.querySelector('.tsc-contact-editor-actor-list');
  const controls=[
    ...Array.from(app.querySelectorAll('label')).filter(label=>label.querySelector('[name="zone"], [name="detection"]')),
    app.querySelector('.tsc-contact-editor footer')
  ];
  return controls.every(control=>activeList.getBoundingClientRect().bottom<=control.getBoundingClientRect().top+1);
};
const overgrown=fitContactEditorActorList(app,initialHeight+100);
const clampedWithoutOverlap=overgrown.height===overgrown.availableHeight&&controlsClear();
app.style.height='760px';
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const windowGrowth=list.clientHeight>initialHeight;
preferredHeight=list.clientHeight-1;
fit();
const worldAvailable=fitContactEditorActorList(app,null).availableHeight;
fit();
const manualStartHeight=list.clientHeight;
list.style.height=(manualStartHeight-1)+'px';
preferredHeight=readManualContactEditorActorListHeight(app,manualStartHeight);
fit();
const preferredApplied=preferredHeight===manualStartHeight-1&&list.clientHeight===preferredHeight;
const worldMarkup=app.querySelector('.tsc-contact-editor').outerHTML;
const replaceEditor=markup=>{
  if(picker) observer.unobserve(picker);
  content.innerHTML=markup;
  list=app.querySelector('.tsc-contact-editor-actor-list');
  picker=app.querySelector('.tsc-contact-editor-actor-picker');
  observer.observe(picker);
  fit();
};
replaceEditor(compendiumMarkup);
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const compendiumAvailable=fitContactEditorActorList(app,preferredHeight).availableHeight;
fit();
const noteShrinksList=!!app.querySelector('.tsc-contact-editor .tsc-hint')&&compendiumAvailable<worldAvailable&&list.clientHeight===compendiumAvailable;
replaceEditor(worldMarkup);
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const preferenceRestored=list.clientHeight===preferredHeight;
checks.push({name:'actor-after-400-is-rendered-and-selectable',pass:hasLargeResult&&actorSelect.value===selectedUuid});
checks.push({name:'list-pane-is-vertically-resizable',pass:resizable&&clampedWithoutOverlap});
checks.push({name:'list-grows-with-window-and-keeps-search-selection',pass:windowGrowth&&search.value==='Large collection actor 519'&&actorSelect.value===selectedUuid});
checks.push({name:'copy-note-clamps-list-and-restores-manual-preference',pass:preferredApplied&&noteShrinksList&&preferenceRestored&&controlsClear()});
observer.disconnect();
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`;
fs.writeFileSync(path.join(out, "contact-editor.html"), fixture);
