/** Production onboarding guide in Chromium with Foundry doubles, not a live world. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Handlebars from "handlebars";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = path.resolve(process.argv[2] ?? path.join(root, "dist", "ui-tests", "onboarding"));
fs.mkdirSync(out, { recursive: true });
const languages = Object.fromEntries(
  ["en", "ru"].map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(root, "lang", `${lang}.json`), "utf8"))])
);
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
let mock = fs.readFileSync(path.join(root, "tests", "helpers", "foundry-mock.mjs"), "utf8");
mock = mock
  .replace(/^import .* from "node:[^"]+";\n/gm, "")
  .replace(/^const ROOT = .*;\n/m, "")
  .replace(/^export const loadLang = .*;$/m, `export const loadLang = lang => flat(${json(languages)}[lang]);`)
  .replace(/export async function loadContentFromDisk\(\) \{[\s\S]*?\n\}/, "");
fs.writeFileSync(path.join(out, "foundry-mock.mjs"), mock);
const compiled = Handlebars.precompile(fs.readFileSync(path.join(root, "templates", "onboarding.hbs"), "utf8"));

for (const lang of ["en", "ru"]) {
  const script = `
import {installFoundryMock,MockUser} from './foundry-mock.mjs';
const gm=new MockUser({id:'gm',name:'GM',isGM:true});
const player=new MockUser({id:'p1',name:'Player'});
const mockCtx=installFoundryMock({lang:'${lang}',users:[gm,player]});
const root=document.querySelector('#app');
const template=Handlebars.template(${compiled});
Handlebars.registerHelper('localize',(key,options)=>game.i18n.format(key,options.hash));
const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
let sequence=0;let renderCount=0;let lastAction=Promise.resolve();
class FixtureApplication {
  constructor(){this.element=root;this.options=this.constructor.DEFAULT_OPTIONS??{};this.id='onboarding-'+(++sequence);this.position={width:880,height:720};this.rendered=false;this.minimized=false;}
  async render(){
    renderCount++;const context=await this._prepareContext();root.innerHTML=template(context);
    if(!this.rendered)this._onFirstRender?.(context,{});
    this.rendered=true;root.classList.toggle('is-minimized',this.minimized);this._onRender?.(context,{});
    foundry.applications.instances.set(this.id,this);return this;
  }
  minimize(){this.minimized=true;root.classList.add('is-minimized');return this;}
  maximize(){this.minimized=false;root.classList.remove('is-minimized');return this;}
  bringToFront(){return this;}
  setPosition(){}
  async close(){this.rendered=false;this.minimized=false;root.classList.remove('is-minimized');root.innerHTML='';foundry.applications.instances.delete(this.id);this._onClose?.({});return this;}
}
foundry.applications.api.ApplicationV2=FixtureApplication;
foundry.applications.instances=new Map();
const {OnboardingGuide}=await import('${rootUrl}/scripts/ui/onboarding.mjs');
const {openOnboarding,autoOpenOnboarding}=await import('${rootUrl}/scripts/ui/launchers.mjs');
let app=await openOnboarding();globalThis.onboardingApp=app;
const tick=async()=>{await lastAction;await new Promise(resolve=>setTimeout(resolve,0));};
root.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(!target||target.disabled)return;const handler=OnboardingGuide.DEFAULT_OPTIONS.actions[target.dataset.action];if(handler)lastAction=Promise.resolve(handler.call(app,event,target));});
const action=async(name)=>{const button=root.querySelector('[data-action="'+name+'"]');if(!button)throw new Error('Missing action '+name);button.click();await tick();};
const showSection=async index=>{await app.goToSection(index);await tick();};
const reopen=async()=>{app=await openOnboarding();globalThis.onboardingApp=app;await tick();};
const current=()=>Number(root.querySelector('[data-onboarding-content]').dataset.currentIndex);
try {
  check('production-template',!!root.querySelector('.tsc-onboarding'));
  check('eight-navigation-buttons',root.querySelectorAll('[data-onboarding-nav] button').length===8);
  check('localized-content',!root.textContent.includes('SF2eTSC.onboarding.'));
  check('session-language',root.querySelector('.tsc-onboarding').lang==='${lang}');
  check('initial-progress',current()===0&&root.querySelector('progress').value===1&&root.querySelector('progress').max===8);
  check('gm-role-content',!!root.querySelector('[data-onboarding-audience="gm"]'));
  mockCtx.setUser('p1');await app.render();await tick();
  check('player-role-content',!root.querySelector('[data-onboarding-audience="gm"]')&&!!root.querySelector('[data-onboarding-audience="player"]'));
  mockCtx.setUser('gm');await app.render();await tick();
  for(let index=0;index<8;index++){
    await showSection(index);
    check('section-localized-'+index,!root.textContent.includes('SF2eTSC.')&&root.querySelectorAll('[data-onboarding-content] > *').length>0);
  }
  await showSection(0);
  await action('next');check('next-navigation',current()===1);
  await root.querySelector('[data-onboarding-nav] button[data-index="4"]').click();await tick();check('quick-jump',current()===4);
  await action('previous');check('previous-navigation',current()===3);
  await action('toggleMinimize');check('minimize-keeps-section',app.minimized&&current()===3);
  app.maximize();check('maximize-keeps-section',!app.minimized&&current()===3);
  const toggle=root.querySelector('[data-auto-open]');toggle.click();await tick();
  check('suppression-toggle-persists',toggle.checked&&game.settings.get('sf2e-tactical-starship-combat','showOnboarding')===false);
  await action('close');check('close-dismisses',!root.querySelector('.tsc-onboarding'));
  await reopen();check('manual-reopen-while-suppressed',!!root.querySelector('.tsc-onboarding')&&current()===0);
  await action('skip');check('skip-dismisses',!root.querySelector('.tsc-onboarding'));
  check('close-and-skip-keep-suppression',game.settings.get('sf2e-tactical-starship-combat','showOnboarding')===false);
  await reopen();root.querySelector('[data-auto-open]').click();await tick();
  check('re-enable-auto-open',game.settings.get('sf2e-tactical-starship-combat','showOnboarding')===true);
  await action('close');autoOpenOnboarding();await tick();app=await openOnboarding();
  check('auto-open-after-ready-call',!!root.querySelector('.tsc-onboarding'));
  const before=renderCount;const [first,second]=await Promise.all([openOnboarding(),openOnboarding()]);
  check('single-instance',first===second&&first===app&&renderCount===before&&document.querySelectorAll('.tsc-onboarding').length===1);
  await showSection(7);
  globalThis.measureOnboarding=()=>{
    const guide=root.querySelector('.tsc-onboarding');
    const nav=root.querySelector('[data-onboarding-nav]');
    const content=root.querySelector('[data-onboarding-content]');
    const bounds=guide.getBoundingClientRect();
    const controls=[...guide.querySelectorAll('button,input')].filter(control=>!control.closest('[data-onboarding-nav]'));
    return {checks:[
      {name:'guide-contained-'+innerWidth,pass:guide.scrollWidth<=guide.clientWidth+1},
      {name:'navigation-contained-'+innerWidth,pass:nav.scrollWidth<=nav.clientWidth+1||getComputedStyle(nav).overflowX==='auto'},
      {name:'content-contained-'+innerWidth,pass:content.scrollWidth<=content.clientWidth+1},
      {name:'controls-contained-'+innerWidth,pass:controls.every(control=>{const r=control.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1;})},
      {name:'content-scrollable-'+innerWidth,pass:['auto','scroll'].includes(getComputedStyle(content).overflowY)}
    ]};
  };
  globalThis.onboardingFixture={app:()=>app,root,checks,showSection,reopen,action,tick};
} catch(error) {checks.push({name:'fixture-runtime',pass:false,error:error.message});console.error(error);}
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(result=>result.pass)});
</script>`;
  const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<style>html,body{margin:0;min-block-size:100%;background:#dae0e8}body{padding:8px;box-sizing:border-box}#app{inline-size:min(900px,100%);block-size:min(720px,calc(100dvh - 16px));margin:auto}#app.application{box-sizing:border-box}#app.is-minimized{block-size:44px}#app.is-minimized .tsc-onboarding-body,#app.is-minimized .tsc-onboarding-footer{display:none}#result{white-space:pre-wrap}</style>
<script src="${rootUrl}/node_modules/handlebars/dist/handlebars.min.js"></script>
<main id="app" class="application sf2e-tsc tsc-onboarding-window"></main><pre id="result">waiting</pre>
<script type="module">${script}</script></html>`;
  fs.writeFileSync(path.join(out, `onboarding-${lang}.html`), html);
}
