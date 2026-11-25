/** Render production templates in local Chromium. These checks do not replace a live Foundry world. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { loadLang } from "../tests/helpers/foundry-mock.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "ui-tests");
fs.mkdirSync(out, { recursive: true });
const allFixtures = [
  ["smoke-sheet-theme.mjs", "sheets"],
  ["smoke-mine-modification.mjs", "mine-modification"],
  ["smoke-mine-targets.mjs", "mine-targets"],
  ["smoke-drone-soft.mjs", "drone-soft"],
  ["smoke-qol.mjs", "interaction"],
  ["smoke-window-themes.mjs", "windows"],
  ["smoke-map-appearance.mjs", "map"],
  ["smoke-environment-object.mjs", "environment-object"],
  ["smoke-sensor-drop.mjs", "sensor-drop"],
  ["smoke-sensor-performance.mjs", "sensor-performance"],
  ["smoke-contact-editor.mjs", "contact-editor"],
  ["smoke-start-wizard.mjs", "start-wizard"],
  ["smoke-crew-stations.mjs", "crew-stations"],
  ["smoke-builder-history.mjs", "builder-history"],
  ["smoke-toolbelt-damage.mjs", "toolbelt"],
  ["smoke-native-attack.mjs", "native-attack"],
  ["smoke-plasma-attack.mjs", "plasma-attack"],
  ["smoke-chat-card-layout.mjs", "chat-card-layout"],
  ["smoke-action-controls.mjs", "action-controls"],
  ["smoke-description-links.mjs", "description-links"],
  ["smoke-compact-ui.mjs", "compact-ui"],
  ["smoke-starship-defense-editor.mjs", "defense-editor"],
  [null, "effect-targets"]
];
const fixtures = process.env.TSC_UI_FOLDER
  ? allFixtures.filter(([, folder]) => fixturesMatch(folder, process.env.TSC_UI_FOLDER))
  : allFixtures;
function fixturesMatch(folder, filter) {
  return filter.split(",").includes(folder);
}
function writeEffectTargetFixtures() {
  const folder = path.join(out, "effect-targets");
  const template = fs.readFileSync(path.join(root, "templates", "effect-targets.hbs"), "utf8");
  const rootUrl = pathToFileURL(root).href;
  fs.mkdirSync(folder, { recursive: true });
  for (const fixture of [
    { name: "effect-targets-en", lang: "en", width: 1100 },
    { name: "effect-targets-ru", lang: "ru", width: 1100 },
    { name: "effect-targets-ru-600", lang: "ru", width: 600 },
    { name: "effect-targets-ru-380", lang: "ru", width: 380 }
  ]) {
    const labels = loadLang(fixture.lang);
    const html = `<!doctype html><html lang="${fixture.lang}"><meta charset="utf-8">
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<style>body{padding:1rem;background:#dae0e8}#hosts{width:620px;max-width:100%}.application{width:100%;max-width:100%;height:650px;padding:1rem;box-sizing:border-box}.tsc-effect-target-groups{min-block-size:0}#result{white-space:pre-wrap}</style>
<script src="${rootUrl}/node_modules/handlebars/dist/handlebars.min.js"></script>
<main id="hosts"></main><pre id="result">waiting</pre>
<script type="module">
const M='sf2e-tactical-starship-combat',labels=${JSON.stringify(labels)},templates=${JSON.stringify({ "effect-targets": template })},lang='${fixture.lang}',fixtureWidth=${fixture.width};
let sequence=0;const checks=[],requests=[],notes=[];
const check=(name,pass)=>checks.push({name,pass:!!pass});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();await new Promise(requestAnimationFrame);};
const gm={id:'gm',isGM:true,active:true};const users=new Map([['gm',gm]]);users.activeGM=gm;
const settings={starshipSheetTheme:'light',uiState:{}};
globalThis.game={system:{id:'sf2e'},user:gm,users,actors:new Map(),combats:[],combat:null,time:{worldTime:100},modules:new Map(),settings:{get:(_m,k)=>settings[k],set:async(_m,k,v)=>settings[k]=v},i18n:{lang,has:k=>Object.hasOwn(labels,k),localize:k=>labels[k]??k,format:(k,data)=>Object.entries(data??{}).reduce((text,[key,value])=>text.replaceAll('{'+key+'}',value),labels[k]??k)},socket:{connected:true}};
globalThis.ui={notifications:{info:text=>notes.push(text),warn:text=>notes.push(text),error:text=>notes.push(text)}};
globalThis.Hooks={on:()=>1,off:()=>{},callAll:()=>{}};
globalThis.CONFIG={PF2E:{skills:{},damageTypes:{}}};
globalThis.fromUuidSync=()=>null;globalThis.fromUuid=async()=>null;
const esc=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class App {
 constructor(){this.options=this.constructor.DEFAULT_OPTIONS??{};this.id='effect-targets-'+(++sequence);}
 async render(){const context=await this._prepareContext();const name=this.constructor.PARTS.body.template.split('/').pop().replace('.hbs','');if(!this.element){this.element=document.createElement(this.options.tag??'form');this.element.className='application sf2e-tsc '+(this.options.classes??[]).join(' ');this.element.id=this.id;document.querySelector('#hosts').append(this.element);this.element.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button)this.options.actions?.[button.dataset.action]?.call(this,event,button);});this.element.addEventListener('submit',event=>{event.preventDefault();this.options.form?.handler.call(this,event,this.element);});}this.element.innerHTML=Handlebars.compile(templates[name])(context);this.rendered=true;this._onRender?.(context,{});return this;}
 async close(){this.rendered=false;this._onClose?.({});this.element?.remove();}
 setPosition(){} bringToFront(){}
}
globalThis.foundry={utils:{randomID:()=>String(++sequence).padStart(16,'0'),escapeHTML:esc},applications:{api:{ApplicationV2:App,HandlebarsApplicationMixin:Base=>Base},ux:{TextEditor:{implementation:{enrichHTML:async text=>text}}}}};
Handlebars.registerHelper('localize',key=>game.i18n.localize(key));
const longLabel=lang==='ru'?'Очень длинное название выбранной цели эффекта '.repeat(5):'Very long selected effect target label '.repeat(5);
const ship={uuid:'Actor.ship'};
const catalog={mechanics:['ac','saves','attacks'],stations:[{id:'gun',label:longLabel,actions:[{id:'strike',label:longLabel}]}],weapons:[{id:'laser',label:longLabel}],crew:[{uuid:'Actor.pilot',label:longLabel}]};
const {EffectTargetDialog}=await import('${rootUrl}/scripts/ui/effect-target-dialog.mjs');
const {registerHandler}=await import('${rootUrl}/scripts/socket.mjs');
registerHandler('applyManualEffect',({payload})=>{requests.push(payload);return {status:'applied',applicationId:'fixture-application'};});
const createDialog=()=>{const dialog=Object.create(EffectTargetDialog.prototype);Object.assign(dialog,{id:'effect-targets-'+(++sequence),actor:ship,input:{kind:'bonus',label:longLabel,modifiers:[{selector:'ac',type:'status',value:2}],statistic:'check',operationId:'fixture-'+(++sequence)},catalog,onApplied:null,busy:false,options:EffectTargetDialog.DEFAULT_OPTIONS});return dialog;};
try {
 const dialog=createDialog();await dialog.render();const target=document.querySelector('form.tsc-effect-targets');const entire=target.elements.entire;
 check('real-template-and-catalog',!!target && target.querySelectorAll('fieldset').length===6 && target.querySelectorAll('[name=stations]').length===1);
 check('entire-starship-default',entire.checked && target.querySelector('[data-target-summary]').textContent===game.i18n.localize('SF2eTSC.effects.targets.entire'));
 check('initial-target-focus',document.activeElement===entire);
 check('apply-and-cancel-controls',!!target.querySelector('[type=submit]') && !!target.querySelector('[data-action=cancel]'));
 entire.click();target.querySelector('[type=submit]').click();await flush();
 check('no-target-validation',requests.length===0 && !entire.validity.valid && !!target.querySelector('[data-effect-error]').textContent);
 const station=target.querySelector('[name=stations]');station.click();await flush();
 check('target-summary-update',target.querySelector('[data-target-summary]').textContent.includes(longLabel) && entire.validity.valid && !target.querySelector('[data-effect-error]').textContent);
 const contained=()=>target.scrollWidth<=target.clientWidth+1 && target.querySelector('.tsc-effect-target-groups').scrollWidth<=target.querySelector('.tsc-effect-target-groups').clientWidth+1 && [...target.querySelectorAll('.tsc-effect-choice label')].every(label=>label.getBoundingClientRect().right<=target.getBoundingClientRect().right+1);
 check('long-label-contained-'+fixtureWidth,contained());
 target.querySelector('[type=submit]').click();await flush();
 check('apply-once',requests.length===1 && requests[0].input.targets.stations.length===1 && !requests[0].input.targets.entire && !target.isConnected);
 const preview=createDialog();await preview.render();window.effectTargetFixture={requests,longLabel,noTargets:game.i18n.localize('SF2eTSC.effects.errors.noTargets')};
} catch(error) {checks.push({name:'fixture-runtime',pass:false,error:error.message});console.error(error);}
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(result=>result.pass)});
</script></html>`;
    fs.writeFileSync(path.join(folder, `${fixture.name}.html`), html);
  }
}
for (const [tool, folder] of fixtures) {
  if (!tool) continue;
  const result = spawnSync(process.execPath, [path.join(root, "tools", tool), path.join(out, folder)], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Fixture generation failed: ${tool}`);
}
if (fixtures.some(([, folder]) => folder === "effect-targets")) writeEffectTargetFixtures();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--allow-file-access-from-files", "--no-sandbox"]
});
const results = [];
try {
  for (const [, folder] of fixtures)
    for (const name of fs.readdirSync(path.join(out, folder)).filter((f) => f.endsWith(".html"))) {
      const targetWidth = folder === "effect-targets" ? Number(/-(\d+)\.html$/.exec(name)?.[1] ?? 1100) : 1100;
      const page = await browser.newPage({ viewport: { width: targetWidth, height: 950 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.join(out, folder, name)).href);
      if (folder === "compact-ui") {
        await page.waitForFunction(() => typeof globalThis.measureCompact === "function");
        const measurements = [];
        for (const width of [1100, 600, 380]) {
          await page.setViewportSize({ width, height: 950 });
          const measurement = await page.evaluate(() => globalThis.measureCompact());
          measurements.push({ width, ...measurement });
          await page.screenshot({ path: path.join(out, folder, name.replace(/\.html$/, `-${width}.png`)) });
        }
        const checks = measurements.flatMap((measurement) => measurement.checks);
        results.push({ file: `${folder}/${name}`, passed: checks.every((check) => check.pass), errors, measurements });
        await page.close();
        continue;
      }
      // The appearance forms are static previews; every other fixture exposes explicit assertions.
      if (name.startsWith("form-")) {
        const formCount = await page.locator("form").count();
        let passed = formCount === 1;
        if (folder === "map" && name.startsWith("form-object")) {
          const arrowAppearanceOptions = await page
            .locator('select[name="arrowAppearanceMode"] option')
            .evaluateAll((options) => options.map((option) => option.value));
          const mirrorOptions = await page
            .locator('select[name="autoMirrorOverride"] option')
            .evaluateAll((options) => options.map((option) => option.value));
          const arrowFields = await page
            .locator('input[name="arrowImage"], input[name="arrowSize"], input[name="arrowGap"], input[name="arrowOpacity"]')
            .count();
          const resetEnabled = !(await page.locator('[data-action="resetArrowAppearance"]').isDisabled());
          const isOverride = name.includes("form-object-override");
          const values = await page
            .locator('input[name="arrowImage"], input[name="arrowSize"], input[name="arrowGap"], input[name="arrowOpacity"]')
            .evaluateAll((inputs) => inputs.map((input) => input.value));
          const selectedMode = await page.locator('select[name="arrowAppearanceMode"]').inputValue();
          passed =
            passed &&
            mirrorOptions.includes("inherit") &&
            mirrorOptions.includes("on") &&
            mirrorOptions.includes("off") &&
            arrowAppearanceOptions.includes("inherit") &&
            arrowAppearanceOptions.includes("override") &&
            arrowFields === 4 &&
            resetEnabled &&
            selectedMode === (isOverride ? "override" : "inherit") &&
            values.join("|") === (isOverride ? "object-arrow.webp|31|8|0.4" : "global-arrow.webp|22|5|0.75");
        }
        results.push({ file: `${folder}/${name}`, passed, errors });
      } else {
        await page.waitForFunction(
          () => {
            const result = globalThis.document.querySelector("#result");
            return result && result.textContent !== "waiting";
          },
          null,
          { timeout: 10000 }
        );
        const result = JSON.parse(await page.locator("#result").innerText());
        if (folder === "effect-targets") {
          const base = name.replace(/-(\d+)\.html$/, "").replace(/\.html$/, "");
          await page.screenshot({ path: path.join(out, folder, `${base}-${targetWidth}.png`) });
          const entire = page.locator('[name="entire"]');
          await entire.focus();
          const keyboardFocus = await entire.evaluate(
            (element) => globalThis.document.activeElement === element && globalThis.getComputedStyle(element).outlineStyle !== "none"
          );
          await entire.press("Space");
          const keyboardSummary = await page.evaluate(() => {
            const fixture = globalThis.effectTargetFixture;
            return (
              !globalThis.document.querySelector('[name="entire"]').checked &&
              globalThis.document.querySelector("[data-target-summary]").textContent === fixture.noTargets
            );
          });
          const beforeCancel = await page.evaluate(() => globalThis.effectTargetFixture.requests.length);
          const cancel = page.locator('[data-action="cancel"]');
          await cancel.focus();
          const cancelFocus = await cancel.evaluate(
            (element) => globalThis.document.activeElement === element && globalThis.getComputedStyle(element).outlineStyle !== "none"
          );
          await cancel.press("Enter");
          await page.waitForFunction(() => !globalThis.document.querySelector("form.tsc-effect-targets"));
          const cancelWithoutApply = await page.evaluate((count) => globalThis.effectTargetFixture.requests.length === count, beforeCancel);
          result.checks.push(
            { name: "keyboard-target-focus", pass: keyboardFocus },
            { name: "keyboard-target-summary", pass: keyboardSummary },
            { name: "keyboard-cancel-focus", pass: cancelFocus },
            { name: "keyboard-cancel-no-application", pass: cancelWithoutApply }
          );
          result.passed = result.checks.every((check) => check.pass);
        }
        if (folder === "plasma-attack") {
          for (const lang of ["en", "ru"]) {
            await page.evaluate((language) => globalThis.showPlasmaLanguage(language), lang);
            await page.locator("#chat").screenshot({ path: path.join(out, folder, `plasma-attack-${lang}.png`) });
          }
        }
        if (folder === "start-wizard") {
          const before = await page.evaluate(() => {
            globalThis.fixture.root.querySelector(".tsc-wizard-browse").open = true;
            return {
              opened: globalThis.fixture.originalsOpened.length,
              writes: globalThis.__writes.length,
              draft: JSON.stringify(globalThis.wizard.getDraft())
            };
          });
          const preview = page.locator('[data-action="previewOriginal"][data-uuid="Actor.enemy"]');
          await preview.focus();
          await preview.press("Enter");
          await page.waitForFunction((n) => globalThis.fixture.originalsOpened.length === n + 1, before.opened);
          await preview.press("Space");
          await page.waitForFunction((n) => globalThis.fixture.originalsOpened.length === n + 2, before.opened);
          const unchanged = await page.evaluate(
            (before) =>
              globalThis.__writes.length === before.writes &&
              JSON.stringify(globalThis.wizard.getDraft()) === before.draft &&
              globalThis.fixture.root.querySelector("[data-selected-count]").textContent === "0",
            before
          );
          result.checks.push({ name: "keyboard-preview-without-selection-or-submit", pass: unchanged });
          result.checks.push({
            name: "preview-focus-visible",
            pass: await preview.evaluate((el) => globalThis.getComputedStyle(el).outlineStyle !== "none")
          });
          await page.evaluate(async () => {
            globalThis.fixture.enemy.name = "Очень длинное имя корабля / A very long starship name ".repeat(8);
            await globalThis.wizard.render();
            await globalThis.fixture.set('[name="filter"]', "Очень длинное");
          });
          for (const width of [1100, 600]) {
            await page.setViewportSize({ width, height: 950 });
            for (const theme of ["dark", "light"]) {
              const contained = await page.evaluate((theme) => {
                globalThis.document.querySelector("main.application").setAttribute("data-sheet-theme", theme);
                const row = globalThis.fixture.root.querySelector('[data-candidate-row][data-uuid="Actor.enemy"]');
                const button = row.querySelector("button");
                const filters = globalThis.fixture.root.querySelector(".tsc-wizard-filters");
                return (
                  !row.hidden &&
                  row.scrollWidth <= row.clientWidth + 1 &&
                  filters.scrollWidth <= filters.clientWidth + 1 &&
                  button.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1
                );
              }, theme);
              result.checks.push({ name: `long-candidate-contained-${width}-${theme}`, pass: contained });
            }
          }
          result.passed = result.checks.every((check) => check.pass);
        }
        if (folder === "defense-editor") {
          const addSelect = page.locator('[data-defense-add="resistances"]');
          const initial = await addSelect.inputValue();
          await addSelect.focus();
          await addSelect.press("ArrowDown");
          const changed = (await addSelect.inputValue()) !== initial;
          await addSelect.press("Tab");
          const advanced = await addSelect.evaluate((element) => globalThis.document.activeElement !== element);
          const remove = page.locator("[data-defense-tag] button").first();
          await remove.focus();
          const focusVisible = await remove.evaluate((element) => globalThis.getComputedStyle(element).outlineStyle !== "none");
          result.checks.push({ name: "native-select-keyboard", pass: changed && advanced });
          result.checks.push({ name: "keyboard-focus-visible", pass: focusVisible });
          result.passed = result.checks.every((check) => check.pass);
          await page.evaluate(() => {
            globalThis.document.querySelector("#app").style.width = "100%";
          });
          for (const width of [1100, 600, 380]) {
            await page.setViewportSize({ width, height: 950 });
            await page.screenshot({ path: path.join(out, folder, name.replace(/\.html$/, `-${width}.png`)) });
          }
        }
        if (folder === "action-controls") {
          const descriptionButton = page.locator('[data-kind="HUD"] .tsc-action-name').first();
          const before = await page.evaluate(() => globalThis.actionControlExecutions.length);
          await descriptionButton.focus();
          await descriptionButton.press("Enter");
          await page.locator("dialog[open]").waitFor();
          const noExecution = await page.evaluate((n) => globalThis.actionControlExecutions.length === n, before);
          result.checks.push({ name: "keyboard-description-only", pass: noExecution });
          await page.locator("dialog[open] [data-close]").click();
          await page.waitForFunction(() => !globalThis.document.querySelector("dialog"));
          const warning = page.locator('[data-kind="HUD"] .tsc-action-warning').first();
          await warning.focus();
          await warning.press("Enter");
          const tooltip = await page.evaluate(() => globalThis.actionTooltip.includes("Warning text"));
          result.checks.push({ name: "keyboard-warning-tooltip", pass: tooltip });
          const cost = page.locator('[data-kind="HUD"] .tsc-action-cost').first();
          await cost.focus();
          await cost.press("Space");
          const oneExecution = await page.evaluate((n) => globalThis.actionControlExecutions.length === n + 1, before);
          result.checks.push({ name: "keyboard-cost-executes-once", pass: oneExecution });
          const focusVisible = await cost.evaluate((el) => globalThis.getComputedStyle(el).outlineStyle !== "none");
          result.checks.push({ name: "cost-keyboard-focus-visible", pass: focusVisible });
          result.passed = result.checks.every((check) => check.pass);
          await page.locator('[data-kind="HUD"]').screenshot({ path: path.join(out, folder, name.replace(/\.html$/, ".png")) });
        }
        if (folder === "builder-history" && name.startsWith("builder-")) {
          const select = page.locator('select[name="size"]');
          await select.focus();
          await select.press("ArrowDown");
          const changed = (await select.inputValue()) === "large";
          await select.press("Escape");
          await select.press("Tab");
          const advanced = await select.evaluate((el) => globalThis.document.activeElement !== el);
          result.checks.push({ name: "native-select-keyboard", pass: changed && advanced });
          result.passed = result.passed && changed && advanced;
        }
        results.push({ file: `${folder}/${name}`, ...result, errors });
      }
      await page.close();
    }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
const failures = results.filter((r) => !r.passed || r.errors.length);
const failureDetails = failures.map((result) =>
  result.measurements
    ? {
        file: result.file,
        errors: result.errors,
        failedChecks: result.measurements.flatMap((measurement) =>
          measurement.checks.filter((check) => !check.pass).map((check) => `${measurement.width}: ${check.name}`)
        )
      }
    : result
);
console.log(JSON.stringify({ total: results.length, passed: results.length - failures.length, failures: failureDetails }, null, 2));
if (failures.length) process.exitCode = 1;
