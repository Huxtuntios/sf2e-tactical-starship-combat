/** Локальная DOM-проверка производственного обработчика; не заменяет запуск Toolbelt в Foundry. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? path.join(root, "dist", "toolbelt-smoke");
const rootUrl = pathToFileURL(root).href;
fs.mkdirSync(out, { recursive: true });
const translations = JSON.parse(fs.readFileSync(path.join(root, "lang", "ru.json"), "utf8")).SF2eTSC.toolbelt;
const content = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<style>body{background:#eee;color:#222;font:14px Arial;padding:20px}.damage-application{margin:12px;padding:12px;border:1px solid #888;max-width:430px}button{min-height:28px}</style>
<main id="chat">
<section class="damage-application" id="ship" data-target-uuid="Scene.a.Token.ship" data-target-roll-index="0">
<strong>Звездолёт</strong><button data-action="target-applyDamage" data-multiplier="1">Урон</button><button data-action="target-applyDamage" data-multiplier="0.5">Половина</button><button data-action="target-shieldBlock">Блок щитом</button></section>
<section class="damage-application" id="ordinary" data-target-uuid="Scene.a.Token.pc" data-target-roll-index="0"><strong>Обычный персонаж</strong><button data-action="target-applyDamage" data-multiplier="1">Урон</button></section>
<section class="damage-application" id="base" data-roll-index="0"><strong>Выбранные токены</strong><button data-action="applyDamage" data-multiplier="1">Урон</button></section>
</main><pre id="result">waiting</pre>
<script type="module">
const M='sf2e-tactical-starship-combat';const texts=${JSON.stringify(translations)};const calls=[];const warnings=[];let nativeClicks=0;
const ship={uuid:'Actor.ship',flags:{[M]:{starship:{isStarship:true}}}};const pc={uuid:'Actor.pc',flags:{}};
const shipToken={uuid:'Scene.a.Token.ship',actor:ship};const pcToken={uuid:'Scene.a.Token.pc',actor:pc};
const targets=new Map([[shipToken.uuid,shipToken],[pcToken.uuid,pcToken]]);
let selection=[shipToken];globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:k=>texts[k.split('.').at(-1)]??k}};
globalThis.ui={notifications:{info:()=>{},warn:m=>warnings.push(m)}};
const {wireToolbeltDamage}=await import('${rootUrl}/scripts/integrations/toolbelt-damage.mjs');
const message={id:'damage1',flags:{}};const el=document.querySelector('#chat');
const send=async(type,payload)=>{calls.push({type,...payload});const actor=targets.get(payload.targetUuid).actor;actor.flags[M].chatDamageApplications=[{key:message.id+':'+payload.rollIndex}];};
const binding=wireToolbeltDamage(message,el,{send,selected:()=>selection,resolve:uuid=>targets.get(uuid)});
el.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>nativeClicks++));
const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});const wait=()=>new Promise(r=>setTimeout(r,25));
const shipRow=el.querySelector('#ship');const reset=()=>{ship.flags[M].chatDamageApplications=[];binding.refresh();};
check('two-ship-modes',shipRow.querySelectorAll('[data-tsc-ship-damage]').length===2);
check('ordinary-row-untouched',!el.querySelector('#ordinary .tsc-ship-damage-controls'));
check('no-duplicate-wiring',wireToolbeltDamage(message,el)===null&&shipRow.querySelectorAll('[data-tsc-ship-damage]').length===2);
shipRow.querySelector('[data-action="target-applyDamage"]').click();await wait();
check('native-toolbelt-captured-once',calls.length===1&&calls[0].mode==='shields'&&nativeClicks===0);
check('receipt-disables-modes',shipRow.querySelector('[data-tsc-ship-damage]').disabled);
reset();shipRow.querySelector('select').value='0.5';shipRow.querySelector('[data-tsc-ship-damage="hull"]').click();await wait();
check('direct-hull-half',calls.length===2&&calls[1].mode==='hull'&&calls[1].multiplier===0.5);
reset();shipRow.querySelector('[data-multiplier="0.5"]').click();await wait();
check('native-half-through-shields',calls.length===3&&calls[2].mode==='shields'&&calls[2].multiplier===0.5&&nativeClicks===0);
el.querySelector('#ordinary button').click();await wait();
check('ordinary-native-listener-preserved',nativeClicks===1&&calls.length===3);
reset();const late=document.createElement('section');late.className='damage-application';late.dataset.targetUuid=shipToken.uuid;late.dataset.targetRollIndex='1';late.innerHTML='<button data-action="target-applyDamage" data-multiplier="1">Урон 2</button>';el.append(late);await wait();
check('late-toolbelt-row-observed',late.querySelectorAll('[data-tsc-ship-damage]').length===2);
selection=[shipToken,pcToken];binding.refresh();const before=calls.length;el.querySelector('#base [data-action]').click();await wait();
check('mixed-base-selection-blocked',calls.length===before&&nativeClicks===1&&warnings.length===1);
selection=[shipToken];binding.refresh();el.querySelector('#base [data-action]').click();await wait();
check('native-base-ship-routed',calls.length===before+1&&nativeClicks===1);
reset();shipRow.querySelector('[data-action="target-shieldBlock"]').click();await wait();
check('personal-shield-not-ship-shields',calls.length===before+1&&warnings.length===2);
binding.close();const closed=document.createElement('section');closed.className='damage-application';closed.dataset.targetUuid=shipToken.uuid;el.append(closed);await wait();
check('observer-cleanup',!closed.querySelector('.tsc-ship-damage-controls'));
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(check=>check.pass)});
</script>`;
fs.writeFileSync(path.join(out, "toolbelt.html"), content);
console.log(`Wrote Toolbelt damage fixture to ${out}`);
