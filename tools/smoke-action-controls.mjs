import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Handlebars from "handlebars";
import { installFoundryMock } from "../tests/helpers/foundry-mock.mjs";
import { actionCostLabel } from "../scripts/ui/action-controls.mjs";
import { checkLinksHTML } from "../scripts/content/inline-checks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "action-controls");
fs.mkdirSync(out, { recursive: true });
installFoundryMock();
const { COST_ICON } = await import("../scripts/ui/action-runner.mjs");
for (const lang of ["en", "ru"]) {
  installFoundryMock({ lang });
  const dictionary = JSON.parse(fs.readFileSync(path.join(root, "lang", `${lang}.json`), "utf8"));
  const t = (key) => key.split(".").reduce((value, part) => value?.[part], dictionary) ?? key;
  game.i18n.localize = t;
  const h = Handlebars.create();
  h.registerHelper("localize", t);
  h.registerHelper("eq", (a, b) => a === b);
  for (const name of [
    "tscOccupant",
    "tscStationUpgrades",
    "tscShipUpgrades",
    "tscUpgradeItem",
    "modules/sf2e-tactical-starship-combat/templates/crew-ship.hbs"
  ])
    h.registerPartial(name, "");
  const description = checkLinksHTML(
    `@Check[will|dc:20]{Will} @Damage[2d6[fire]]{Fire}. ${"Complete rules text. ".repeat(140)}Final paragraph.`
  );
  const actions = [1, 2, 3, "free", "reaction", [1, 2, 3]].map((cost, index) => ({
    id: `action-${index}`,
    name:
      lang === "ru" ? `Магический проводник: продолжительное действие станции ${index}` : `Magic Conduit: extended station action ${index}`,
    icon: COST_ICON(cost),
    costLabel: actionCostLabel(cost),
    enabled: index !== 2,
    reasons: index === 2 ? "Unavailable" : "",
    warnings: "Warning text",
    frequency: "Once per round",
    desc: description,
    html: description
  }));
  const render = (file, context) => h.compile(fs.readFileSync(path.join(root, "templates", `${file}.hbs`), "utf8"))(context);
  const dcRows = [{ label: "DC", value: 20 }];
  const panels = [
    ["PC", render("starship-sheet", { tab: "stations", ship: {}, stations: [{ id: "station", actionList: actions, dcRows }] })],
    ["NPC", render("starship-sheet", { tab: "actions", isNpc: true, isGM: true, ship: {}, npcActions: actions })],
    [
      "NPC stations",
      render("starship-sheet", { tab: "stations", isNpc: true, ship: {}, stations: [{ id: "station", actionList: actions, dcRows }] })
    ],
    ["HUD", render("station-hud", { actions, dcRows })],
    ["dock", render("sensor-map-dock", { dock: { actions, dcRows } })]
  ];
  for (const theme of ["light", "dark"]) {
    const sections = panels
      .map(
        ([kind, html]) =>
          `<section class="sf2e-tsc ${kind === "HUD" ? "tsc-hud" : kind === "dock" ? "tsc-sensor-map" : "tsc-sheet"}" data-kind="${kind}"><div class="window-content">${html}</div></section>`
      )
      .join("");
    const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><title>Action controls</title>
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<style>body{font:14px Arial;background:#777;margin:16px}section[data-kind]{width:320px;margin:12px}.window-content{padding:8px}dialog{max-height:80vh}#result{white-space:pre-wrap}</style>
${sections}<pre id="result">waiting</pre>
<script type="module">
const checks=[], executions=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
const dictionary=${JSON.stringify(dictionary)};
const t=k=>k.split('.').reduce((v,p)=>v?.[p],dictionary)??k;
const packActions=${JSON.stringify(actions)};
const pack={
  folders:new Map([['language',{name:'${lang === "ru" ? "Русский" : "English"}'}]]),
  getIndex:async()=>packActions.map(a=>({_id:a.id,folder:'language',flags:{'sf2e-tactical-starship-combat':{packAction:{actionId:a.id}}}})),
  getDocument:async id=>({sheet:{render:()=>{
    const action=packActions.find(a=>a.id===id),dialog=document.createElement('dialog');
    dialog.innerHTML='<header><h1></h1></header><div>'+action.html+'</div><button type="button" data-close>Close</button>';
    dialog.querySelector('h1').textContent=action.name;document.body.append(dialog);dialog.show();
    dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  }}})
};
globalThis.game={settings:{get:()=> '${theme}'},i18n:{lang:'${lang}',localize:t},system:{id:'sf2e'},packs:new Map([['sf2e-tactical-starship-combat.starship-actions',pack]]),tooltip:{activate:target=>{globalThis.actionTooltip=target.dataset.tooltipText;}}};
const {showActionDescription,showActionWarning}=await import('${rootUrl}/scripts/ui/action-controls.mjs');
const {paintSheetTheme}=await import('${rootUrl}/scripts/ui/sheet/sheet-theme.mjs');
const sections=[...document.querySelectorAll('[data-kind]')];
for(const section of sections){
  paintSheetTheme(section);
  section.addEventListener('click',async event=>{
    const button=event.target.closest('button[data-action]');if(!button||button.disabled)return;
    if(button.dataset.action==='describeAction')await showActionDescription(event,button);
    else if(button.dataset.action==='actionWarning')showActionWarning(event,button);
    else if(['runAction','act','dockAct'].includes(button.dataset.action))executions.push(button.dataset.actionId);
  });
  const kind=section.dataset.kind;
  const rows=[...section.querySelectorAll('.tsc-action-row')];
  check(kind+'-rows',rows.length===6);
  for(const row of rows){
    const cost=row.querySelector('.tsc-action-cost'),name=row.querySelector('.tsc-action-name');
    check(kind+'-separate',cost&&name&&!cost.contains(name)&&!name.contains(cost)&&!name.disabled);
    if(!cost||!name)continue;
    const count=executions.length;
    name.click();await new Promise(resolve=>requestAnimationFrame(resolve));const dialog=document.querySelector('dialog[open]');
    check(kind+'-description-without-execution',!!dialog&&executions.length===count);
    check(kind+'-complete-content',dialog?.textContent.includes('Final paragraph.')&&!!dialog?.querySelector('.tsc-check'));
    check(kind+'-no-description-triangle',!name.closest('details'));
    dialog?.querySelector('[data-close]').click();
    cost.click();check(kind+'-execution-once',executions.length===count+(cost.disabled?0:1));
    const warning=row.querySelector('.tsc-action-warning');
    check(kind+'-warnings-frequency',warning?.dataset.tooltipText.includes('Warning text')&&!row.textContent.includes('Warning text')&&row.textContent.includes('Once per round'));
    check(kind+'-no-underline',!getComputedStyle(name).textDecorationLine.includes('underline'));
    check(kind+'-warning-tone',getComputedStyle(warning).color!==getComputedStyle(name).color);
    check(kind+'-plain-name',getComputedStyle(name).backgroundColor==='rgba(0, 0, 0, 0)');
    warning?.click();check(kind+'-warning-tooltip',globalThis.actionTooltip?.includes('Warning text'));
  }
  for(const width of [260,320,760]){
    section.style.width=width+'px';
    for(const row of rows){
      const cost=row.querySelector('.tsc-action-cost'),name=row.querySelector('.tsc-action-name');if(!cost||!name)continue;
      const a=cost.getBoundingClientRect(),b=name.getBoundingClientRect();
      check(kind+'-'+width+'-separate-targets',a.right<=b.left+1&&Math.abs(a.top-b.top)<8);
      check(kind+'-'+width+'-touch-targets',a.width>=24&&a.height>=24&&b.width>=24&&b.height>=24);
      check(kind+'-'+width+'-no-overflow',row.scrollWidth<=row.clientWidth+1);
    }
  }
  section.style.width='320px';
  const disclosure=section.querySelector('details');
  check(kind+'-other-disclosure-retained',!!disclosure);
  if(disclosure){const was=disclosure.open;disclosure.querySelector('summary').click();check(kind+'-other-disclosure-works',disclosure.open!==was);}
}
globalThis.actionControlExecutions=executions;
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script></html>`;
    fs.writeFileSync(path.join(out, `action-controls-${lang}-${theme}.html`), html);
  }
}
console.log(`Wrote action control fixtures to ${out}`);
