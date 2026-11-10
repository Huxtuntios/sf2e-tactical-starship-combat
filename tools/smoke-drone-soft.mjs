/** Генерация настоящих форм помощников для локального Chromium. Это не запуск Foundry. */
import fs from "node:fs";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../tests/helpers/foundry-mock.mjs";
import { guidedMineResolution } from "../scripts/ui/sheet/mine-guided.mjs";
import { prepareHarrySensors } from "../scripts/ui/sheet/harry-assist.mjs";
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
installFoundryMock();
await loadContentFromDisk();
const operator = makeCharacter({ id: "op", name: "Operator" });
operator.getStatistic = (slug) => (slug === "class-spell" ? { dc: { value: 23 } } : null);
const ship = makeShip({
  id: "ship",
  name: "Ship",
  stations: [{ id: "s", type: "drone-console", grade: "commercial", helmedBy: operator.uuid }],
  crew: [{ actorUuid: operator.uuid, role: "crew", stationId: "s" }],
  extra: { drones: [{ id: "d", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true }] }
});
const target = makeShip({ id: "target", name: "Target" });
makeStarshipCombat({
  objects: [
    { key: ship.uuid, zone: 3 },
    { key: target.uuid, zone: 3 }
  ]
});
let harry = "";
foundry.applications.api.DialogV2.prompt = async (opts) => {
  harry = opts.content;
  return null;
};
await prepareHarrySensors(ship, { dataset: { stationId: "s", droneId: "d" } });
let review = "";
CONFIG.Dice.rolls = [];
foundry.applications.api.DialogV2.prompt = async (opts) => {
  review = opts.content;
  return null;
};
const fresh = {
  snapshot: "x",
  result: { zone: 3, dc: 23, dice: 2 },
  operator: { uuid: operator.uuid, name: operator.name },
  targets: [{ key: target.uuid, uuid: target.uuid, name: target.name }]
};
await guidedMineResolution({
  ship,
  fresh,
  choice: { type: "fire" },
  excluded: "",
  recipients: ["gm"],
  plan: async () => fresh,
  mineId: "m1",
  droneId: "d1"
});
for (const [name, content, js] of [
  [
    "harry",
    harry,
    `const sel=app.querySelector('[name=target]'); sel.value='Actor.target'; checks.push({name:'target-selection',pass:sel.options.length===2 && sel.value==='Actor.target'},{name:'native-dc',pass:app.textContent.includes('23')});`
  ],
  [
    "mine-review",
    review,
    `const sel=app.querySelector('[name=save0]'); sel.value='2'; const dmg=app.querySelector('[name=damageTotal]'); dmg.value='9'; checks.push({name:'manual-save',pass:sel.options.length===5 && sel.value==='2'},{name:'manual-damage',pass:dmg.value==='9'});`
  ]
]) {
  const html = `<!doctype html><meta charset="utf-8"><form id="app">${content}</form><pre id="result">waiting</pre><script>const app=document.querySelector('#app'); const checks=[]; ${js} document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});</script>`;
  fs.writeFileSync(`${out}/${name}.html`, html);
}
console.log("Wrote 2 drone assistant dialog fixtures to " + out);
