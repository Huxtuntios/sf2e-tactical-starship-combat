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
const ruStandard=createDialog('ru','asteroid');ruStandard.form.elements.name.value='';ruStandard.form.elements.zone.value='4';ruStandard.button.click();await new Promise(r=>setTimeout(r,0));
checks.push({name:'blank-standard-creates-localized-display-name-and-closes',pass:created.some(x=>x.kind==='public'&&x.name==='Астероид 1'&&x.type==='asteroid'&&x.zone===4)&&ruStandard.state.closed});
const enStandard=createDialog('en','beacon');enStandard.button.click();await new Promise(r=>setTimeout(r,0));
checks.push({name:'english-standard-fallback-label-is-translated',pass:created.some(x=>x.kind==='public'&&x.name==='Drift beacon 1'&&x.type==='beacon')&&enStandard.state.closed});
const result={checks,passed:checks.every(c=>c.pass)};
document.querySelector('#result').textContent=JSON.stringify(result);
</script>`;
fs.writeFileSync(path.join(out, "environment-object.html"), fixture);
console.log(`Wrote environment-object UI fixture to ${out}`);
