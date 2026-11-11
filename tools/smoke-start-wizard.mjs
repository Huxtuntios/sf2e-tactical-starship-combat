/** Production wizard in Chromium with document doubles, not a live Foundry world. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Handlebars from "handlebars";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = path.resolve(process.argv[2] ?? path.join(root, "dist", "ui-tests", "start-wizard"));
fs.mkdirSync(out, { recursive: true });
const languages = Object.fromEntries(
  ["en", "ru"].map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(root, "lang", `${lang}.json`), "utf8"))])
);
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
let mock = fs.readFileSync(path.join(root, "tests/helpers/foundry-mock.mjs"), "utf8");
mock = mock
  .replace(/^import .* from "node:[^"]+";\n/gm, "")
  .replace(/^const ROOT = .*;\n/m, "")
  .replace(/^export const loadLang = .*;$/m, `export const loadLang = lang => flat(${json(languages)}[lang]);`)
  .replace(/export async function loadContentFromDisk\(\) \{[\s\S]*?\n\}/, "");
fs.writeFileSync(path.join(out, "foundry-mock.mjs"), mock);
const compiled = Handlebars.precompile(fs.readFileSync(path.join(root, "templates/start-wizard.hbs"), "utf8"));
const { OCCUPANT_PARTIAL } = await import("../scripts/crew/occupant.mjs");
const occupant = Handlebars.precompile(OCCUPANT_PARTIAL);
const index = JSON.parse(fs.readFileSync(path.join(root, "data/index.json"), "utf8"));
const content = Object.fromEntries(
  ["stations", "actions", "frames", "weapons", "upgrades"].map((key) => [
    key,
    JSON.parse(fs.readFileSync(path.join(root, "data", index[key]), "utf8"))[key]
  ])
);
const script = `
import {installFoundryMock,makeShip,makeCharacter,MockActor} from './foundry-mock.mjs';
installFoundryMock({lang: document.documentElement.lang});
const {Content}=await import('${rootUrl}/scripts/content/loader.mjs');
for(const [key,rows] of Object.entries(${json(content)}))Content[key]=new Map(rows.map(row=>[row.id,row]));
Content.loaded=true;
const root=document.querySelector('#app');
const template=Handlebars.template(${compiled});
Handlebars.registerPartial('tscOccupant',Handlebars.template(${occupant}));
Handlebars.registerHelper('localize',(key,options)=>game.i18n.format(key,options.hash));
Handlebars.registerHelper('dotsafe',key=>String(key).replace(/\\./g,'__DOT__'));
Handlebars.registerHelper('eq',(a,b)=>a===b);
Handlebars.registerHelper('not',v=>!v);
Handlebars.registerHelper('json',v=>JSON.stringify(v));
const checks=[]; const check=(name,pass)=>checks.push({name,pass:!!pass});
const crew=makeCharacter({id:'pilot',name:'Сариф'});
const player=makeShip({id:'player',name:'Рассветная дева',owners:['p1'],crew:[{actorUuid:crew.uuid,name:crew.name,role:'crew',stationId:'pilot'}],stations:[{id:'pilot',name:'Пульт пилота',type:'pilot',helmedBy:crew.uuid},{id:'gun',name:'Орудийная станция',type:'gunner',helmedBy:null}]});
const enemy=makeShip({id:'enemy',name:'Corsair (Lv 3)',role:'npc'});
const hazard=new MockActor({id:'hazard',name:'Asteroid field',type:'hazard',system:{details:{level:{value:3},isComplex:true}}});
game.actors.set(hazard.id,hazard);
for(let i=0;i<520;i++)makeShip({id:'large-'+i,name:'Catalogue '+String(i).padStart(3,'0'),role:'npc'});
const packed=makeShip({id:'packed',name:'Cargo Tug',role:'npc'});
game.actors.delete(packed.id);packed.pack='world.starships';Object.defineProperty(packed,'uuid',{value:'Compendium.world.starships.Actor.packed'});
__extraUuids.set(packed.uuid,packed);
game.packs=[{documentName:'Actor',collection:'world.starships',metadata:{label:'Starship Pack'},getIndex:async()=>[{_id:packed.id,uuid:packed.uuid,name:packed.name,type:packed.type,flags:packed.flags}]}];
class FixtureApplication {
  constructor(){this.element=root;this.rendered=false;this.position={width:840,height:850};}
  async render(){
    if(this.constructor.name!=='StartCombatWizard'){globalThis.dashboardOpened=true;return this;}
    const context=await this._prepareContext({});root.innerHTML=template(context);
    if(!this.rendered)this._onFirstRender?.(context,{});
    this.rendered=true;this._onRender?.(context,{});return this;
  }
  setPosition(){}
  async close(){this.closed=true;this.rendered=false;this._onClose?.({});return this;}
}
foundry.applications.api.ApplicationV2=FixtureApplication;
foundry.applications.instances=new Map();
foundry.applications.apps={FilePicker:{implementation:class{constructor({callback}){this.callback=callback;}render(){this.callback('moon.webp');}}}};
const {StartCombatWizard}=await import('${rootUrl}/scripts/ui/start-wizard.mjs');
let app=new StartCombatWizard();globalThis.wizard=app;
root.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(!target||target.disabled)return;const handler=StartCombatWizard.DEFAULT_OPTIONS.actions[target.dataset.action];if(handler)globalThis.lastAction=Promise.resolve(handler.call(app,event,target));});
root.addEventListener('submit',event=>{event.preventDefault();globalThis.lastAction=Promise.resolve(StartCombatWizard.DEFAULT_OPTIONS.form.handler.call(app,event,root,{object:{}}));});
await app.render();
const tick=async()=>{await globalThis.lastAction;await new Promise(resolve=>setTimeout(resolve,0));};
const set=async(selector,value)=>{const input=root.querySelector(selector);if(!input)throw new Error('Missing '+selector);if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new Event(input.type==='search'?'input':'change',{bubbles:true}));await tick();};
const action=async(name)=>{const button=root.querySelector('[data-action="'+name+'"]');if(!button)throw new Error('Missing action '+name);button.click();await tick();};
globalThis.fixture={checks,check,tick,set,action,player,enemy,hazard,packed,crew,root};
check('production-form',!!root.querySelector('.tsc-wizard'));
check('one-zone-count',root.querySelectorAll('[name="zones"]').length===1);
check('no-preconfirmation-document-writes',__writes.length===0);
const submit=async()=>{root.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();};
const visible=()=>[...root.querySelectorAll('[data-candidate-row]')].filter(row=>!row.hidden);
const rowFor=uuid=>[...root.querySelectorAll('[data-roster-row]')].find(row=>row.textContent.includes(uuid));
const field=async(uuid,name,value)=>{const row=rowFor(uuid);if(!row)throw new Error('Missing roster '+uuid);await set('[data-row-id="'+row.dataset.rowId+'"] [data-field="'+name+'"]',value);};
const fresh=async()=>{app=new StartCombatWizard();globalThis.wizard=app;await app.render();};
const beforePlayer=JSON.stringify(player.toObject());
const beforeEnemy=JSON.stringify(enemy.toObject());
const beforePack=JSON.stringify(packed.toObject());
globalThis.runWizardChecks=async()=>{
  check('world-index-over-400',root.querySelectorAll('[data-candidate]').length>500);
  await set('[name="filter"]','Catalogue 519');
  check('search-after-400',visible().length===1&&visible()[0].dataset.uuid==='Actor.large-519');
  await set('[data-candidate][data-uuid="Actor.large-519"]',true);
  await set('[name="filter"]','Corsair');
  await set('[data-candidate][data-uuid="Actor.enemy"]',true);
  check('selection-survives-filter',root.querySelector('[data-selected-count]').textContent==='2');
  await set('[name="source"]','compendium');
  await set('[name="filter"]','Cargo');
  check('compendium-index-browse',visible().length===1&&visible()[0].dataset.uuid===packed.uuid);
  await set('[data-candidate][data-uuid="'+packed.uuid+'"]',true);
  await action('refreshSources');
  check('selection-survives-source-refresh',root.querySelector('[data-selected-count]').textContent==='3');
  await action('addSelected');
  check('multi-source-add',app.getDraft().enemies.length===3);
  check('add-only-resolves-no-documents',__writes.length===0);
  app.removeRoster('Actor.large-519','starship');await app.render();
  check('editable-remove',app.getDraft().enemies.length===2);
  await field(enemy.uuid,'count',3);
  await field(enemy.uuid,'zone',8);
  await field(enemy.uuid,'zones','8, 7, 6');
  await field(enemy.uuid,'heading','right');
  await field(enemy.uuid,'detection','hidden');
  let draft=app.getDraft();let entry=draft.enemies.find(e=>e.uuid===enemy.uuid);
  check('count-course-per-copy-zones',entry.count===3&&entry.heading==='right'&&entry.zones.join(',')==='8,7,6'&&entry.detection==='hidden');
  check('reuse-disabled-for-multiple-private',rowFor(enemy.uuid).querySelector('[data-field="reuse"]').disabled);
  await field(packed.uuid,'role','player');
  check('role-player-identified',app.getDraft().playerShips[0]?.uuid===packed.uuid&&rowFor(packed.uuid).querySelector('[data-field="detection"]').value==='identified');
  await field(packed.uuid,'role','npc');
  await set('[name="source"]','world');await set('[name="filter"]','Рассветная');
  await set('[data-candidate][data-uuid="Actor.player"]',true);await action('addSelected');
  check('world-player-added',app.getDraft().playerShips.length===1);
  await set('[data-station="pilot"]','');await set('[data-station="gun"]',crew.uuid);
  check('station-release-and-assign-draft',app.getDraft().playerShips[0].stationAssignments.some(s=>s.stationId==='gun'&&s.actorUuid===crew.uuid));
  await set('[data-member][data-uuid="'+crew.uuid+'"]',false);
  check('deselect-crew-clears-assignment',app.getDraft().excludeCrew.includes(crew.uuid)&&app.getDraft().playerShips[0].stationAssignments.every(s=>!s.actorUuid));
  await set('[data-station="pilot"]',crew.uuid);
  check('assign-includes-crew',!app.getDraft().excludeCrew.includes(crew.uuid));
  await set('[name="filter"]','Asteroid');await set('[data-candidate][data-uuid="Actor.hazard"]',true);await action('addSelected');
  await field(hazard.uuid,'count',2);await field(hazard.uuid,'detection','observed');
  await action('addObjRow');await set('.tsc-obj-row [data-f="name"]','Debris cloud');
  await set('.tsc-obj-row [data-f="type"]','asteroid');await set('.tsc-obj-row [data-f="zone"]',4);
  await set('.tsc-obj-row [data-f="detection"]','identified');await action('pickObjectArt');
  check('custom-filepicker-persists',app.getDraft().objects[0].art==='moon.webp');
  await action('addObjRow');await set('.tsc-obj-row:last-child [data-f="name"]','Remove me');
  root.querySelector('.tsc-obj-row:last-child [data-action="removeObjRow"]').click();await tick();
  check('custom-remove',app.getDraft().objects.length===1);
  await set('[name="presetName"]','Wizard fixture');await action('savePreset');
  const saved=JSON.stringify(app.getDraft());
  await field(enemy.uuid,'count',1);await action('loadPreset');
  check('preset-roundtrip-roster',JSON.stringify(app.getDraft())===saved);
  check('presets-do-not-write-documents',__writes.length===0);
  await action('deletePreset');check('preset-delete',root.querySelector('[name="presetPick"]').options.length===1);
  await submit();
  check('first-submit-review-only',!!root.querySelector('[data-wizard-review]')&&__writes.length===0);
  check('review-totals',root.querySelector('[data-wizard-review] dl').textContent.includes('8'));
  check('review-expanded-zones',root.querySelector('[data-wizard-review]').textContent.includes('8, 7, 6'));
  await field(enemy.uuid,'heading','left');
  check('edit-invalidates-preview',root.querySelector('[data-wizard-review]').hidden);
  await submit();check('new-preview-required',__writes.length===0&&!root.querySelector('[data-wizard-review]').hidden);
  await action('cancel');check('cancel-no-documents',app.closed&&__writes.length===0);
  await fresh();await submit();
  check('empty-roster-error',!!root.querySelector('[data-wizard-error]').textContent.trim()&&__writes.length===0);
  await app.loadDraft({enemies:[{uuid:'Actor.missing-source',count:2}]});await submit();
  check('stale-preset-error-no-documents',root.querySelector('[data-wizard-error]').textContent.trim().length>0&&__writes.length===0);
  await app.loadDraft({enemies:[{uuid:enemy.uuid,count:2,detection:'identified',zone:8,zones:[8,7]}],playerShips:[{uuid:player.uuid,zone:2}]});
  await submit();game.user=game.users.get('p1');await submit();
  check('failed-confirm-keeps-draft',app.getDraft().enemies[0].count===2&&!app.closed&&root.querySelector('[data-wizard-error]').textContent.trim().length>0&&__writes.length===0);
  game.user=game.users.get('gm');await submit();
  root.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));const first=globalThis.lastAction;
  check('confirmation-busy-disables-controls',root.querySelector('[data-wizard-submit]').disabled);
  root.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await first;await tick();
  check('confirm-once-completes',app.closed&&game.combats.size===1&&game.combat.combatants.filter(c=>c.actor?.flags?.['sf2e-tactical-starship-combat']?.tacticalCopyOf===enemy.uuid).length===2);
  check('dashboard-opens-after-success',globalThis.dashboardOpened===true);
  check('source-player-preserved',JSON.stringify(player.toObject())===beforePlayer);
  check('source-npc-preserved',JSON.stringify(enemy.toObject())===beforeEnemy);
  check('source-compendium-preserved',JSON.stringify(packed.toObject())===beforePack);
};
await globalThis.runWizardChecks();
await fresh();
await app.loadDraft({playerShips:[{uuid:player.uuid,zone:2,heading:'right'}],enemies:[{uuid:enemy.uuid,count:3,zone:8,zones:[8,7,6],heading:'left',detection:'hidden'}],hazards:[{uuid:hazard.uuid,count:2,zone:5,detection:'observed'}],objects:[{name:'Debris cloud',type:'asteroid',zone:4,art:'moon.webp',detection:'identified'}]});
await set('[name="filter"]','Corsair');
await submit();
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
`;
for (const lang of ["en", "ru"]) {
  fs.writeFileSync(path.join(out, `wizard-${lang}.mjs`), script);
  fs.writeFileSync(
    path.join(out, `wizard-${lang}.html`),
    `<!doctype html><html lang="${lang}"><meta charset="utf-8"><title>Combat wizard — browser fixture</title><link rel="stylesheet" href="${rootUrl}/styles/main.css"><style>body{background:#141b29;font:14px Arial;margin:0;padding:20px;color:#e3ecfa}.application{width:860px;max-width:calc(100vw - 40px);margin:auto}.window-header{padding:12px;font-weight:bold;background:#162133}.window-content{padding:12px;box-sizing:border-box}#result{font-size:11px;max-width:860px;margin:auto;white-space:pre-wrap}.tsc-wizard{max-height:none}</style><main class="application sf2e-tsc" data-sheet-theme="dark"><header class="window-header">${lang === "ru" ? "Создать тактический бой звездолётов" : "Start tactical starship combat"} · ${lang === "ru" ? "Браузерная тестовая среда" : "Browser fixture"}</header><form id="app" class="window-content"></form></main><pre id="result">waiting</pre><script src="${rootUrl}/node_modules/handlebars/dist/handlebars.runtime.js"></script><script type="module" src="./wizard-${lang}.mjs"></script></html>`
  );
}
console.log(`Wrote wizard fixtures to ${out}`);
