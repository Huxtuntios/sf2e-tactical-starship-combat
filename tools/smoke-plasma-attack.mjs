/** Exercise plasma controls on the native attack message in EN and RU, without Foundry. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? path.join(root, "dist", "plasma-attack-smoke");
const rootUrl = pathToFileURL(root).href;
const en = JSON.parse(fs.readFileSync(path.join(root, "lang/en.json"), "utf8"));
const ru = JSON.parse(fs.readFileSync(path.join(root, "lang/ru.json"), "utf8"));
fs.mkdirSync(out, { recursive: true });
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<article id="chat"><div class="message-content"><section class="system-roll">System attack: 19<button data-action="strike-damage">Native damage</button></section></div></article>
<pre id="result">waiting</pre>
<script type="module">
const M='sf2e-tactical-starship-combat', hooks={}, calls=[], en=${JSON.stringify(en)}, ru=${JSON.stringify(ru)};
globalThis.Hooks={on:(n,f)=>{(hooks[n]??=[]).push(f);return f;}};
const render=(...args)=>(hooks.renderChatMessageHTML??[]).forEach(fn=>fn(...args));
globalThis.foundry={utils:{randomID:()=>String(Math.random())}};
const gm={id:'gm',isGM:true,active:true};
let strings=en;
globalThis.game={user:{id:'p1',isGM:false},users:{activeGM:gm,get:id=>id==='gm'?gm:null},i18n:{lang:'en',has:k=>k.split('.').reduce((o,p)=>o?.[p],strings)!=null,localize:k=>k.split('.').reduce((o,p)=>o?.[p],strings)??k,format:(k,data)=>k+':'+(data?.message??'')},socket:{connected:true,emit:(...args)=>calls.push(args)}};
const errors=[];
globalThis.ui={notifications:{error:message=>errors.push(message)}};
const {registerAttackCards}=await import('${rootUrl}/scripts/chat/attack-card/client.mjs');registerAttackCards();
const {dispatchSocketMessage}=await import('${rootUrl}/scripts/socket.mjs');
const respond=index=>dispatchSocketMessage({kind:'response',requestId:calls[index][1].requestId,to:'p1',ok:true,result:{}},'gm',{users:game.users,selfId:'p1',isActiveGM:false,clientEvents:new Map(),emit:()=>{}});
const checks=[], check=(name,pass)=>checks.push({name,pass:!!pass});
const element=document.querySelector('#chat');
const pending={plasma:true,profile:{plasma:true,area:true,shape:{type:'burst',value:2},save:{type:'reflex',basic:true,dc:15}},targets:[{targetUuid:'Actor.one',targetKey:'Actor.one'},{targetUuid:'Actor.two',targetKey:'Actor.two'}],save:{type:'reflex',basic:true,dc:15}};
const card={native:true,createdBy:'p1',result:{pendingDamage:pending}};
const msg={id:'m1',flags:{[M]:{attackCard:card}}};
render(msg,element);render(msg,element);
check('native-result-preserved',element.querySelector('.system-roll').textContent.includes('System attack: 19'));
check('native-damage-control-replaced',!element.querySelector('[data-action="strike-damage"]'));
check('single-plasma-control-host',element.querySelectorAll('.tsc-native-attack-controls').length===1);
check('damage-and-save-controls',element.querySelectorAll('[data-tsc-attack="damage"]').length===1&&element.querySelectorAll('[data-tsc-attack="save"]').length===1);
check('shape-visible',element.querySelector('.tsc-native-attack-controls').textContent.includes('Burst 2 zones'));
element.querySelector('[data-tsc-attack="save"]')?.click();element.querySelector('[data-tsc-attack="save"]')?.click();
check('double-save-one-request',calls.length===1&&calls[0]?.[1]?.type==='rollAttackCardSaves');
await respond(0);await new Promise(resolve=>setTimeout(resolve,0));
element.querySelector('[data-tsc-attack="damage"]')?.click();element.querySelector('[data-tsc-attack="damage"]')?.click();
check('double-damage-one-request',calls.length===2&&calls[1]?.[1]?.type==='rollAttackCardDamage');
card.damageRoll={total:8,formula:'1d6'};card.saveRolls=[{targetUuid:'Actor.one',degree:2,multiplier:0.5},{targetUuid:'Actor.two',degree:1,multiplier:1}];
game.user={id:'gm',isGM:true};render(msg,element);
check('gm-apply-after-rolls',element.querySelectorAll('[data-tsc-attack="apply"]').length===1);
const noSave={...pending,profile:{...pending.profile,area:false,shape:{type:'single',value:null},save:null},save:null};
card.result.pendingDamage=noSave;delete card.saveRolls;render(msg,element);
check('non-area-no-save-control',element.querySelectorAll('[data-tsc-attack="damage"]').length===1&&!element.querySelector('[data-tsc-attack="save"]'));
card.result.pendingDamage=pending;strings=ru;game.i18n.lang='ru';game.user={id:'p1',isGM:false};render(msg,element);
check('ru-labels',element.querySelector('.tsc-native-attack-controls').textContent.includes('Урон')&&element.querySelector('.tsc-native-attack-controls').textContent.includes('Спасбросок')&&element.querySelector('.tsc-native-attack-controls').textContent.includes('Взрыв'));
game.messages=new Map();game.user={id:'p1',isGM:false,targets:new Set([{actor:{uuid:'Actor.one'}},{actor:{uuid:'Actor.two'}}])};
const moduleElement=document.createElement('div');moduleElement.innerHTML='<article class="tsc-attack-card"></article>';
const moduleCard={status:'open',createdBy:'p1',ship:{name:'Attacker',uuid:'Actor.ship',role:'player'},crew:null,station:null,action:{id:'strike',name:'Strike',builtin:'strike'},weapon:{name:'Plasma cannon',profile:{plasma:true,area:true,shape:{type:'burst',value:1},save:{type:'reflex',basic:true,dc:null,source:'crew'}}},range:{zones:6},targets:[{key:'Actor.one',actorUuid:'Actor.one',label:'One',available:true},{key:'Actor.two',actorUuid:'Actor.two',label:'Two',available:true}],result:null};
const moduleMessage={id:'module',flags:{[M]:{attackCard:moduleCard}}};render(moduleMessage,moduleElement);
moduleElement.querySelector('[data-tsc-attack="resolve"]')?.click();
const resolveCall=calls.at(-1)?.[1];
check('module-card-binds-current-targets',resolveCall?.type==='resolveAttackCard'&&JSON.stringify(resolveCall.payload.targetUUIDs)===JSON.stringify(['Actor.one','Actor.two']));
check('no-errors',errors.length===0);
globalThis.showPlasmaLanguage=lang=>{strings=lang==='ru'?ru:en;game.i18n.lang=lang;game.user={id:'p1',isGM:false};delete card.damageRoll;delete card.saveRolls;card.result.pendingDamage=pending;render(msg,element);};
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`;
fs.writeFileSync(path.join(out, "plasma-attack.html"), html);
console.log(`Wrote plasma attack fixture to ${out}`);
