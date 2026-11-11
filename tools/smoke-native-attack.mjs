/** Exercise native attack-card augmentation in a browser, without a Foundry server. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? path.join(root, "dist", "native-attack-smoke");
const rootUrl = pathToFileURL(root).href;
fs.mkdirSync(out, { recursive: true });
const html = `<!doctype html><meta charset="utf-8">
<article id="chat"><div class="message-content"><section class="system-roll">System attack: 19</section></div></article>
<pre id="result">waiting</pre>
<script type="module">
const M='sf2e-tactical-starship-combat', hooks={}, calls=[];
globalThis.Hooks={on:(n,f)=>hooks[n]=f};
globalThis.foundry={utils:{randomID:()=>String(Math.random())}};
const gm={id:'gm',isGM:true,active:true};
globalThis.game={user:{id:'p1',isGM:false},users:{activeGM:gm,get:id=>id==='gm'?gm:null},i18n:{localize:k=>k,format:(k,data)=>k+':'+(data?.message??'')},socket:{connected:true,emit:(...args)=>calls.push(args)}};
const errors=[];
globalThis.ui={notifications:{error:message=>errors.push(message)}};
const {registerAttackCards}=await import('${rootUrl}/scripts/chat/attack-card/client.mjs');registerAttackCards();
const checks=[], check=(name,pass)=>checks.push({name,pass:!!pass});
const element=document.querySelector('#chat');
const card={native:true,createdBy:'p1',result:{pendingDamage:{}}};
const msg={id:'m1',flags:{[M]:{attackCard:card}}};
hooks.renderChatMessageHTML(msg,element);hooks.renderChatMessageHTML(msg,element);
check('native-result-preserved',element.querySelector('.system-roll').textContent==='System attack: 19');
check('rerender-single-control',element.querySelectorAll('.tsc-native-attack-controls').length===1 && element.querySelectorAll('button').length===1);
element.querySelector('button').click();element.querySelector('button').click();
check('double-click-one-request',calls.length===1 && calls[0][1].type==='rollAttackCardDamage');
const {dispatchSocketMessage}=await import('${rootUrl}/scripts/socket.mjs');
await dispatchSocketMessage({kind:'response',requestId:calls[0][1].requestId,to:'p1',ok:true,result:{}},'gm',{
  users:game.users,selfId:'p1',isActiveGM:false,clientEvents:new Map(),emit:()=>{}
});
await new Promise(resolve=>setTimeout(resolve,0));
check('response-releases-busy-control',!element.querySelector('button').disabled);
game.user={id:'gm',isGM:true};card.damageRoll={total:5};hooks.renderChatMessageHTML(msg,element);
check('gm-can-apply',element.querySelectorAll('button').length===2 && !!element.querySelector('[data-tsc-attack="apply"]'));
const {registerHandler}=await import('${rootUrl}/scripts/socket.mjs');
const nativeTimeout=globalThis.setTimeout,nativeClear=globalThis.clearTimeout;
let now=0,nextTimer=0,damageCalls=0,finishDamage,reactionExpired=false;
const timers=new Map();
globalThis.setTimeout=(fn,delay)=>{const id=++nextTimer;timers.set(id,{at:now+delay,fn});return id;};
globalThis.clearTimeout=id=>timers.delete(id);
const advance=ms=>{const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
registerHandler('applyAttackCardDamage',()=>{damageCalls++;return new Promise(resolve=>{setTimeout(()=>{reactionExpired=true;},20000);finishDamage=resolve;});});
const apply=element.querySelector('[data-tsc-attack="apply"]');
apply.click();apply.click();
check('local-damage-disables-controls-once',damageCalls===1&&[...element.querySelectorAll('button')].every(b=>b.disabled)&&calls.length===1);
advance(15000);await flush();
check('local-damage-still-busy-at-15s',apply.disabled&&errors.length===0);
advance(5000);await flush();
check('local-damage-still-busy-after-reaction-window',reactionExpired&&apply.disabled&&errors.length===0);
apply.click();check('reaction-wait-cannot-resubmit',damageCalls===1);
finishDamage({ok:true});await flush();
check('local-damage-success-releases-controls',!apply.disabled&&errors.length===0&&timers.size===0);
registerHandler('applyAttackCardDamage',()=>Promise.reject(new Error('damage rejected')));
apply.click();await flush();
check('local-damage-rejection-releases-controls',!apply.disabled&&errors.some(e=>e.includes('damage rejected'))&&timers.size===0);
registerHandler('applyAttackCardDamage',()=>new Promise(resolve=>finishDamage=resolve));
apply.click();advance(119999);await flush();
check('local-damage-wait-remains-bounded',apply.disabled&&timers.size===1);
advance(1);await flush();
check('local-damage-timeout-releases-controls',!apply.disabled&&errors.some(e=>e.includes('SF2eTSC.errors.timeout'))&&timers.size===0);
const errorCount=errors.length;finishDamage({late:true});await flush();
check('local-damage-late-result-does-not-resettle',errors.length===errorCount&&timers.size===0&&!apply.disabled);
globalThis.setTimeout=nativeTimeout;globalThis.clearTimeout=nativeClear;
game.user={id:'other',isGM:false};hooks.renderChatMessageHTML(msg,element);
check('other-user-no-buttons',element.querySelectorAll('button').length===0);
check('no-result-copy',element.querySelectorAll('.system-roll').length===1);
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`;
fs.writeFileSync(path.join(out, "native-attack.html"), html);
console.log(`Wrote native attack fixture to ${out}`);
