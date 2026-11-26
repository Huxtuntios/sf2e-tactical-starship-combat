import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, loadLang, makeShip } from "../tests/helpers/foundry-mock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "dist", "ui-tests", "strike-traits"));
fs.mkdirSync(out, { recursive: true });
const rootUrl = pathToFileURL(root).href;
const template = fs.readFileSync(path.join(root, "templates", "strike-traits.hbs"), "utf8");
const editorTemplate = fs.readFileSync(path.join(root, "templates", "ship-editor.hbs"), "utf8");
const nativeCatalogs = {
  weaponTraits: { agile: "SF2eTSC.traits.agile", tech: "SF2eTSC.traits.tech" },
  npcAttackTraits: { unarmed: "SF2eTSC.traits.unarmed" },
  actionTraits: { attack: "SF2eTSC.traits.attack", manipulate: "SF2eTSC.traits.manipulate" },
  vehicleTraits: { starship: "SF2eTSC.traits.starship", area: "SF2eTSC.traits.area" }
};

for (const lang of ["en", "ru"]) {
  installFoundryMock({ lang });
  CONFIG.PF2E = nativeCatalogs;
  await loadContentFromDisk();
  const actor = makeShip({
    id: `strike-trait-ui-${lang}`,
    name: "Strike trait UI fixture",
    role: "npc",
    extra: {
      strikes: [
        {
          name: "Legacy Strike",
          kind: "ranged",
          attack: 7,
          damage: "1d6 fire",
          traits: ["agile", "legacy custom trait"]
        }
      ]
    }
  });
  const { buildSheetContext } = await import("../scripts/ui/sheet/sheet-context.mjs");
  const context = await buildSheetContext({ document: actor, isNpc: true, tab: "config", tabs: ["overview", "config"] });
  const h = Handlebars.create();
  h.registerHelper("localize", (key, options) => (options?.hash ? game.i18n.format(key, options.hash) : game.i18n.localize(key)));
  h.registerHelper("eq", (a, b) => a === b);
  const editor = h.compile(editorTemplate)(context);
  const labels = loadLang(lang);
  const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8">
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<style>body{margin:0;padding:12px;background:#777;font:14px Arial}#hosts{max-width:100%}.application{box-sizing:border-box;width:min(520px,100%);padding:12px}#result{font:11px monospace;white-space:pre-wrap;color:#fff;background:#111;padding:8px}</style>
<main id="hosts"></main><div id="existing-editor" hidden>${editor}</div><pre id="result">waiting</pre>
<script src="${rootUrl}/node_modules/handlebars/dist/handlebars.min.js"></script>
<script type="module">
const labels=${JSON.stringify(labels)},templates=${JSON.stringify({ "strike-traits": template })},lang='${lang}',nativeCatalogs=${JSON.stringify(nativeCatalogs)};
let sequence=0;const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
globalThis.game={system:{id:'sf2e'},i18n:{lang,has:key=>Object.hasOwn(labels,key),localize:key=>labels[key]??key,format:(key,data)=>Object.entries(data??{}).reduce((text,[field,value])=>text.replaceAll('{'+field+'}',value),labels[key]??key)}};
globalThis.CONFIG={PF2E:nativeCatalogs};
globalThis.Handlebars=Handlebars;Handlebars.registerHelper('localize',key=>game.i18n.localize(key));
class App {
 constructor(){this.id='strike-traits-'+(++sequence);this.options=this.constructor.DEFAULT_OPTIONS??{};}
 async render(){this.element=document.createElement(this.options.tag??'form');this.element.className='application sf2e-tsc '+(this.options.classes??[]).join(' ');this.element.id=this.id;document.querySelector('#hosts').append(this.element);this.element.addEventListener('submit',event=>{event.preventDefault();this.options.form?.handler?.call(this,event,this.element);});this.element.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button)this.options.actions?.[button.dataset.action]?.call(this,event,button);});const context=await this._prepareContext();this.element.innerHTML=Handlebars.compile(templates['strike-traits'])(context);this._onRender?.(context,{});return this.element;}
 async close(options={}){this._onClose?.(options);this.element?.remove();}
}
globalThis.foundry={applications:{api:{ApplicationV2:App,HandlebarsApplicationMixin:Base=>Base}},utils:{}};
const {StrikeTraitDialog}=await import('${rootUrl}/scripts/ui/strike-trait-dialog.mjs');
const flush=async()=>{for(let index=0;index<8;index++)await Promise.resolve();await new Promise(requestAnimationFrame);};
try {
 let result='pending';const dialog=new StrikeTraitDialog(value=>{result=value;},['agile']);await dialog.render();
 const form=document.querySelector('form.tsc-strike-traits');const search=form.querySelector('[data-strike-trait-search]');const rows=[...form.querySelectorAll('[data-strike-trait-option]')];
 const option=value=>rows.find(row=>row.dataset.strikeTraitOption===value);
 const input=value=>option(value).querySelector('input');
 check('real-dialog-template',!!form&&!!search&&rows.length>20);
 check('catalog-values-unique',new Set(rows.map(row=>row.dataset.strikeTraitOption)).size===rows.length);
 check('initial-selection',input('agile').checked);
 check('localized-trait-label',option('agile').querySelector('span').textContent===(lang==='ru'?'Быстрое':'Agile'));
 check('localized-range-label',option('range increment 4 zones').querySelector('span').textContent===(lang==='ru'?'Шаг дистанции 4 зон':'Range increment 4 zones'));
 check('search-focus',document.activeElement===search&&getComputedStyle(search).outlineStyle!=='none');
 const dialogControls=[...form.querySelectorAll('button,input')];
 check('dialog-controls-named',dialogControls.every(control=>control.getAttribute('aria-label')||control.textContent.trim()||control.closest('label')||control.labels?.length));
 search.value=lang==='ru'?'Быстр':'Agile';search.dispatchEvent(new Event('input'));
 check('search-by-localized-label',rows.filter(row=>!row.hidden).map(row=>row.dataset.strikeTraitOption).join(',')==='agile');
 search.value='not-a-real-trait';search.dispatchEvent(new Event('input'));
 check('search-empty-state',rows.every(row=>row.hidden)&&!form.querySelector('[data-strike-trait-empty]').hidden);
 search.value='';search.dispatchEvent(new Event('input'));
 input('agile').checked=false;input('tech').checked=true;form.querySelector('[type=submit]').click();await flush();
 check('add-remove-selection',JSON.stringify(result)==='["tech"]'&&!form.isConnected);
 let cancelled='pending';const cancelDialog=new StrikeTraitDialog(value=>{cancelled=value;});await cancelDialog.render();document.querySelector('form.tsc-strike-traits [data-action=cancel]').click();await flush();
 check('cancel-without-selection',cancelled===null&&!document.querySelector('form.tsc-strike-traits'));
 const legacy=document.querySelector('#existing-editor [data-list="strikes"][data-key="traits"]');
 check('existing-custom-csv-round-trip',legacy?.value==='agile, legacy custom trait');
} catch(error) {checks.push({name:'fixture-runtime',pass:false,error:error.message});console.error(error);}
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(check=>check.pass)});
</script></html>`;
  fs.writeFileSync(path.join(out, `strike-traits-${lang}.html`), html);
}
console.log(`Wrote Strike trait fixtures to ${out}`);
