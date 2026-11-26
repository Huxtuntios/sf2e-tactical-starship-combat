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
const select=document.querySelector('[data-tsc-action-object]');
select.addEventListener('change',()=>{globalThis.fixtureSelection=select.value;});
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
 const selectRect=select.getBoundingClientRect(),rootRect=root.getBoundingClientRect();
 check('selector-contained',selectRect.width>=24&&selectRect.height>=24&&selectRect.right<=rootRect.right+1);
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
