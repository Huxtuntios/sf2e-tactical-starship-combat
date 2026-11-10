import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "dist", "ui-tests", "crew-stations"));
fs.mkdirSync(out, { recursive: true });
const h = Handlebars.create();
h.registerHelper("localize", (key, options) => {
  const labels = {
    "SF2eTSC.crewStations.intro": `${options.hash.actor}: choose a free station.`,
    "SF2eTSC.crewStations.current": `Current assignment: ${options.hash.station}`,
    "SF2eTSC.crewStations.unassigned": "Unassigned",
    "SF2eTSC.crewStations.available": "Free station",
    "SF2eTSC.crewStations.claim": "Claim station",
    "SF2eTSC.crewStations.release": "Leave station",
    "SF2eTSC.crewStations.malfunctioning": "malfunctioning",
    "SF2eTSC.crew.noShips": "No accessible ships."
  };
  return labels[key] ?? key;
});
const template = fs.readFileSync(path.join(root, "templates", "crew-stations-panel.hbs"), "utf8");
const html = h.compile(template)({
  empty: false,
  actorName: "Pilot",
  ships: [
    {
      uuid: "Actor.current",
      name: "Current ship",
      currentStation: { id: "pilot-1", name: "Pilot" },
      freeStations: [{ id: "gunner-1", name: "Gunner" }],
      claimDisabled: false
    },
    {
      uuid: "Actor.other",
      name: "Other ship",
      currentStation: null,
      freeStations: [{ id: "pilot-2", name: "Pilot" }],
      claimDisabled: false
    }
  ]
});
const fixture = `<!doctype html><meta charset="utf-8"><main id="app">${html}</main><pre id="result">waiting</pre>
<script>
const root=document.querySelector('#app');
const rows=[...root.querySelectorAll('[data-ship-row]')];
const current=rows[0], other=rows[1];
const checks=[
  {name:'current-assignment',pass:current.textContent.includes('Current assignment: Pilot')},
  {name:'release-command',pass:current.querySelector('[data-action="release"]')?.dataset.stationId==='pilot-1'},
  {name:'free-station-choice',pass:current.querySelector('[data-station-choice] option')?.value==='gunner-1'},
  {name:'claim-current-ship',pass:current.querySelector('[data-action="claim"]')?.disabled===false},
  {name:'claim-on-another-combat-ship',pass:other.querySelector('[data-action="claim"]')?.disabled===false}
];
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(c=>c.pass)});
</script>`;
fs.writeFileSync(path.join(out, "crew-stations.html"), fixture);
