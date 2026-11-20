/** Browser fixture exercises production delegation with mocked Foundry APIs, not a live Foundry world. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "description-links");
fs.mkdirSync(out, { recursive: true });
const page = `<!doctype html><meta charset="utf-8"><main id="root"></main><pre id="result">waiting</pre>
<script type="module">
const calls=[];
class DamageRoll {constructor(f){this.formula=f} static validate(){return true} async evaluate(){return this} async toMessage(){calls.push(['damage',this.formula])}}
class Roll {constructor(f){this.formula=f} static validate(){return true} async evaluate(){return this} async toMessage(){calls.push(['roll',this.formula])}}
globalThis.Roll=Roll;globalThis.CONFIG={Dice:{rolls:[DamageRoll]}};
const packs={get:()=>null,find:()=>null};
globalThis.game={system:{id:'sf2e'},user:{id:'u',isGM:true},packs,i18n:{localize:k=>k},modules:{get:()=>null}};
globalThis.ChatMessage={getSpeaker:()=>({}),create:async(o)=>calls.push(['chat',o.content])};
globalThis.foundry={utils:{escapeHTML:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;')},applications:{ux:{TextEditor:{implementation:{enrichHTML:async(s)=>s.startsWith('@Check')?'<a data-pf2-check="will">Native check</a>':s.startsWith('@UUID')?'<a class="content-link">Native UUID</a>':s}}}}};
globalThis.ui={notifications:{error:m=>calls.push(['error',m])}};
const {checkLinksHTML}=await import('${rootUrl}/scripts/content/inline-checks.mjs');
const {wireInlineClicks}=await import('${rootUrl}/scripts/ui/inline-clicks.mjs');
const el=document.querySelector('#root');el.innerHTML=checkLinksHTML('@Damage[8d8[fire]]{8d8 fire damage}; [[/r 1d4]]{1d4 days}; @Check[will|dc:20]{Will}; @UUID[Compendium.sf2e.conditions.Item.id]{Dazzled}; frightened 2.');
wireInlineClicks(el);wireInlineClicks(el);
await new Promise(r=>setTimeout(r,40));
const checks=[];const ok=(name,pass)=>checks.push({name,pass:!!pass});
ok('native-check',el.querySelectorAll('[data-pf2-check]').length===1);
ok('native-uuid',el.querySelectorAll('.content-link').length===1);
ok('valued-condition',el.querySelector('a.tsc-cond')?.dataset.value==='2');
el.querySelector('a.tsc-damage').click();await new Promise(r=>setTimeout(r,20));
ok('one-typed-damage',calls.filter(x=>x[0]==='damage').length===1&&calls[0][1]==='{8d8[fire]}');
el.querySelector('a.tsc-dice').click();await new Promise(r=>setTimeout(r,20));
ok('one-normal-roll',calls.filter(x=>x[0]==='roll').length===1&&calls[1][1]==='1d4');
ok('no-automatic-application',calls.length===2);
const untouched=checkLinksHTML('@Damage[999d8[fire]]');ok('unsafe-left-text',!untouched.includes('data-inline'));
const {skinActionSheet}=await import('${rootUrl}/scripts/ui/action-sheet-theme.mjs');
const native=document.createElement('section');document.body.append(native);
native.innerHTML=checkLinksHTML('@Damage[2d6[fire]]{Fire}; @Check[will|dc:34]{Will}; @UUID[Compendium.sf2e.conditions.Item.id]{Condition}; frightened 2.');
const item={type:'action',flags:{'sf2e-tactical-starship-combat':{packAction:{actionId:'inline:ability'}}}};
skinActionSheet({item},native);skinActionSheet({item},native);
await new Promise(r=>requestAnimationFrame(r));
ok('native-item-check',!!native.querySelector('[data-pf2-check]'));
ok('native-item-uuid',!!native.querySelector('.content-link'));
const before=calls.length;
native.querySelector('a.tsc-damage').click();await new Promise(r=>requestAnimationFrame(r));
ok('native-item-damage-once',calls.length===before+1&&calls.at(-1)[1]==='{2d6[fire]}');
ok('native-item-condition-draggable',native.querySelector('a.tsc-cond')?.draggable);
const ordinary=document.createElement('section');skinActionSheet({item:{type:'action',flags:{}}},ordinary);
ok('other-items-untouched',!ordinary.dataset.tscInlineClicks);
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`;
fs.writeFileSync(path.join(out, "description-links.html"), page);
console.log(`Wrote description links fixture to ${out}`);
