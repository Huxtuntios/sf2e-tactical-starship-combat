import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../tests/helpers/foundry-mock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "dist", "ui-tests", "defense-editor"));
fs.mkdirSync(out, { recursive: true });
const nativeCatalogs = {
  immunityTypes: { poison: "PF2E.Damage.IWR.Type.poison", void: "PF2E.Damage.RollFlavor.void", fire: "PF2E.Damage.RollFlavor.fire" },
  resistanceTypes: {
    fire: "PF2E.Damage.RollFlavor.fire",
    cold: "PF2E.Damage.RollFlavor.cold",
    sonic: "PF2E.Damage.RollFlavor.sonic",
    custom: "PF2E.Damage.IWR.Type.custom"
  },
  weaknessTypes: { electricity: "PF2E.Damage.RollFlavor.electricity", sonic: "PF2E.Damage.RollFlavor.sonic" },
  skills: {
    computers: { label: "PF2E.Skill.Computers", attribute: "int" },
    piloting: { label: "PF2E.Skill.Piloting", attribute: "dex" },
    medicine: { label: "PF2E.Skill.Medicine", attribute: "wis" }
  }
};
const styles = fs.readFileSync(path.join(root, "styles", "main.css"), "utf8");
const template = fs.readFileSync(path.join(root, "templates", "ship-editor.hbs"), "utf8");

for (const lang of ["en", "ru"]) {
  installFoundryMock({ lang });
  CONFIG.PF2E = nativeCatalogs;
  await loadContentFromDisk();
  const actor = makeShip({
    id: `defense-ui-${lang}`,
    name:
      lang === "ru"
        ? "Очень длинное имя звездолёта для проверки адаптивного редактора"
        : "A very long starship name for responsive editor checks",
    role: "npc",
    extra: {
      immunities: ["poison", "legacy-immunity-with-a-very-long-custom-label-that-must-wrap"],
      resistances: { fire: 5, cold: 0 },
      weaknesses: { electricity: 3 },
      skills: { computers: 12, piloting: -2 }
    }
  });
  const { buildSheetContext } = await import("../scripts/ui/sheet/sheet-context.mjs");
  const context = await buildSheetContext({ document: actor, isNpc: true, tab: "config", tabs: ["overview", "config"] });
  const h = Handlebars.create();
  h.registerHelper("localize", (key, options) => (options?.hash ? game.i18n.format(key, options.hash) : game.i18n.localize(key)));
  h.registerHelper("eq", (a, b) => a === b);
  const editor = h.compile(template)(context);
  const html = `<!doctype html><meta charset="utf-8"><style>${styles}
    body{margin:0;padding:12px;background:#777;font:14px Arial}
    #app{box-sizing:border-box;max-width:100%;min-height:640px;padding:8px}
    #result{font:11px monospace;white-space:pre-wrap;color:#fff;background:#111;padding:8px}
  </style><main id="app" class="sf2e-tsc tsc-sheet application">${editor}</main><pre id="result">waiting</pre>
  <script type="module">
    const checks=[];
    const check=(name,pass)=>checks.push({name,pass:!!pass});
    const app=document.querySelector('#app');
    const editor=app.querySelector('.tsc-defense-editors');
    check('no-legacy-text-inputs',!app.querySelector('[data-field="immunities"],[data-field="resistances"],[data-field="weaknesses"],[data-field="skills"]'));
    check('native-type-and-value-rows',app.querySelectorAll('[data-defense-property="type"]').length===5&&app.querySelectorAll('[data-defense-property="value"]').length===5);
    check('immunity-tags',app.querySelectorAll('[data-defense-tag]').length===2);
    check('no-unsupported-exceptions-or-double-vs',!app.querySelector('[data-defense-property="exceptions"],[data-defense-property="doubleVs"]'));
    check('custom-type-not-addable',![...app.querySelectorAll('[data-defense-add] option')].some(option=>option.value==='custom'));
    check('used-type-disabled-in-other-row',app.querySelector('[data-defense-editor="resistances"] [data-defense-row] select option[value="cold"]').disabled);
    const removeButtons=[...app.querySelectorAll('[data-defense-editor="resistances"] [data-action="removeDefenseEntry"],[data-defense-editor="weaknesses"] [data-action="removeDefenseEntry"],[data-defense-editor="skills"] [data-action="removeDefenseEntry"]')];
    check('numeric-remove-controls-use-current-row-type',removeButtons.length===5&&removeButtons.every(button=>button.closest('[data-defense-row]')?.querySelector('[data-defense-property="type"]')?.value===button.dataset.defenseKey));
    const controls=[...app.querySelectorAll('button,select,input')];
    check('all-controls-have-accessible-names',controls.every(control=>control.getAttribute('aria-label')||control.textContent.trim()||control.closest('label')));
    for(const width of [1100,600,380]){
      app.style.width=width+'px';
      const bounds=editor.getBoundingClientRect();
      const scrolls=[...editor.querySelectorAll('.tsc-table-scroll')];
      check('editor-contained-'+width,editor.scrollWidth<=editor.clientWidth+1&&bounds.right<=app.getBoundingClientRect().right+1);
      check('tables-contained-'+width,scrolls.every(scroll=>scroll.getBoundingClientRect().right<=bounds.right+1&&getComputedStyle(scroll).overflowX==='auto'));
      check('tags-contained-'+width,[...editor.querySelectorAll('.tsc-defense-tag')].every(tag=>tag.getBoundingClientRect().right<=bounds.right+1));
      check('page-contained-'+width,document.documentElement.scrollWidth<=window.innerWidth+1);
    }
    document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(check=>check.pass)});
  </script>`;
  fs.writeFileSync(path.join(out, `defense-editor-${lang}.html`), html);
}
console.log(`Wrote defense editor fixtures to ${out}`);
