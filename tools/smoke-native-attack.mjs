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
globalThis.game={user:{id:'p1',isGM:false},users:{activeGM:{id:'gm'}},i18n:{localize:k=>k},socket:{emit:(...args)=>calls.push(args)}};
globalThis.ui={notifications:{error:()=>{}}};
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
game.user={id:'gm',isGM:true};card.damageRoll={total:5};hooks.renderChatMessageHTML(msg,element);
check('gm-can-apply',element.querySelectorAll('button').length===2 && !!element.querySelector('[data-tsc-attack="apply"]'));
game.user={id:'other',isGM:false};hooks.renderChatMessageHTML(msg,element);
check('other-user-no-buttons',element.querySelectorAll('button').length===0);
check('no-result-copy',element.querySelectorAll('.system-roll').length===1);
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`;
fs.writeFileSync(path.join(out, "native-attack.html"), html);
console.log(`Wrote native attack fixture to ${out}`);
