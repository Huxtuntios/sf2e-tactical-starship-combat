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
const reviewCompiled = Handlebars.precompile(fs.readFileSync(path.join(root, "templates/combat-review.hbs"), "utf8"));
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
const mockCtx=installFoundryMock({lang: document.documentElement.lang});
const {Content}=await import('${rootUrl}/scripts/content/loader.mjs');
for(const [key,rows] of Object.entries(${json(content)}))Content[key]=new Map(rows.map(row=>[row.id,row]));
Content.loaded=true;
const root=document.querySelector('#app');
const reviewRoot=document.createElement('form');reviewRoot.className='application sf2e-tsc tsc-review-host';reviewRoot.setAttribute('data-sheet-theme','dark');document.body.appendChild(reviewRoot);
const template=Handlebars.template(${compiled});
const reviewTemplate=Handlebars.template(${reviewCompiled});
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
const originalsOpened=[];packed.sheet={render:force=>originalsOpened.push({uuid:packed.uuid,force})};
enemy._stats={compendiumSource:packed.uuid};
makeShip({id:'level-low',name:'Low ship',role:'npc',level:-1});
makeShip({id:'level-zero',name:'Zero ship',role:'npc',level:0});
const unknown=new MockActor({id:'level-unknown',name:'Unknown level',type:'hazard'});game.actors.set(unknown.id,unknown);
game.packs=[{documentName:'Actor',collection:'world.starships',metadata:{label:'Starship Pack'},getIndex:async()=>[{_id:packed.id,uuid:packed.uuid,name:packed.name,type:packed.type,flags:packed.flags}]}];
class FixtureApplication {
  constructor(){this.element=this.constructor.name==='CombatReviewApp'?reviewRoot:root;this.rendered=false;this.position={width:840,height:850};}
  async render(){
    const name=this.constructor.name;
    if(name==='CombatReviewApp'){globalThis.reviewApp=this;const ctx=await this._prepareContext({});reviewRoot.innerHTML=reviewTemplate(ctx);if(!this.rendered)this._onFirstRender?.(ctx,{});this.rendered=true;this._onRender?.(ctx,{});return this;}
    if(name!=='StartCombatWizard'){globalThis.dashboardOpened=true;return this;}
    const context=await this._prepareContext({});root.innerHTML=template(context);
    if(!this.rendered)this._onFirstRender?.(context,{});
    this.rendered=true;this._onRender?.(context,{});return this;
  }
  setPosition(){}
  async close(){this.closed=true;this.rendered=false;if(this.constructor.name==='CombatReviewApp')this.element.innerHTML='';this._onClose?.({});return this;}
}
foundry.applications.api.ApplicationV2=FixtureApplication;
foundry.applications.instances=new Map();
foundry.applications.apps={FilePicker:{implementation:class{constructor({callback}){this.callback=callback;}render(){this.callback('moon.webp');}}}};
const {StartCombatWizard}=await import('${rootUrl}/scripts/ui/start-wizard.mjs');
const {CombatReviewApp}=await import('${rootUrl}/scripts/ui/combat-review.mjs');
let app=new StartCombatWizard();globalThis.wizard=app;
root.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(!target||target.disabled)return;const handler=StartCombatWizard.DEFAULT_OPTIONS.actions[target.dataset.action];if(handler)globalThis.lastAction=Promise.resolve(handler.call(app,event,target));});
root.addEventListener('submit',event=>{event.preventDefault();globalThis.lastAction=Promise.resolve(StartCombatWizard.DEFAULT_OPTIONS.form.handler.call(app,event,root,{object:{}}));});
reviewRoot.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(!target||target.disabled)return;const handler=CombatReviewApp.DEFAULT_OPTIONS.actions[target.dataset.action];if(handler)globalThis.lastAction=Promise.resolve(handler.call(globalThis.reviewApp,event,target));});
await app.render();
const tick=async()=>{await globalThis.lastAction;await new Promise(resolve=>setTimeout(resolve,0));};
const set=async(selector,value)=>{const input=root.querySelector(selector);if(!input)throw new Error('Missing '+selector);if(['checkbox','radio'].includes(input.type))input.checked=value;else input.value=value;input.dispatchEvent(new Event(input.type==='search'?'input':'change',{bubbles:true}));await tick();};
const action=async(name)=>{const button=root.querySelector('[data-action="'+name+'"]');if(!button)throw new Error('Missing action '+name);button.click();await tick();};
const reviewAction=async(name)=>{const button=reviewRoot.querySelector('[data-action="'+name+'"]');if(!button)throw new Error('Missing review action '+name);button.click();await tick();};
const reviewOpen=()=>!!(globalThis.reviewApp&&globalThis.reviewApp.rendered&&reviewRoot.querySelector('[data-wizard-review]'));
globalThis.fixture={checks,check,tick,set,action,reviewAction,player,enemy,hazard,packed,crew,root,reviewRoot,originalsOpened};
globalThis.measureRosterSort=()=>{
  const group=root.querySelector('.tsc-wizard-roster-sort');
  const roster=root.querySelector('.tsc-wizard-roster');
  const labels=[...(group?.querySelectorAll('label')??[])];
  const groupRect=group?.getBoundingClientRect();
  const contained=!!groupRect&&labels.every(label=>{
    const rect=label.getBoundingClientRect();
    return rect.left>=groupRect.left-1&&rect.right<=groupRect.right+1&&rect.top>=groupRect.top-1&&rect.bottom<=groupRect.bottom+1;
  });
  const targets=labels.length===2&&labels.every(label=>{
    const rect=label.getBoundingClientRect();
    return rect.width>=24&&rect.height>=24;
  });
  return {checks:[
    {name:'roster-sort-contained',pass:!!group&&group.scrollWidth<=group.clientWidth+1&&contained},
    {name:'roster-sort-target-size',pass:targets},
    {name:'roster-sort-inside-roster',pass:!!group&&!!roster&&roster.contains(group)}
  ]};
};
check('production-form',!!root.querySelector('.tsc-wizard'));
check('one-zone-count',root.querySelectorAll('[name="zones"]').length===1);
check('no-preconfirmation-document-writes',__writes.length===0);
check('resizable-and-maximize',StartCombatWizard.DEFAULT_OPTIONS.window.resizable===true&&!!StartCombatWizard.DEFAULT_OPTIONS.actions.toggleMaximize);
const submit=async()=>{root.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();};
const visible=()=>[...root.querySelectorAll('[data-candidate-row]')].filter(row=>!row.hidden);
const rowFor=uuid=>[...root.querySelectorAll('[data-roster-row]')].find(row=>row.textContent.includes(uuid));
const field=async(uuid,name,value)=>{const row=rowFor(uuid);if(!row)throw new Error('Missing roster '+uuid);await set('[data-row-id="'+row.dataset.rowId+'"] [data-field="'+name+'"]',value);};
const fresh=async()=>{if(globalThis.reviewApp)await globalThis.reviewApp.close();app=new StartCombatWizard();globalThis.wizard=app;await app.render();};
const beforePlayer=JSON.stringify(player.toObject());
const beforeEnemy=JSON.stringify(enemy.toObject());
const beforePack=JSON.stringify(packed.toObject());
globalThis.runWizardChecks=async()=>{
  const bounds=!!root.querySelector('[name="minLevel"]')&&!!root.querySelector('[name="maxLevel"]');
  check('level-range-controls',bounds);
  if(bounds){
    check('valid-level-input-does-not-describe-error',!root.querySelector('[name="minLevel"]').getAttribute('aria-describedby').split(' ').includes(root.querySelector('[data-level-error]').id));
    check('empty-level-bounds-include-unknown',visible().some(row=>row.dataset.uuid===unknown.uuid));
    await set('[name="maxLevel"]','0');
    check('max-zero-includes-negative-and-zero',visible().map(row=>row.dataset.uuid).sort().join(',')==='Actor.level-low,Actor.level-zero');
    await set('[name="minLevel"]','0');
    check('equal-bounds-include-zero',visible().length===1&&visible()[0].dataset.uuid==='Actor.level-zero');
    await set('[name="minLevel"]','-1');await set('[name="maxLevel"]','-1');
    check('equal-negative-bounds',visible().length===1&&visible()[0].dataset.uuid==='Actor.level-low');
    await set('[name="minLevel"]','3');await set('[name="maxLevel"]','3');
    await set('[name="kind"]','hazard');
    check('hazard-level-filter',visible().length===1&&visible()[0].dataset.uuid===hazard.uuid);
    await set('[name="kind"]','all');
    await set('[data-candidate][data-uuid="Actor.enemy"]',true);
    const unchanged=JSON.stringify(app.getDraft());
    await set('[name="minLevel"]','4');
    check('reversed-range-warning',visible().length===0&&!root.querySelector('[data-level-error]').hidden&&root.querySelector('[name="minLevel"]').getAttribute('aria-invalid')==='true');
    check('range-keeps-selection-and-draft',root.querySelector('[data-selected-count]').textContent==='1'&&JSON.stringify(app.getDraft())===unchanged);
    check('range-warning-not-combat-form-invalid',root.checkValidity());
    await set('[name="maxLevel"]','');
    check('minimum-only-excludes-lower-levels',visible().length===0&&root.querySelector('[data-level-error]').hidden);
    await set('[name="source"]','compendium');await set('[name="minLevel"]','3');
    check('compendium-level-inclusive',visible().length===1&&visible()[0].dataset.uuid===packed.uuid);
    await set('[name="source"]','all');await set('[name="maxLevel"]','3');
    check('all-sources-level-filter',visible().some(row=>row.dataset.uuid===packed.uuid)&&visible().some(row=>row.dataset.uuid===enemy.uuid)&&!visible().some(row=>row.dataset.uuid===unknown.uuid));
    await action('refreshSources');
    check('range-persists-after-render',root.querySelector('[name="minLevel"]').value==='3'&&root.querySelector('[name="maxLevel"]').value==='3'&&!visible().some(row=>row.dataset.uuid===unknown.uuid));
    await set('[name="source"]','world');await set('[name="minLevel"]','');await set('[name="maxLevel"]','');
    await set('[data-candidate][data-uuid="Actor.enemy"]',false);
    check('cleared-bounds-restore-unknown',visible().some(row=>row.dataset.uuid===unknown.uuid));
  }
  const preview=root.querySelector('[data-action="previewOriginal"][data-uuid="Actor.enemy"]');
  check('original-preview-control',!!preview);
  if(preview){
    check('preview-outside-label',!preview.closest('label')&&preview.type==='button');
    preview.click();await tick();
    check('preview-native-original-no-selection',originalsOpened.length===1&&originalsOpened[0].uuid===packed.uuid&&originalsOpened[0].force&&root.querySelector('[data-selected-count]').textContent==='0');
    check('preview-no-submit-or-documents',__writes.length===0&&!reviewOpen()&&app.getDraft().enemies.length===0);
    const unavailable=root.querySelector('[data-action="previewOriginal"][data-uuid="Actor.hazard"]');
    check('no-original-disabled-with-explanation',unavailable.disabled&&!!unavailable.getAttribute('title'));
    root.querySelector('[data-candidate-row][data-uuid="Actor.enemy"] label').click();await tick();
    check('candidate-label-still-selects',root.querySelector('[data-selected-count]').textContent==='1');
    await set('[data-candidate][data-uuid="Actor.enemy"]',false);
  }
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
  check('crew-controls-not-duplicated',!root.querySelector('[data-station]')&&!root.querySelector('[data-member]')&&!root.querySelector('[data-extra-crew]'));
  check('crew-manager-button-present',!!rowFor(player.uuid).querySelector('[data-action="openCrewManager"]'));
  check('default-station-assignments-from-sheet',app.getDraft().playerShips[0].stationAssignments.some(s=>s.stationId==='pilot'&&s.actorUuid===crew.uuid));
  check('browse-collapsed-when-composing',!root.querySelector('.tsc-wizard-browse').open);
  root.querySelector('.tsc-wizard-browse summary').click();await tick();
  check('manual-expand-opens',root.querySelector('.tsc-wizard-browse').open);
  await set('[name="source"]','compendium');
  check('browse-expansion-survives-source-change',root.querySelector('.tsc-wizard-browse').open);
  await set('[name="source"]','world');
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
  check('first-submit-opens-review-dialog',reviewOpen()&&__writes.length===0);
  check('review-not-inline',!root.querySelector('[data-wizard-review]'));
  check('review-totals',reviewRoot.querySelector('[data-wizard-review] dl').textContent.includes('8'));
  check('review-expanded-zones',reviewRoot.querySelector('[data-wizard-review]').textContent.includes('8, 7, 6'));
  await field(enemy.uuid,'heading','left');
  check('edit-closes-review',!reviewOpen());
  await submit();check('new-preview-required',__writes.length===0&&reviewOpen());
  await reviewAction('back');
  check('back-to-edit-keeps-draft',!reviewOpen()&&!app.closed&&app.getDraft().enemies.length===2);
  await action('openReview');
  check('manual-review-opens',reviewOpen());
  await reviewAction('confirm');
  check('dialog-confirm-completes',app.closed&&game.combat.combatants.filter(c=>c.actor?.flags?.['sf2e-tactical-starship-combat']?.tacticalCopyOf===enemy.uuid).length===3);
  check('review-closed-after-confirm',!reviewOpen());
  check('dashboard-opens-after-success',globalThis.dashboardOpened===true);
  check('source-player-preserved',JSON.stringify(player.toObject())===beforePlayer);
  check('source-npc-preserved',JSON.stringify(enemy.toObject())===beforeEnemy);
  check('source-compendium-preserved',JSON.stringify(packed.toObject())===beforePack);
  mockCtx.settings.set('autoOpenCombatReview',false);
  __writes.length=0;
  await fresh();await submit();
  check('empty-roster-error',!!root.querySelector('[data-wizard-error]').textContent.trim()&&__writes.length===0&&!reviewOpen());
  await app.loadDraft({enemies:[{uuid:'Actor.missing-source',count:2}]});await submit();
  check('stale-preset-error-no-documents',root.querySelector('[data-wizard-error]').textContent.trim().length>0&&__writes.length===0&&!reviewOpen());
  await app.loadDraft({enemies:[{uuid:enemy.uuid,count:2,detection:'identified',zone:8,zones:[8,7]}],playerShips:[{uuid:player.uuid,zone:2}]});
  await submit();
  check('auto-off-no-dialog',!reviewOpen()&&__writes.length===0);
  check('auto-off-arms-confirm',root.querySelector('[data-wizard-submit]').textContent===game.i18n.format('SF2eTSC.wizard.confirmStart'));
  await action('openReview');check('manual-review-with-auto-off',reviewOpen());await reviewAction('back');
  check('validation-active-with-auto-off',!root.querySelector('[data-wizard-error]').textContent.trim());
  const submitEvent=()=>root.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  submitEvent();const first=globalThis.lastAction;
  check('confirmation-busy-disables-controls',root.querySelector('[data-wizard-submit]').disabled);
  submitEvent();await first;await tick();
  check('confirm-once-completes',app.closed&&game.combat.combatants.filter(c=>c.actor?.flags?.['sf2e-tactical-starship-combat']?.tacticalCopyOf===enemy.uuid).length===2);
  await fresh();
  await app.loadDraft({playerShips:[{uuid:player.uuid,zone:2,stationAssignments:[{stationId:'gun',actorUuid:crew.uuid}]}],excludeCrew:[],enemies:[{uuid:enemy.uuid,count:1,detection:'identified',reuse:false}]});
  check('preset-station-assignments-applied',app.getDraft().playerShips[0].stationAssignments.some(s=>s.stationId==='gun'&&s.actorUuid===crew.uuid));
  check('explicit-false-reuse-preserved',app.getDraft().enemies[0].reuse===false);
  await app.loadDraft({enemies:[{uuid:enemy.uuid,count:1,detection:'identified'}]});
  check('legacy-preset-defaults-reuse-true',app.getDraft().enemies[0].reuse===true);
};
globalThis.runRosterSortChecks=async()=>{
  await fresh();
  const writesBefore=__writes.length;
  const sortRows=[
    ['sort-high','High',9],
    ['sort-zulu','Zulu',3],
    ['sort-missing','Missing',null],
    ['sort-beta','Бета',3],
    ['sort-invalid','Invalid','bad'],
    ['sort-bravo','Bravo',3],
    ['sort-low','Low',-1],
    ['sort-zero','Zero',0],
    ['sort-alpha','Alpha',3],
    ['same-first','Same',2],
    ['empty-first','',2],
    ['same-second','Same',2],
    ['empty-second','',2]
  ];
  for(const [id,name,level] of sortRows)makeShip({id,name,role:'npc',level});
  const sortPlayer=makeShip({id:'sort-player',name:'Player Ship',role:'player',level:5,stations:[{id:'pilot',name:'Pilot',type:'pilot',helmedBy:null}]});
  const sortHazard=new MockActor({id:'sort-hazard',name:'Hazard',type:'hazard',system:{details:{level:{value:4}}}});game.actors.set(sortHazard.id,sortHazard);
  const sourceOrder=sortRows.map(([id])=>'Actor.'+id);
  await app.loadDraft({playerShips:[{uuid:sortPlayer.uuid,zone:2,stationAssignments:[{stationId:'pilot',actorUuid:crew.uuid}]}],enemies:sourceOrder.map(uuid=>({uuid,detection:'identified'})),hazards:[{uuid:sortHazard.uuid,detection:'identified'}]});
  const levelExpected=document.documentElement.lang==='ru'
    ?['Actor.sort-low','Actor.sort-zero','Actor.empty-first','Actor.empty-second','Actor.same-first','Actor.same-second','Actor.sort-beta','Actor.sort-alpha','Actor.sort-bravo','Actor.sort-zulu','Actor.sort-hazard','Actor.sort-player','Actor.sort-high','Actor.sort-invalid','Actor.sort-missing']
    :['Actor.sort-low','Actor.sort-zero','Actor.empty-first','Actor.empty-second','Actor.same-first','Actor.same-second','Actor.sort-alpha','Actor.sort-bravo','Actor.sort-zulu','Actor.sort-beta','Actor.sort-hazard','Actor.sort-player','Actor.sort-high','Actor.sort-invalid','Actor.sort-missing'];
  const nameExpected=document.documentElement.lang==='ru'
    ?['Actor.empty-first','Actor.empty-second','Actor.sort-beta','Actor.sort-alpha','Actor.sort-bravo','Actor.sort-hazard','Actor.sort-high','Actor.sort-invalid','Actor.sort-low','Actor.sort-missing','Actor.sort-player','Actor.same-first','Actor.same-second','Actor.sort-zero','Actor.sort-zulu']
    :['Actor.empty-first','Actor.empty-second','Actor.sort-alpha','Actor.sort-bravo','Actor.sort-hazard','Actor.sort-high','Actor.sort-invalid','Actor.sort-low','Actor.sort-missing','Actor.sort-player','Actor.same-first','Actor.same-second','Actor.sort-zero','Actor.sort-zulu','Actor.sort-beta'];
  const order=()=>[...root.querySelectorAll('[data-roster-row]')].map(row=>row.dataset.uuid);
  check('roster-sort-level-order',JSON.stringify(order())===JSON.stringify(levelExpected));
  const before=JSON.stringify(app.getDraft());
  const assignmentBefore=JSON.stringify(app.getDraft().playerShips[0].stationAssignments);
  await set('[data-candidate][data-uuid="Actor.enemy"]',true);
  const selectedBefore=root.querySelector('[data-selected-count]').textContent;
  await field('Actor.sort-alpha','reuse',false);
  await field('Actor.sort-bravo','count',2);
  await field('Actor.sort-bravo','zones','7, 8');
  const edited=JSON.stringify(app.getDraft());
  const alphaRow=rowFor('Actor.sort-alpha');
  const bravoRow=rowFor('Actor.sort-bravo');
  const alphaReuse=alphaRow.querySelector('[data-field="reuse"]');
  const bravoCount=bravoRow.querySelector('[data-field="count"]');
  const bravoZones=bravoRow.querySelector('[data-field="zones"]');
  const sortGroup=root.querySelector('.tsc-wizard-roster-sort');
  check('roster-sort-native-radio-group',!!sortGroup&&sortGroup.querySelector('legend')?.textContent.trim().length>0&&sortGroup.querySelectorAll('input[type="radio"][name="rosterSort"]').length===2&&[...sortGroup.querySelectorAll('input[type="radio"]')].every(input=>input.labels.length===1));
  check('roster-sort-default-level',!!sortGroup&&sortGroup.querySelector('[value="level"]').checked&&!sortGroup.querySelector('[value="name"]').checked);
  if(sortGroup){
    const nameRadio=sortGroup.querySelector('[value="name"]');
    nameRadio.focus();
    await set('[name="rosterSort"][value="name"]',true);
    check('roster-sort-name-order',JSON.stringify(order())===JSON.stringify(nameExpected));
    check('roster-sort-mode-state',nameRadio.checked&&!sortGroup.querySelector('[value="level"]').checked&&document.activeElement===nameRadio);
    check('roster-sort-preserves-selection',root.querySelector('[data-selected-count]').textContent===selectedBefore&&root.querySelector('[data-candidate][data-uuid="Actor.enemy"]').checked);
    check('roster-sort-preserves-checkboxes-and-copy-settings',alphaReuse.checked===false&&bravoCount.value==='2'&&bravoZones.value==='7, 8'&&JSON.stringify(app.getDraft())===edited);
    check('roster-sort-preserves-station-assignments',JSON.stringify(app.getDraft().playerShips[0].stationAssignments)===assignmentBefore);
    check('roster-sort-preserves-authoritative-order',JSON.stringify(app.getDraft().enemies.map(entry=>entry.uuid))===JSON.stringify(sourceOrder));
    check('roster-sort-no-document-writes',__writes.length===writesBefore);
    await set('[name="rosterSort"][value="level"]',true);
    check('roster-sort-switch-back',JSON.stringify(order())===JSON.stringify(levelExpected)&&JSON.stringify(app.getDraft())===edited);
  }
  check('roster-sort-only-display-state',JSON.stringify(app.getDraft())===edited&&edited!==before);
};
await globalThis.runWizardChecks();
await globalThis.runRosterSortChecks();
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
    `<!doctype html><html lang="${lang}"><meta charset="utf-8"><title>Combat wizard — browser fixture</title><link rel="stylesheet" href="${rootUrl}/styles/main.css"><style>body{background:#141b29;font:14px Arial;margin:0;padding:20px;color:#e3ecfa}.application{width:860px;max-width:calc(100vw - 40px);margin:auto}.window-header{padding:12px;font-weight:bold;background:#162133}.window-content{padding:12px;box-sizing:border-box}#result{font-size:11px;max-width:860px;margin:auto;white-space:pre-wrap}.tsc-wizard{max-height:none}.tsc-review-host{margin-top:16px;border:1px solid #2c3e57}</style><main class="application sf2e-tsc" data-sheet-theme="dark"><header class="window-header">${lang === "ru" ? "Создать тактический бой звездолётов" : "Start tactical starship combat"} · ${lang === "ru" ? "Браузерная тестовая среда" : "Browser fixture"}</header><form id="app" class="window-content"></form></main><pre id="result">waiting</pre><script src="${rootUrl}/node_modules/handlebars/dist/handlebars.runtime.js"></script><script type="module" src="./wizard-${lang}.mjs"></script></html>`
  );
}
console.log(`Wrote wizard fixtures to ${out}`);
