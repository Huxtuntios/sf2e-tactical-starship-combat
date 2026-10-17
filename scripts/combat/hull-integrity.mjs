import { HOOK_EVENTS } from "../constants.mjs";
import { calculateHullIntegrityDC, hullIntegrityDelta, resolveCompromisedChange } from "../engine/compromised.mjs";
import { rollFlatCheck } from "../starship/stats.mjs";
import { readStarship, writeStarship } from "../starship/starship-state.mjs";
import { postIntegrityCard } from "../chat/chat-cards.mjs";
import { Initiative } from "./initiative.mjs";
import { T } from "../utils/foundry.mjs";
import { DEGREE_KEYS } from "../constants.mjs";

/** Hull integrity flat check (DC 10 + compromised). Runs on the ship's compromised initiative entry. */
export async function runHullIntegrityCheck(ship, combat = null) {
  const data = foundry.utils.deepClone(readStarship(ship));
  if (data.compromised <= 0 || data.destroyed) return null;
  const dc = calculateHullIntegrityDC(data.compromised);
  const res = await rollFlatCheck({ actor: ship, dc, label: T("SF2eTSC.chat.hullIntegrity") });
  const delta = hullIntegrityDelta(res.degree);
  const change = resolveCompromisedChange({ compromised: data.compromised, wrecked: data.wrecked, inoperable: data.inoperable }, delta);
  data.compromised = change.compromised;
  data.wrecked = change.wrecked;
  data.inoperable = change.inoperable;
  data.destroyed = change.destroyed || data.destroyed;
  await writeStarship(ship, data, { hullPatch: data.hp });
  const outcome = change.destroyed ? T("SF2eTSC.chat.destroyed") : change.lostCompromised ? T("SF2eTSC.chat.lostCompromised") : null;
  await postIntegrityCard({
    actor: ship,
    dc,
    degreeLabel: T(`SF2eTSC.degree.${DEGREE_KEYS[res.degree]}`),
    delta,
    newValue: change.compromised,
    outcomeText: outcome
  });
  if (change.destroyed) Hooks.callAll(HOOK_EVENTS.destroyed, ship);
  if (change.lostCompromised && combat) await Initiative.leaveCompromised(combat, ship);
  return { ...change, degree: res.degree, dc, delta };
}
