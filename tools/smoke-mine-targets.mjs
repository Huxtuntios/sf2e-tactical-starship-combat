/** Фикстура настоящего содержимого диалога, локальный Chromium; не Foundry. */
import fs from "node:fs";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../tests/helpers/foundry-mock.mjs";
import { modifyOwnedMine } from "../scripts/actions/mine-modification.mjs";
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
for (const smart of [true, false]) {
  installFoundryMock();
  await loadContentFromDisk();
  const operator = makeCharacter({ id: "operator", name: "Operator" });
  operator.system.details = { level: { value: 3 } };
  operator.classDC = { dc: { value: 19 } };
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    stations: [{ id: "s1", type: "drone-console", grade: "commercial", helmedBy: operator.uuid }],
    crew: [{ actorUuid: operator.uuid, role: "crew", stationId: "s1" }]
  });
  const target = makeShip({ id: "target", name: "Target" });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 3 },
      { key: target.uuid, zone: 3 }
    ]
  });
  await combat.createEmbeddedDocuments("Combatant", [{ _id: "op", actorId: operator.id, initiative: 20 }]);
  const { patchStarship } = await import("../scripts/starship/starship-state.mjs");
  await patchStarship(
    ship,
    (d) => {
      d.drones = [
        {
          id: "d1",
          stationId: "s1",
          tscVersion: 1,
          ref: "pyrotechnics-drone",
          deployed: true,
          mines: [
            { id: "m1", droneId: "d1", shipUuid: ship.uuid, operatorUuid: operator.uuid, combatId: combat.id, zone: 3, state: "armed" }
          ]
        }
      ];
      if (smart)
        modifyOwnedMine({
          data: d,
          shipUuid: ship.uuid,
          stationId: "s1",
          droneId: "d1",
          mineId: "m1",
          operator,
          combat,
          shipZone: 3,
          origin: 3,
          type: "smart",
          modificationId: "mineMod-abcdefgh"
        });
    },
    { history: false }
  );
  let content = "";
  foundry.applications.api.DialogV2.prompt = async (options) => {
    content = options.content;
    return null;
  };
  const { prepareMineDetonation } = await import("../scripts/ui/sheet/sheet-actions.mjs");
  await prepareMineDetonation.call({ document: ship }, null, { dataset: { stationId: "s1", droneId: "d1", mineId: "m1" } });
  const html = `<!doctype html><meta charset="utf-8"><form id="app">${content}</form><pre id="result">waiting</pre><script>
  const app=document.querySelector('#app'); const select=app.querySelector('[name=excludedTarget]');
  if(select) select.value='Actor.target';
  const checks=[{name:'ships',pass:app.textContent.includes('Ship')&&app.textContent.includes('Target')}, {name:'smart-only-selection',pass:${smart} ? !!select && select.options.length===3 && select.value==='Actor.target' : !select}, {name:'damage-types',pass:app.querySelector('[name=damageType]').options.length===2}];
  document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(x=>x.pass)});</script>`;
  fs.writeFileSync(`${out}/${smart ? "smart" : "ordinary"}.html`, html);
}
console.log("Wrote 2 mine target dialog fixtures to " + out);
