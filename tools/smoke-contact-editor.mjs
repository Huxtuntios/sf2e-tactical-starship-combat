import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "dist", "ui-tests", "contact-editor"));
fs.mkdirSync(out, { recursive: true });
const h = Handlebars.create();
h.registerHelper("localize", (key) => key);
const template = fs.readFileSync(path.join(root, "templates", "sensor-contact-editor.hbs"), "utf8");
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
const checks = [
  { name: "world-starship-option", pass: world.includes("Starship · NPC — Raider") },
  { name: "compendium-starship-option", pass: compendium.includes("Starship · NPC — Cargo Tug — Starship Pack") },
  { name: "compendium-copy-note", pass: compendium.includes("SF2eTSC.contactEditor.copyNote") },
  { name: "confirmation-controls-removed", pass: !world.includes('name="confirmed"') && !world.includes("contactEditor.detectionHint") }
];
const fixture = `<!doctype html><meta charset="utf-8"><main id="world">${world}</main><main id="compendium">${compendium}</main><pre id="result">waiting</pre>
<script>
const checks=${JSON.stringify(checks)};
const world=document.querySelector('#world'), compendium=document.querySelector('#compendium');
checks.push({name:'source-choices',pass:world.querySelectorAll('input[name="source"]').length===3});
checks.push({name:'starship-actor-select',pass:world.querySelector('select[name="uuid"] option')?.value==='Actor.raider'});
checks.push({name:'compendium-source-select',pass:compendium.querySelector('select[name="uuid"] option')?.value==='Compendium.world.starships.Actor.tug'});
checks.push({name:'all-detection-states',pass:['undetected','hidden','observed','identified'].every(level=>world.querySelector('select[name="detection"] option[value="'+level+'"]'))});
checks.push({name:'no-confirmation-checkbox',pass:world.querySelector('input[name="confirmed"]')===null});
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`;
fs.writeFileSync(path.join(out, "contact-editor.html"), fixture);
