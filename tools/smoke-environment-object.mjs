import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = path.resolve(process.argv[2] ?? path.join(root, "dist", "ui-tests", "environment-object"));
fs.mkdirSync(out, { recursive: true });
const locales = {
  en: JSON.parse(fs.readFileSync(path.join(root, "lang", "en.json"), "utf8")),
  ru: JSON.parse(fs.readFileSync(path.join(root, "lang", "ru.json"), "utf8"))
};
const fixture = `<!doctype html><meta charset="utf-8"><style>
body{font:14px Arial;padding:24px}.form-group{display:flex;flex-direction:column;margin:8px 0}
.tsc-object-form-error{color:#c00}#result{margin-top:16px}
</style><main id="tests"></main><pre id="result">waiting</pre>
<script type="module">
import {legacyEnvironmentObjectDialogContent,submitLegacyEnvironmentObject} from '${rootUrl}/scripts/ui/legacy-environment-object-dialog.mjs';
const locales=${JSON.stringify(locales)};
const typeIds=['asteroid','station','debris','beacon','planet','custom'];
const checks=[];const created=[];
const localize=(lang,key,data={})=>{const value=key.split('.').reduce((obj,part)=>obj?.[part],locales[lang])??key;return String(value).replace(/\\{(\\w+)\\}/g,(token,name)=>name in data?String(data[name]):token)};
function createDialog(lang,initialType){
 const options=typeIds.map(id=>({id,label:localize(lang,'SF2eTSC.objectTypes.'+id)}));
 const content=legacyEnvironmentObjectDialogContent({nameLabel:localize(lang,'SF2eTSC.ui.name'),typeLabel:localize(lang,'SF2eTSC.ui.type'),zoneLabel:localize(lang,'SF2eTSC.ui.zone'),errorLabel:localize(lang,'SF2eTSC.ui.customObjectNameRequired'),typeOptions:options});
 const section=document.createElement('section');section.innerHTML='<form>'+content+'<button type="button">Add</button></form>';
 const form=section.querySelector('form'), button=form.querySelector('button'), error=form.querySelector('[role="alert"]');
 form.elements.type.value=initialType;
 const state={closed:false,renders:0};
 const dialog={element:section,close:async()=>{state.closed=true}};
 const app={render:()=>{state.renders++}};
 const optionsForSubmit={dialog,app,combat:{id:'fixture'},existingObjects:()=>[],localize:(key,data)=>localize(lang,key,data),
   addCustom:async(combat,name,zone)=>created.push({kind:'custom',name,zone}),
   addPublic:async(combat,object)=>created.push({kind:'public',...object})};
 button.addEventListener('click',()=>submitLegacyEnvironmentObject(Object.fromEntries(new FormData(form)),optionsForSubmit));
 document.querySelector('#tests').append(section);
 return {form,button,error,state};
}
globalThis.foundry={utils:{escapeHTML:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}};
const ruCustom=createDialog('ru','custom');ruCustom.form.elements.name.value='   ';ruCustom.button.click();await new Promise(r=>setTimeout(r,0));
checks.push({name:'blank-custom-shows-translated-inline-error-and-keeps-form-open',pass:!ruCustom.error.hidden&&ruCustom.error.textContent===localize('ru','SF2eTSC.ui.customObjectNameRequired')&&!ruCustom.state.closed&&ruCustom.form.elements.name.value==='   '});
const ruStandard=[];
for(const type of typeIds.slice(0,-1)){const dialog=createDialog('ru',type);dialog.form.elements.name.value='';dialog.button.click();await new Promise(r=>setTimeout(r,0));ruStandard.push({dialog,type})}
checks.push({name:'blank-standard-creates-every-localized-russian-type-and-closes',pass:ruStandard.every(({dialog,type})=>dialog.state.closed&&created.some(x=>x.kind==='public'&&x.type===type&&x.name===localize('ru','SF2eTSC.ui.environmentObjectFallback',{type:localize('ru','SF2eTSC.objectTypes.'+type),number:1})))});
const enStandard=[];
for(const type of typeIds.slice(0,-1)){const dialog=createDialog('en',type);dialog.form.elements.name.value='';dialog.button.click();await new Promise(r=>setTimeout(r,0));enStandard.push({dialog,type})}
checks.push({name:'blank-standard-creates-every-localized-english-type-and-closes',pass:enStandard.every(({dialog,type})=>dialog.state.closed&&created.some(x=>x.kind==='public'&&x.type===type&&x.name===localize('en','SF2eTSC.ui.environmentObjectFallback',{type:localize('en','SF2eTSC.objectTypes.'+type),number:1})))});
const namedCustom=createDialog('en','custom');namedCustom.form.elements.name.value='Emergency buoy';namedCustom.button.click();await new Promise(r=>setTimeout(r,0));
checks.push({name:'named-custom-creates-and-closes',pass:namedCustom.state.closed&&created.some(x=>x.kind==='custom'&&x.name==='Emergency buoy')});
const result={checks,passed:checks.every(c=>c.pass)};
document.querySelector('#result').textContent=JSON.stringify(result);
</script>`;
fs.writeFileSync(path.join(out, "environment-object.html"), fixture);
console.log(`Wrote environment-object UI fixture to ${out}`);
