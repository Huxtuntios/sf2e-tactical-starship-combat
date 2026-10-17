/** Offline browser fixture: native action themes, condition drag/chat, typed damage, client memory. Not live Foundry. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "interaction-smoke");
fs.mkdirSync(out, { recursive: true });
const content = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${rootUrl}/styles/main.css">
<style>body{font:14px Arial;background:#777}.application{width:600px;padding:12px;margin:12px}.sheet-header{display:flex;flex-wrap:wrap}#result{white-space:pre-wrap;color:white;background:#111}</style>
<main id="action" class="application"><section class="window-content"><header class="sheet-header"><h2>Действие станции</h2></header><p>Описание действия</p><input value="Черновик"></section></main>
<main id="inline" class="sf2e-tsc application"><a class="tsc-cond" data-condition="frightened" data-value="2">Напуган 2</a> · <a class="tsc-check" data-inline="@Damage[2d6[fire]]" data-label="2d6 урона огнём">Урон</a></main><pre id="result">waiting</pre>
<script type="module">
const values={starshipSheetTheme:'light',uiState:{}};const messages=[];const calls=[];let opened=0;
globalThis.game={system:{id:'sf2e'},user:{id:'p1'},packs:new Map([['sf2e.conditions',{getIndex:async()=>[{_id:'fear',name:'Frightened',uuid:'Compendium.sf2e.conditions.Item.fear',system:{slug:'frightened'}}]}]]),settings:{get:(m,k)=>values[k],set:async(m,k,v)=>{values[k]=v;calls.push(k)}},i18n:{localize:k=>k.endsWith('.light')?'Светлая':k.endsWith('.dark')?'Тёмная':'Тема листа'}};
globalThis.fromUuid=async()=>({sheet:{render:()=>opened++}});
globalThis.ChatMessage={getSpeaker:()=>({alias:'Operator'}),create:async m=>{messages.push(m);return m}};
class DamageRoll{constructor(formula){this.formula=formula}async evaluate(){this.total=17;return this}async toMessage(data){messages.push({...data,rolls:[this]})}};
globalThis.CONFIG={Dice:{rolls:[DamageRoll]}};globalThis.foundry={utils:{escapeHTML:s=>s.replaceAll('<','&lt;')},applications:{ux:{TextEditor:{implementation:{enrichHTML:async()=>'<a class="content-link">Напуган 2</a>'}}}}};
const {skinActionSheet,isThemedStationAction,refreshActionThemes}=await import('${rootUrl}/scripts/ui/action-sheet-theme.mjs');
const {wireInlineClicks}=await import('${rootUrl}/scripts/ui/inline-clicks.mjs');
const {enrichCondition}=await import('${rootUrl}/scripts/content/condition-enricher.mjs');
const {saveUiState,restoreUiState,wireClientUi}=await import('${rootUrl}/scripts/ui/client-ui.mjs');
const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});const el=document.querySelector('#action');
const item={type:'action',flags:{'sf2e-tactical-starship-combat':{packAction:{actionId:'test'}}}};
skinActionSheet({item},el);skinActionSheet({item},el);check('one-action-theme-picker',el.querySelectorAll('[data-sheet-theme-select]').length===1);
check('action-light',el.dataset.sheetTheme==='light'&&getComputedStyle(el.querySelector('h2')).color==='rgb(23, 43, 69)');
check('ordinary-action-not-skinned',!isThemedStationAction({type:'action',flags:{}}));
const pick=el.querySelector('select');pick.value='dark';pick.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,20));check('action-switch-client-only',el.dataset.sheetTheme==='dark'&&calls.join(',')==='starshipSheetTheme');check('draft-preserved',el.querySelector('input').value==='Черновик');
values.starshipSheetTheme='light';refreshActionThemes();check('action-global-refresh',el.dataset.sheetTheme==='light');
const inline=document.querySelector('#inline');wireInlineClicks(inline);wireInlineClicks(inline);await new Promise(r=>setTimeout(r,20));
const condition=inline.querySelector('.tsc-cond');const drag=new DataTransfer();condition.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:drag}));let data=JSON.parse(drag.getData('text/plain'));check('condition-native-drop',data.type==='Item'&&data.value===2&&data.uuid.endsWith('.fear'));
condition.click();await new Promise(r=>setTimeout(r,20));check('condition-chat-once',messages.length===1&&messages[0].content==='@TscCondition[frightened|value:2]');
condition.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,20));check('condition-open-on-right-click',opened===1);
inline.querySelector('.tsc-check').click();await new Promise(r=>setTimeout(r,20));check('actual-typed-damage',messages.length===2&&messages[1].rolls[0].formula==='{2d6[fire]}'&&messages[1].rolls[0].total===17&&messages[1].flags.sf2e.context.type==='damage-roll');
const enriched=await enrichCondition(['','frightened','2','Напуган 2']);inline.append(enriched);const chatDrag=new DataTransfer();enriched.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:chatDrag}));check('chat-condition-value-preserved',JSON.parse(chatDrag.getData('text/plain')).value===2);
const app={element:el,constructor:{name:'Sheet'},document:{uuid:'Actor.ship'},tab:'stations',tabs:['overview','stations'],position:{width:860,height:700}};wireClientUi(app);check('no-toolbar-injected',!el.querySelector('[data-qol-toolbar],[data-qol-search]'));await saveUiState(app);const again={...app,tab:'overview'};restoreUiState(again);check('client-window-tab-memory',again.tab==='stations'&&again._qolPosition.width===860);
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`;
fs.writeFileSync(path.join(out, "integration.html"), content);
console.log(`Wrote integration fixture to ${out}`);
