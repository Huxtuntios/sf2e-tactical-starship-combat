/** Regression: chat-card label/value columns must stay readable at narrow chat widths (no one-character value column). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? path.join(root, "dist", "chat-card-layout-smoke");
const rootUrl = pathToFileURL(root).href;
fs.mkdirSync(out, { recursive: true });

const LABELS = {
  ru: {
    "SF2eTSC.attackCard.attacker": "Атакующий",
    "SF2eTSC.attackCard.attackType": "Тип атаки",
    "SF2eTSC.attackCard.noCrew": "Корабль (без экипажа)",
    "SF2eTSC.ui.traits": "Признаки",
    "SF2eTSC.chat.damage": "Урон",
    "SF2eTSC.attackCard.range": "Дальность",
    "SF2eTSC.attackCard.zones": "зон",
    "SF2eTSC.mods.rangeIncrement": "Шаг дистанции",
    "SF2eTSC.attackCard.fromZone": "из зоны {zone}",
    "SF2eTSC.mods.attackBonus": "Бонус атаки",
    "SF2eTSC.ui.map": "Штраф за множественные атаки",
    "SF2eTSC.attackCard.modifiers": "Модификаторы",
    "SF2eTSC.attackCard.resultTitle": "Результат",
    "SF2eTSC.attackCard.target": "Цель",
    "SF2eTSC.chat.attack": "Атака",
    "SF2eTSC.ui.ac": "КЗ",
    "SF2eTSC.chat.result": "Итог",
    "SF2eTSC.attackCard.type.ranged": "Дистанционный",
    "SF2eTSC.attackCard.status.resolved": "Завершено",
    "SF2eTSC.chat.crew": "Экипаж",
    "SF2eTSC.ui.shieldPoints": "Щиты",
    "SF2eTSC.ui.hullPoints": "Корпус"
  },
  en: {
    "SF2eTSC.attackCard.attacker": "Attacker",
    "SF2eTSC.attackCard.attackType": "Attack type",
    "SF2eTSC.attackCard.noCrew": "Ship (no crew)",
    "SF2eTSC.ui.traits": "Traits",
    "SF2eTSC.chat.damage": "Damage",
    "SF2eTSC.attackCard.range": "Range",
    "SF2eTSC.attackCard.zones": "zones",
    "SF2eTSC.mods.rangeIncrement": "range increment",
    "SF2eTSC.attackCard.fromZone": "from zone {zone}",
    "SF2eTSC.mods.attackBonus": "Attack bonus",
    "SF2eTSC.ui.map": "Multiple attack penalty",
    "SF2eTSC.attackCard.modifiers": "Modifiers",
    "SF2eTSC.attackCard.resultTitle": "Result",
    "SF2eTSC.attackCard.target": "Target",
    "SF2eTSC.chat.attack": "Attack",
    "SF2eTSC.ui.ac": "AC",
    "SF2eTSC.chat.result": "Outcome",
    "SF2eTSC.attackCard.type.ranged": "Ranged",
    "SF2eTSC.attackCard.status.resolved": "Resolved",
    "SF2eTSC.chat.crew": "Crew",
    "SF2eTSC.ui.shieldPoints": "Shields",
    "SF2eTSC.ui.hullPoints": "Hull"
  }
};
const LONG_VALUE = { ru: "эм 3 заклинание 5 зон · из зон", en: "em 3 spell 5 zones · from zones" };
const TARGET = { ru: "Обычныйстребитель #1", en: "Common Fighter #1" };
const MAP_LABEL = { ru: "Штраф за множественные атаки", en: "Multiple attack penalty" };

function fixture(lang) {
  const L = LABELS[lang];
  return `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<style>/* Mirrors the Foundry core chat inheritance observed live (word-break on chat dt/dd). */
.message-content dt,.message-content dd,.message-content .tsc-label,.message-content .tsc-value{word-break:break-word;}</style>
<body style="margin:0;background:#e8e4dc">
<div id="hosts"></div>
<pre id="result">waiting</pre>
<script type="module">
const L=${JSON.stringify(L)};
const LONG=${JSON.stringify(LONG_VALUE[lang])}, TARGET=${JSON.stringify(TARGET[lang])}, MAP=${JSON.stringify(MAP_LABEL[lang])};
const { makeCardRenderer } = await import('${rootUrl}/scripts/chat/attack-card/view.mjs');
const r = makeCardRenderer({ t:k=>L[k]??k, has:k=>!!L[k], actionLabel:a=>a?.name??"", ct:s=>s, designation:s=>s });
const card = { status:"resolved", action:{builtin:"magic-conduit",name:"Magic Conduit"}, ship:{name:"Ship"}, crew:null, attackType:"ranged",
 weapon:{name:"Conduit", traits:[LONG], damage:"1d6", damageType:"force"},
 range:{zones:5,increment:3,fromZone:2}, bonus:{value:10}, map:{current:0,profile:{map1:-5,map2:-10},choice:"0"},
 result:{targetLabel:TARGET, attack:{total:18,natural:16,ac:17,degreeLabel:"OK"}} };
const attackHtml = r.renderAttackCard({ flags:{ "sf2e-tactical-starship-combat":{ attackCard:card } } });
const row=(l,v)=>'<div class="tsc-row"><span class="tsc-label">'+l+'</span><span class="tsc-value">'+v+'</span></div>';
const actionHtml = '<div class="sf2e-tsc-card action"><header><h3>Ship</h3><span>Magic Conduit</span></header><div class="tsc-body">'
 + row(L["SF2eTSC.ui.traits"],LONG) + row(L["SF2eTSC.attackCard.range"],"5 · 3") + row(L["SF2eTSC.mods.attackBonus"],"+10")
 + row(MAP,"0") + row(L["SF2eTSC.attackCard.target"],TARGET) + row(L["SF2eTSC.chat.attack"],"18 (d20 16)") + '</div></div>';
const damageHtml = '<div class="sf2e-tsc-card damage"><header><h3>Ship</h3><span>'+L["SF2eTSC.chat.damage"]+'</span></header><div class="tsc-body">'
 + row(L["SF2eTSC.chat.damage"],"12 → 8") + row(L["SF2eTSC.ui.shieldPoints"],"-4") + row(L["SF2eTSC.ui.hullPoints"],"-4") + '</div></div>';
const textLines = (el) => { const range=document.createRange(); range.selectNodeContents(el); const rects=[...range.getClientRects()]; const tops=new Set(rects.map(rc=>Math.round(rc.top))); return { lines:tops.size, minW:rects.length?Math.min(...rects.map(rc=>rc.width)):0 }; };
const checks=[]; const check=(name,pass)=>checks.push({name,pass:!!pass});
const hosts=document.getElementById('hosts');
for (const w of [200,260,340,480]) {
  for (const [kind,inner] of [["attack",attackHtml],["action",actionHtml],["damage",damageHtml]]) {
    const wrap=document.createElement('div'); wrap.style.width=w+'px';
    wrap.innerHTML='<div class="message-content">'+inner+'</div>';
    hosts.append(wrap);
    const cardEl=wrap.querySelector('.sf2e-tsc-card');
    check(kind+'-'+w+'-no-hoverflow', cardEl.scrollWidth<=cardEl.clientWidth+1);
    const valueEls = kind==='attack' ? [...cardEl.querySelectorAll('dd')] : [...cardEl.querySelectorAll('.tsc-value')];
    const labelEls = kind==='attack' ? [...cardEl.querySelectorAll('dt')] : [...cardEl.querySelectorAll('.tsc-label')];
    if (kind==='attack') {
      // Grid: the value is a track and must keep a readable floor; labels likewise.
      check(kind+'-'+w+'-value-col-readable', valueEls.every(el=>el.getBoundingClientRect().width>=60));
      check(kind+'-'+w+'-labels-readable', labelEls.every(el=>el.getBoundingClientRect().width>=30));
    } else {
      check(kind+'-'+w+'-labels-readable', labelEls.every(el=>el.getBoundingClientRect().width>=20));
    }
    // Numeric / short values stay on a single line (aligned, not smeared).
    const shortVals = valueEls.filter(el=>/^[+−-]?\\d+(\\.\\d+)?$/.test(el.textContent.trim()));
    check(kind+'-'+w+'-numeric-single-line', shortVals.length>0 && shortVals.every(el=>textLines(el).lines===1));
    // No value collapses to one character per line.
    check(kind+'-'+w+'-value-not-per-char', valueEls.every(el=>{const t=textLines(el);const txt=el.textContent.trim();return txt.length<=2 ? t.lines===1 : (t.minW>=12&&t.lines<=8);}));
    // Long text wraps at words (several chars per line), never a few characters per line.
    const longVals = valueEls.filter(el=>{const t=el.textContent.trim();return t.length>=12&&(t.includes('·')||t.includes('#'));});
    check(kind+'-'+w+'-long-wraps-naturally', longVals.every(el=>{const t=textLines(el);const n=el.textContent.trim().length;return t.lines<=8&&n/t.lines>=6;}));
    if (kind==='attack'&&w===480) {
      const mapDt=[...cardEl.querySelectorAll('dt')].find(dt=>dt.textContent===MAP);
      check('attack-480-label-compact', !!mapDt && textLines(mapDt).lines===1);
    }
    wrap.remove();
  }
}
// Dark background: layout/readability must not depend on theme.
const dark=document.createElement('div'); dark.style.cssText='width:260px;background:#1b1b1b;color:#eee';
dark.innerHTML='<div class="message-content">'+attackHtml+'</div>'; hosts.append(dark);
const dCard=dark.querySelector('.sf2e-tsc-card');
check('dark-260-no-hoverflow', dCard.scrollWidth<=dCard.clientWidth+1);
check('dark-260-value-col-readable', [...dCard.querySelectorAll('dd')].every(el=>el.getBoundingClientRect().width>=60));
dark.remove();
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`;
}
for (const lang of ["ru", "en"]) {
  fs.writeFileSync(path.join(out, `chat-card-layout-${lang}.html`), fixture(lang));
}
console.log(`Wrote chat card layout fixtures to ${out}`);
