/** Render the production Sensor Map GM action controls in English and Russian. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadLang } from "../tests/helpers/foundry-mock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "ui-tests", "sensor-gm-actions");
fs.mkdirSync(out, { recursive: true });
const templates = Object.fromEntries(
  ["bar", "zones", "detail", "dock"].map((part) => [part, fs.readFileSync(path.join(root, "templates", `sensor-map-${part}.hbs`), "utf8")])
);

for (const lang of ["en", "ru"]) {
  const labels = loadLang(lang);
  const t = (key, data = {}) =>
    Object.entries(data).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), labels[key] ?? key);
  const longName =
    lang === "ru" ? "Очень длинное название корабля игроков для проверки панели" : "A very long player starship name for toolbar checking";
  const npcName = lang === "ru" ? "Корабль НИП только на карте" : "Map-only NPC starship";
  const hazardName = lang === "ru" ? "Космический хазард" : "Starship hazard";
  const mapObject = (key, label, type, extra = {}) => ({
    key,
    label,
    type,
    icon: type === "hazard" ? "⚠" : "🚀",
    heading: "right",
    arrow: "",
    transform: { rotation: 0, scaleX: 1, scaleY: 1 },
    arrowSize: 22,
    arrowGap: 5,
    arrowOpacity: 0.75,
    selected: false,
    actionSelected: false,
    targeted: false,
    ...extra
  });
  const actionObjects = [
    { key: "player", label: longName, type: "starship", typeLabel: t("SF2eTSC.objectTypes.starship"), zone: 1, order: 1 },
    { key: "map-npc", label: npcName, type: "starship", typeLabel: t("SF2eTSC.objectTypes.starship"), zone: 3, order: 1, selected: true },
    { key: "hazard", label: hazardName, type: "hazard", typeLabel: t("SF2eTSC.objectTypes.hazard"), zone: 3, order: 2 }
  ];
  for (const object of actionObjects) object.positionLabel = t("SF2eTSC.ui.mapPosition", { zone: object.zone, position: object.order });
  const context = {
    noCombat: false,
    isGM: true,
    autoActionSelection: true,
    combat: { round: 2, turn: longName },
    zoneCount: 3,
    showRanges: false,
    sensorRanges: [],
    actionObjects,
    actionSelection: actionObjects[1],
    zones: [
      { zone: 1, label: "01", objects: [mapObject("player", longName, "starship", { targeted: true })] },
      { zone: 2, label: "02", objects: [mapObject("hazard", hazardName, "hazard", { selected: true })] },
      {
        zone: 3,
        label: "03",
        objects: [mapObject("map-npc", npcName, "starship", { actionSelected: true }), mapObject("hazard-2", hazardName, "hazard")]
      }
    ],
    detail: null,
    log: [],
    gmToolsOpen: false,
    dock: {
      none: false,
      gm: true,
      objectKey: "map-npc",
      label: npcName,
      positionLabel: t("SF2eTSC.ui.mapPosition", { zone: 3, position: 1 }),
      station: t("SF2eTSC.ui.gmActions"),
      stationIcon: "fa-solid fa-gear",
      canManageEffects: true,
      effectShipUuid: "map-npc",
      shipUuid: "map-npc",
      actions: [
        {
          key: "0:scanner:inline:ram",
          id: "inline:ram",
          name: lang === "ru" ? "Таран" : "Ram",
          icon: "◆",
          costLabel: t("SF2eTSC.edit.cost.one-action"),
          enabled: true,
          reasons: "",
          warnings: "",
          text: lang === "ru" ? "Вручную выполнить таран." : "Resolve the ram manually.",
          desc: `<p>${lang === "ru" ? "Вручную выполнить таран." : "Resolve the ram manually."}</p>`,
          needsTarget: true,
          frequency: null,
          crewUuid: null,
          stationId: "scanner"
        },
        {
          key: "1:ship:repair-self",
          id: "repair-self",
          name: t("SF2eTSC.actions.repair-self"),
          icon: "◆◆◆",
          costLabel: t("SF2eTSC.edit.cost.three-actions"),
          enabled: false,
          reasons: t("SF2eTSC.errors.shipDestroyed"),
          warnings: "",
          text: "",
          desc: "<p></p>",
          needsTarget: false,
          frequency: null,
          crewUuid: null,
          stationId: null
        }
      ]
    }
  };
  const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8">
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<style>body{margin:0;padding:8px;background:#777;font:14px Arial;box-sizing:border-box}main{inline-size:100%;max-inline-size:1100px;block-size:850px;margin:auto}#result{position:fixed;inset-block-end:0;inset-inline:0;max-block-size:90px;overflow:auto;background:white;color:black;white-space:pre-wrap}</style>
<script src="${rootUrl}/node_modules/handlebars/dist/handlebars.min.js"></script>
<main id="app" class="application sf2e-tsc tsc-sensor-map"><div class="window-content"></div></main><pre id="result">waiting</pre>
<script type="module">
const labels=${JSON.stringify(labels)},templates=${JSON.stringify(templates)},context=${JSON.stringify(context)};
Handlebars.registerHelper('localize',key=>labels[key]??key);
const root=document.querySelector('#app'),content=root.querySelector('.window-content');
for(const part of ['bar','zones','detail','dock']){const wrapper=document.createElement('template');wrapper.innerHTML=Handlebars.compile(templates[part])(context);const element=wrapper.content.firstElementChild;element.dataset.applicationPart=part;content.append(element);}
const select=document.querySelector('[data-tsc-action-object]'),toggle=document.querySelector('[data-tsc-auto-action-object]');
select.addEventListener('change',()=>{globalThis.fixtureSelection=select.value;});
const M='sf2e-tactical-starship-combat',combatId='fixture-combat';
const combatants={
 'map-npc':{id:'map-turn',flags:{[M]:{sensorMapObject:{combatId,key:'map-npc'}}}},
 player:{id:'player-turn',flags:{[M]:{sensorMapObject:{combatId,key:'player'}}}},
 hazard:{id:'hazard-turn',flags:{[M]:{sensorMapObject:{combatId,key:'hazard'}}}}
};
const combat={id:combatId,round:1,combatant:combatants['map-npc'],flags:{[M]:{tsc:{enabled:true}}}};
globalThis.game={system:{id:'sf2e'},user:{isGM:true},combat,combats:[combat],actors:new Map(),users:new Map(),modules:new Map(),time:{worldTime:100},settings:{get:()=>false,set:async()=>{}},socket:{connected:true},i18n:{lang:'${lang}',has:key=>Object.hasOwn(labels,key),localize:key=>labels[key]??key,format:(key,data)=>Object.entries(data??{}).reduce((text,[name,value])=>text.replaceAll('{'+name+'}',value),labels[key]??key)}};
globalThis.ui={notifications:{info(){},warn(){},error(){}}};
globalThis.Hooks={on:()=>1,off:()=>{},callAll:()=>{}};
globalThis.CONFIG={PF2E:{skills:{},damageTypes:{}}};
globalThis.CONST={DOCUMENT_OWNERSHIP_LEVELS:{NONE:0,LIMITED:1,OBSERVER:2,OWNER:3}};
globalThis.canvas={tokens:{controlled:[]}};
globalThis.fromUuidSync=()=>null;globalThis.fromUuid=async()=>null;
let sequence=0;
globalThis.foundry={utils:{randomID:()=>String(++sequence),deepClone:structuredClone,escapeHTML:text=>String(text??'')},applications:{api:{ApplicationV2:class{},HandlebarsApplicationMixin:Base=>Base,DialogV2:class{}},ux:{TextEditor:{implementation:{enrichHTML:async text=>text}}}}};
const gmUi=await import('${rootUrl}/scripts/ui/sensor-gm-ui.mjs');
const {wireSensorMapDragDrop}=await import('${rootUrl}/scripts/ui/sensor-drop-ui.mjs');
const fixtureView=context.actionObjects.map(object=>({...object,actorUuid:object.key,name:object.label}));
const fixture={app:null,combat,combatants,requests:[],clicks:0,contextmenuPropagations:0,renders:0,
 setTurn(key,round=combat.round){combat.round=round;combat.combatant=combatants[key];},
 async flush(){for(let index=0;index<12;index++)await Promise.resolve();await new Promise(requestAnimationFrame);},
 async reset(){game.user.isGM=true;combat.round=1;combat.combatant=combatants['map-npc'];fixture.app.autoActionSelection=true;fixture.app.gmActionOverride=null;fixture.app.actionObjectKey='map-npc';fixture.app.selected='hazard';game.user.targets=new Set(['native-target']);fixture.requests.length=0;fixture.clicks=0;fixture.contextmenuPropagations=0;await fixture.app.render();},
 render:async()=>fixture.app.render()
};
const app={element:root,actionObjectKey:'map-npc',autoActionSelection:true,selected:'hazard',async render(){
 fixture.renders++;
 const selection=gmUi.gmActionSelection(fixtureView,app.actionObjectKey,true,app);
 app.actionObjectKey=selection.actionObjectKey;
 select.value=app.actionObjectKey??'';
 toggle.checked=app.autoActionSelection;
 toggle.setAttribute('aria-checked',String(app.autoActionSelection));
 root.querySelectorAll('.tsc-obj[data-object-key]').forEach(object=>object.classList.toggle('action-selected',object.dataset.objectKey===app.actionObjectKey));
}};
fixture.app=app;globalThis.fixture=fixture;
game.user.targets=new Set(['native-target']);
root.addEventListener('click',()=>fixture.clicks++);
document.addEventListener('contextmenu',()=>fixture.contextmenuPropagations++);
await app.render();
gmUi.wireGmActionControls(app);
wireSensorMapDragDrop(root,{combatId,movableKeys:['player','map-npc','hazard'],privateKeys:[]},{send:async(type,payload)=>fixture.requests.push({type,payload})});
globalThis.measureGmActions=()=>{
 const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
 const action=document.querySelector('[data-object-key="map-npc"]'),target=document.querySelector('[data-object-key="player"]'),ordinary=document.querySelector('[data-object-key="hazard"]');
 const actionStyle=getComputedStyle(action),ordinaryStyle=getComputedStyle(ordinary),markerStyle=getComputedStyle(target.querySelector('.tsc-obj-target-marker'));
 check('selector-population',[...select.options].map(option=>option.value).join(',')===',player,map-npc,hazard'&&select.value==='map-npc');
 check('selector-label',select.labels.length===1&&select.labels[0].textContent.includes(labels['SF2eTSC.ui.actionObject']));
 check('selection-classes-independent',action.classList.contains('action-selected')&&!action.classList.contains('selected')&&ordinary.classList.contains('selected')&&!ordinary.classList.contains('action-selected')&&!target.classList.contains('selected'));
 check('selection-outlines-distinct',actionStyle.outlineStyle==='solid'&&parseFloat(actionStyle.outlineWidth)>=3&&actionStyle.outlineColor!==ordinaryStyle.outlineColor&&actionStyle.outlineColor!==markerStyle.backgroundColor);
 check('target-marker-preserved',!!target.querySelector('.tsc-obj-target-marker'));
 const positionLabel=labels['SF2eTSC.ui.mapPosition'].replace('{zone}','3').replace('{position}','1');
 check('zone-order-label',select.selectedOptions[0].textContent.endsWith(positionLabel)&&!document.querySelector('.tsc-action-position'));
 check('effects-entry',document.querySelector('[data-action="manageEffects"]')?.dataset.shipUuid==='map-npc');
 const selectRect=select.getBoundingClientRect(),rootRect=root.getBoundingClientRect(),toggleLabel=toggle.closest('label'),toggleRect=toggleLabel.getBoundingClientRect();
 check('selector-contained',selectRect.width>=24&&selectRect.height>=24&&selectRect.right<=rootRect.right+1);
 check('auto-toggle-default',toggle.checked&&toggle.getAttribute('role')==='switch'&&toggle.getAttribute('aria-checked')==='true');
 check('auto-toggle-label',toggle.labels.length===1&&toggleLabel.textContent.includes(labels['SF2eTSC.ui.autoActionObject']));
 check('auto-toggle-adjacent',select.closest('.tsc-action-object-picker').nextElementSibling===toggleLabel);
 check('auto-toggle-contained',toggleRect.height>=24&&toggleRect.right<=rootRect.right+1);
 check('page-no-horizontal-overflow',document.documentElement.scrollWidth<=globalThis.innerWidth+1);
 check('bar-no-horizontal-overflow',document.querySelector('.tsc-map-bar').scrollWidth<=document.querySelector('.tsc-map-bar').clientWidth+1);
 check('dock-no-horizontal-overflow',document.querySelector('.tsc-dock').scrollWidth<=document.querySelector('.tsc-dock').clientWidth+1);
 return {checks};
};
document.querySelector('#result').textContent=JSON.stringify({passed:true,checks:[]});
</script></html>`;
  fs.writeFileSync(path.join(out, `sensor-gm-actions-${lang}.html`), html);
}
console.log(`Wrote EN/RU Sensor Map GM action fixtures to ${out}`);
