import { linkContextDCs, stationDCRows } from "../rolls/context-dc.mjs";
import { checkLinksHTML } from "../content/inline-checks.mjs";
/**
 * Station actions for the user's helmed stations: one model shared by the Station HUD window and the action dock of
 * the Sensor Map, so both always offer the same buttons with the same warnings.
 */
import { Content, actionsForStation } from "../content/loader.mjs";
import { allStarships, readStarship, statusOf } from "../starship/starship-state.mjs";
import { gradeIndex } from "../engine/advancement.mjs";
import { previewAction, runAction, COST_ICON } from "./action-runner.mjs";
import { activeStarshipCombat, combatantForActor } from "../combat/tsc-state.mjs";
import { actionLabel } from "../actions/action-engine.mjs";
import { ct, ctPlain } from "../content/content-i18n.mjs";
import { traitsText } from "../utils/labels.mjs";
import { T } from "../utils/foundry.mjs";
import { occupantView } from "../crew/occupant.mjs";

/** Crew actors the user controls (controlled token first, then owned characters). */
function myCrewActors() {
  const out = [];
  for (const t of canvas?.tokens?.controlled ?? []) if (t.actor?.isOwner) out.push(t.actor);
  for (const a of game.actors) if (a.type === "character" && a.testUserPermission(game.user, "OWNER") && !out.includes(a)) out.push(a);
  return out;
}

/** Every station helmed by one of the user's characters. */
export function findHelmedStations() {
  const found = [];
  const crews = myCrewActors();
  for (const ship of allStarships()) {
    const d = readStarship(ship);
    for (const st of d.stations) {
      if (!st.helmedBy) continue;
      const crew = crews.find((c) => c.uuid === st.helmedBy);
      if (crew) found.push({ ship, data: d, station: st, crew });
    }
  }
  return found;
}

/** Full action description (rules text, requirements, traits). */
function actionDescHTML(a, context) {
  const t = linkContextDCs(ct(a.text ?? ""), context);
  const body = String(t).trim().startsWith("<") ? t : `<p>${checkLinksHTML(t)}</p>`;
  const traits = traitsText(a.traits);
  return `${traits ? `<p class="tsc-dim">${traits}</p>` : ""}${body}`;
}

const pct = (v, max) => Math.round((v / Math.max(1, max)) * 100);

/** Context for one helmed station (`index` picks among several); `{ none: true }` when the user helms nothing. */
export function buildHudContext(index = 0, list = findHelmedStations()) {
  if (!list.length) return { none: true };
  const at = Math.min(Math.max(0, index), list.length - 1);
  const { ship, data, station, crew } = list[at];
  const combat = activeStarshipCombat();
  const cb = combat ? combatantForActor(combat, crew) : null;
  const def = Content.stations.get(station.type);
  const actions = actionsForStation(station.type, station.grade, gradeIndex);
  const extra = ["repair-station", "jump-start"].map((id) => Content.actions.get(id)).filter(Boolean);
  const rows = [...actions, ...extra.filter((e) => !actions.includes(e))].map((a) => {
    const p = previewAction(a, { ship, crew, station, combat });
    return {
      id: a.id,
      name: actionLabel(a),
      icon: COST_ICON(a.cost),
      traits: traitsText(a.traits),
      enabled: p.enabled,
      reasons: p.reasons.join(" · "),
      warnings: (p.warnings ?? []).join(" · "),
      text: ctPlain(a.text),
      desc: actionDescHTML(a, { crew, ship }),
      reaction: a.cost === "reaction",
      needsTarget: a.targeting?.type === "starship",
      frequency: a.frequency ? T(`SF2eTSC.frequency.${a.frequency.per}`) : null
    };
  });
  return {
    none: false,
    index: at,
    selectors: list.map((s, i) => ({
      i,
      label: `${s.crew.name} — ${ct(s.station.name)} (${s.ship.name})`,
      short: ct(s.station.name),
      active: i === at
    })),
    ship: ship.name,
    shipStatus: T(`SF2eTSC.status.${statusOf(data)}`),
    station: ct(station.name),
    grade: T(`SF2eTSC.grades.${station.grade}`),
    stationIcon: def?.icon ?? "fa-solid fa-gear",
    crew: crew.name,
    occupant: occupantView(crew.uuid, { fallbackName: crew.name }),
    noCombatant: !!combat && !cb,
    malfunctioning: station.malfunctioning,
    hp: data.hp,
    sp: data.sp,
    hpPct: pct(data.hp.value, data.hp.max),
    spPct: pct(data.sp.value, data.sp.max),
    dcRows: stationDCRows(crew),
    inCombat: !!combat,
    actions: rows,
    passive: ct(def?.passive ?? ""),
    shipUuid: ship.uuid,
    stationId: station.id,
    crewUuid: crew.uuid
  };
}

/** Run one catalogue action of the picked station through the normal client flow (target pick, options, GM execution). */
export async function runHudAction(index, actionId) {
  const list = findHelmedStations();
  const sel = list[Math.min(Math.max(0, index), list.length - 1)];
  if (!sel) return;
  const action = Content.actions.get(actionId);
  if (!action) return;
  await runAction(action, { ship: sel.ship, crew: sel.crew, station: sel.station });
}
