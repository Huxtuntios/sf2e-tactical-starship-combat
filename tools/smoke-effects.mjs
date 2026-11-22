import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadLang } from "../tests/helpers/foundry-mock.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "ui-tests", "effects");
fs.mkdirSync(out, { recursive: true });
const templates = Object.fromEntries(
  ["effect-manager", "effect-targets"].map((name) => [name, fs.readFileSync(path.join(root, "templates", `${name}.hbs`), "utf8")])
);
for (const lang of ["en", "ru"]) {
  const labels = loadLang(lang);
  const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8">
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<style>body{padding:1rem;background:#dae0e8}.application{width:620px;max-width:100%;height:650px;padding:1rem;box-sizing:border-box;margin-block-end:1rem}dialog{width:580px;max-width:90vw;max-height:90vh;overflow:auto}dialog form{display:flex;flex-direction:column;gap:.5rem}</style>
<script src="${rootUrl}/node_modules/handlebars/dist/handlebars.min.js"></script>
<main id="hosts"></main><pre id="result">waiting</pre>
<script type="module">
const M='sf2e-tactical-starship-combat', labels=${JSON.stringify(labels)}, templates=${JSON.stringify(templates)};
let sequence=0;const checks=[],requests=[],notes=[];
const check=(name,pass)=>checks.push({name,pass:!!pass});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();await new Promise(requestAnimationFrame);};
const gm={id:'gm',isGM:true,active:true};
const settings={starshipSheetTheme:'light',uiState:{},ruleEnforcement:'strict'};
const actors=new Map();
globalThis.game={system:{id:'sf2e'},user:gm,users:{activeGM:gm,get:id=>id==='gm'?gm:null},actors,combats:[],combat:null,time:{worldTime:100},settings:{get:(_m,k)=>settings[k],set:async(_m,k,v)=>settings[k]=v},i18n:{lang:'${lang}',has:k=>Object.hasOwn(labels,k),localize:k=>labels[k]??k,format:(k,data)=>Object.entries(data??{}).reduce((text,[key,value])=>text.replaceAll('{'+key+'}',value),labels[k]??k)},socket:{connected:true}};
globalThis.ui={notifications:{info:text=>notes.push(text),warn:text=>notes.push(text),error:text=>notes.push(text)}};
globalThis.Hooks={on:()=>1,off:()=>{},callAll:()=>{}};
globalThis.CONFIG={PF2E:{skills:{piloting:{attribute:'dex'},computers:{attribute:'int'}},damageTypes:{fire:'SF2eTSC.damageTypes.fire',cold:'SF2eTSC.damageTypes.cold'}}};
globalThis.fromUuidSync=uuid=>actors.get(uuid);globalThis.fromUuid=async uuid=>actors.get(uuid);
const esc=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class App {
 constructor(){this.options=this.constructor.DEFAULT_OPTIONS??{};this.id='effects-'+(++sequence);this.rendered=false;}
 async render(){const context=await this._prepareContext();const name=this.constructor.PARTS.body.template.split('/').pop().replace('.hbs','');if(!this.element){this.element=document.createElement(this.options.tag??'section');this.element.className='application sf2e-tsc '+(this.options.classes??[]).join(' ');this.element.id=this.id;document.querySelector('#hosts').append(this.element);this.element.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button)this.options.actions?.[button.dataset.action]?.call(this,event,button);});this.element.addEventListener('submit',event=>{event.preventDefault();this.options.form?.handler.call(this,event,this.element);});this._onFirstRender?.(context,{});}this.element.innerHTML=Handlebars.compile(templates[name])(context);this.rendered=true;this._onRender?.(context,{});return this;}
 async close(){this.rendered=false;this._onClose?.({});this.element?.remove();}
 setPosition(){} bringToFront(){}
}
const DialogV2={prompt:options=>new Promise(resolve=>{check('native-dialog-content-no-attributes',options.content.attributes.length===0);check('native-config-scoped-wrapper',options.content.firstElementChild?.classList.contains('tsc-effect-config'));const dialog=document.createElement('dialog'),form=document.createElement('form');dialog.className='sf2e-tsc';const title=document.createElement('h3');title.textContent=options.window.title;form.append(title);const renderedContent=document.createElement('div');renderedContent.innerHTML=options.content.innerHTML;form.append(renderedContent);const submit=document.createElement('button');submit.type='submit';submit.textContent=options.ok.label;const cancel=document.createElement('button');cancel.type='button';cancel.textContent=game.i18n.localize('SF2eTSC.attackCard.cancel');form.append(submit,cancel);dialog.append(form);document.body.append(dialog);form.addEventListener('submit',event=>{event.preventDefault();resolve(options.ok.callback(event,{form},dialog));dialog.close();dialog.remove();});cancel.addEventListener('click',()=>{resolve(null);dialog.close();dialog.remove();});dialog.showModal();options.render?.(new Event('render'),{element:dialog});})};
globalThis.foundry={utils:{randomID:()=>String(++sequence).padStart(16,'0'),escapeHTML:esc},applications:{api:{ApplicationV2:App,HandlebarsApplicationMixin:Base=>Base,DialogV2},ux:{TextEditor:{implementation:{enrichHTML:async text=>text}}}}};
Handlebars.registerHelper('localize',key=>game.i18n.localize(key));
const pc={uuid:'Actor.pilot',name:'${lang === "ru" ? "Пилот" : "Pilot"}',type:'character',flags:{},items:new Map()};
const gunner={uuid:'Actor.gunner',name:'${lang === "ru" ? "Стрелок" : "Gunner"}',type:'character',flags:{},items:new Map()};
const ship={uuid:'Actor.ship',name:'${lang === "ru" ? "Тестовый корабль" : "Test ship"}',type:'vehicle',system:{attributes:{hp:{value:30,max:30}}},flags:{[M]:{starship:{isStarship:true,dataVersion:1,role:'player',level:1,ac:20,sp:{value:10,max:10},stations:[{id:'pilot',name:pc.name,type:'pilot',grade:'commercial',helmedBy:pc.uuid},{id:'gun',name:gunner.name,type:'gunnery',grade:'commercial',helmedBy:gunner.uuid}],weapons:[{id:'laser',name:'Laser',stationId:'gun',die:'1d6',damageType:'fire'}],crew:[{actorUuid:pc.uuid,role:'crew',stationId:'pilot'},{actorUuid:gunner.uuid,role:'crew',stationId:'gun'}],effects:[]}}}};
for(const actor of [pc,gunner,ship,{uuid:'Actor.stranger',type:'character',name:'Stranger',flags:{}}])actors.set(actor.uuid,actor);
game.pf2e={ConditionManager:{conditionsSlugs:['frightened','off-guard','persistent-damage'],getCondition:slug=>({name:slug==='frightened'?'${lang === "ru" ? "Напуган" : "Frightened"}':slug,system:{value:{isValued:slug==='frightened'},rules:slug==='persistent-damage'?[]:[{key:'FlatModifier'}]}})}};
const {Content}=await import('${rootUrl}/scripts/content/loader.mjs');
Content.actions.set('evade',{id:'evade',name:'Evade',station:'pilot',minGrade:'commercial'});
Content.actions.set('strike',{id:'strike',name:'Strike',station:'gunnery',minGrade:'commercial'});
const {registerHandler}=await import('${rootUrl}/scripts/socket.mjs');
let finishApply;
registerHandler('applyManualEffect',({payload})=>{requests.push(payload);return new Promise(resolve=>finishApply=()=>{const record={...payload.input,id:'manual-'+payload.input.operationId,manual:true,status:'active',shipUuid:ship.uuid,conditions:payload.input.slug?[payload.input.slug]:[],nativeTargets:[],targetSnapshot:{crew:[{uuid:pc.uuid,label:pc.name},{uuid:gunner.uuid,label:gunner.name}],stations:[],actions:[],weapons:[],mechanics:[]}};ship.flags[M].starship.effects.push(record);resolve({status:'applied',applicationId:record.id});});});
registerHandler('effectTiming',({payload})=>{requests.push(payload);ship.flags[M].starship.effects=ship.flags[M].starship.effects.filter(effect=>effect.id!==payload.effectId);return {status:'removed'};});
const {openEffectManager}=await import('${rootUrl}/scripts/ui/effect-manager.mjs');
const manager=openEffectManager(ship);await flush();
manager.element.querySelector('[data-action=add]').click();await flush();
let config=document.querySelector('dialog form');
check('immunity-default-off',!config.elements.ignoreImmunities.checked);
check('native-persistent-not-unconfigured-condition',![...config.elements.slug.options].some(option=>option.value==='persistent-damage'));
config.elements.slug.value='frightened';config.elements.slug.dispatchEvent(new Event('change',{bubbles:true}));
check('valued-condition-enabled',!config.elements.conditionValue.disabled);config.elements.conditionValue.value='2';
config.querySelector('[type=submit]').click();await flush();
let target=document.querySelector('form.tsc-effect-targets');
check('default-entire',target.elements.entire.checked);
check('target-transition-focus',document.activeElement===target.elements.entire);
check('independent-groups',target.querySelectorAll('fieldset').length===6 && target.querySelectorAll('[name=actions]').length===2);
check('crew-not-world-actors',target.querySelectorAll('[name=crew]').length===2 && !target.textContent.includes('Stranger'));
target.elements.allCrew.click();target.querySelector('[name=crew]').click();
check('summary-before-confirmation',target.querySelector('[data-target-summary]').textContent.includes(pc.name));
check('configure-and-select-no-write',requests.length===0);
const submit=target.querySelector('[type=submit]');submit.click();submit.click();await flush();
check('one-submit-and-busy',requests.length===1 && submit.disabled && target.getAttribute('aria-busy')==='true');
check('union-forwarded',requests[0].input.targets.entire && requests[0].input.targets.allCrew && requests[0].input.targets.crew.length===1);
finishApply();await flush();
check('successful-apply-closes-target',!target.isConnected && manager.element.querySelectorAll('.tsc-effect-application').length===1);
manager.element.querySelector('[data-action=remove]').click();await flush();
check('exact-removal-request',requests[1].effectId.startsWith('manual-') && ship.flags[M].starship.effects.length===0);
manager.element.querySelector('[data-action=add]').click();await flush();config=document.querySelector('dialog form');
config.elements.kind.value='penalty';config.elements.kind.dispatchEvent(new Event('change',{bubbles:true}));config.elements.statistic.value='dc';
check('numeric-negative-and-no-immunity',config.elements.modifierValue.value==='-1' && config.elements.ignoreImmunities.disabled);
config.querySelector('[type=submit]').click();await flush();target=document.querySelector('form.tsc-effect-targets');
target.elements.entire.click();target.querySelector('[type=submit]').click();await flush();
check('empty-rejected-without-write',requests.length===2 && !target.elements.entire.validity.valid && !!target.querySelector('[data-effect-error]').textContent);
const ac=target.querySelector('[name=mechanics][value=ac]');ac.click();
check('selection-clears-validity',target.elements.entire.validity.valid && !target.querySelector('[data-effect-error]').textContent);
target.querySelector('[type=submit]').click();await flush();
check('independent-dc-only-target',requests.length===3 && requests[2].input.statistic==='dc' && !requests[2].input.targets.entire && requests[2].input.targets.mechanics.join()==='ac');finishApply();await flush();
manager.element.querySelector('[data-action=add]').click();await flush();config=document.querySelector('dialog form');config.elements.kind.value='persistent-damage';config.elements.kind.dispatchEvent(new Event('change',{bubbles:true}));
check('native-persistent-defaults',config.elements.dc.value==='15' && config.elements.formula.value==='1d6' && !config.elements.criticalHit.checked);
config.querySelector('[type=submit]').click();await flush();target=document.querySelector('form.tsc-effect-targets');target.querySelector('[data-action=cancel]').click();await flush();
check('cancel-no-application',requests.length===3 && !target.isConnected);
game.user={id:'p1',isGM:false};check('player-no-manager',openEffectManager(ship)===null);game.user=gm;
const {makeCardRenderer}=await import('${rootUrl}/scripts/chat/attack-card/view.mjs');const {setMapChoice}=await import('${rootUrl}/scripts/chat/attack-card/client.mjs');
const card={status:'open',ship:{name:'Ship'},action:{name:'Strike'},weapon:{name:'Laser'},range:{},map:{current:0,choice:'0',profile:{map1:-5,map2:-10}},targets:[{key:'target',available:true,label:'Target',zone:1,distance:1,effectiveAttackBonus:16}]};
const chat=document.createElement('div');chat.innerHTML=makeCardRenderer({t:key=>game.i18n.localize(key)}).renderAttackCard({flags:{[M]:{attackCard:card}}});document.querySelector('#hosts').append(chat);setMapChoice(chat,'2');check('effective-bonus-map',chat.querySelector('[data-tsc-effective-bonus]').textContent==='+6');
window.effectFixture={manager,ship,requests,notes};
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(result=>result.pass)});
</script></html>`;
  fs.writeFileSync(path.join(out, `effects-${lang}.html`), html);
}
console.log(`Wrote EN/RU effect UI fixtures to ${out}`);
