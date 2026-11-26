import { linkContextDCs, stationDCRows } from "../rolls/context-dc.mjs";
import { checkLinksHTML } from "../content/inline-checks.mjs";
/**
 * Station actions for the user's helmed stations: one model shared by the Station HUD window and the action dock of
 * the Sensor Map, so both always offer the same buttons with the same warnings.
 */
import { Content, actionsForStation } from "../content/loader.mjs";
import { allStarships, isStarship, readStarship, statusOf } from "../starship/starship-state.mjs";
import { gradeIndex } from "../engine/advancement.mjs";
import { previewAction, runAction, COST_ICON } from "./action-runner.mjs";
import { actionCostLabel } from "./action-controls.mjs";
import { activeStarshipCombat, combatantForActor, getTsc } from "../combat/tsc-state.mjs";
import { actionLabel } from "../actions/action-engine.mjs";
import { collectNpcActions } from "../actions/npc-rows.mjs";
import { npcActionDescription } from "../actions/npc-inline.mjs";
import { ct, ctPlain } from "../content/content-i18n.mjs";
import { traitsText } from "../utils/labels.mjs";
import { T, fromUuidSync_ } from "../utils/foundry.mjs";
import { occupantView } from "../crew/occupant.mjs";
import { stationEffects } from "../starship/effects.mjs";
import { effectCaption } from "./effect-editor.mjs";
import { privateContacts } from "../sensor/private-contacts.mjs";
import { resolveSensorActor } from "../sensor/map-object.mjs";
import { HazardEngine, hazardFlags } from "../hazards/hazard-engine.mjs";
import { parseRoutineActions } from "../engine/hazard-rules.mjs";

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
  const source = a.inline ? npcActionDescription(a, ct) : (a.text ?? "");
  const t = linkContextDCs(ct(source), context);
  const body = String(t).trim().startsWith("<") ? t : `<p>${checkLinksHTML(t)}</p>`;
  const traits = traitsText(a.traits);
  return `${traits ? `<p class="tsc-dim">${traits}</p>` : ""}${body}`;
}

const pct = (v, max) => Math.round((v / Math.max(1, max)) * 100);

function stationActions(data, station) {
  const actions = actionsForStation(station.type, station.grade, gradeIndex, { data, station });
  const extra = ["repair-station", "jump-start"].map((id) => Content.actions.get(id)).filter(Boolean);
  return [...actions, ...extra.filter((entry) => !actions.includes(entry))];
}

function actionRow(action, context, key = action.id) {
  const { ship, crew, station } = context;
  const preview = previewAction(action, { ship, crew, station, combat: activeStarshipCombat() });
  return {
    key,
    id: action.id,
    name: actionLabel(action),
    icon: COST_ICON(action.cost),
    costLabel: actionCostLabel(action.cost),
    traits: traitsText(action.traits),
    enabled: preview.enabled,
    reasons: preview.reasons.join(" · "),
    warnings: (preview.warnings ?? []).join(" · "),
    text: ctPlain(action.text),
    desc: actionDescHTML(action, { crew, ship }),
    reaction: action.cost === "reaction",
    needsTarget: action.targeting?.type === "starship",
    frequency: action.frequency ? T(`SF2eTSC.frequency.${action.frequency.per}`) : null,
    crewUuid: crew?.uuid ?? null,
    stationId: station?.id ?? null
  };
}

/** Context for one helmed station (`index` picks among several); `{ none: true }` when the user helms nothing. */
export function buildHudContext(index = 0, list = findHelmedStations()) {
  if (!list.length) return { none: true };
  const at = Math.min(Math.max(0, index), list.length - 1);
  const { ship, data, station, crew } = list[at];
  const combat = activeStarshipCombat();
  const cb = combat ? combatantForActor(combat, crew) : null;
  const def = Content.stations.get(station.type);
  const rows = stationActions(data, station).map((action) => actionRow(action, { ship, crew, station }));
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
    boosted: stationEffects(data.effects, station.id, combat).some((e) => e.slug === "boost-battle-station"),
    boostCaption: stationEffects(data.effects, station.id, combat)
      .filter((e) => e.slug === "boost-battle-station")
      .map(effectCaption)
      .join(" · "),
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

function gmObjects(combat) {
  const publicObjects = getTsc(combat).objects;
  try {
    const privateObjects = privateContacts(combat.id);
    return [...publicObjects.filter((object) => !privateObjects.some((contact) => contact.key === object.key)), ...privateObjects];
  } catch {
    return publicObjects;
  }
}

export function gmActionObjects(view) {
  const positions = new Map();
  const out = [];
  for (const object of view) {
    const position = (positions.get(object.zone) ?? 0) + 1;
    positions.set(object.zone, position);
    if (!["starship", "hazard"].includes(object.type)) continue;
    out.push({
      key: object.key,
      label: object.label,
      type: object.type,
      typeLabel: T(`SF2eTSC.objectTypes.${object.type}`),
      zone: object.zone,
      order: position,
      positionLabel: T("SF2eTSC.ui.mapPosition", { zone: object.zone, position })
    });
  }
  return out;
}

function hazardRow(object, actor, key) {
  const flags = hazardFlags(actor) ?? {};
  const complex = !!flags.isComplex;
  const routine = flags.routine ?? {};
  const text = complex
    ? (routine.text ?? actor.system?.details?.routine ?? "")
    : (flags.effectText ?? flags.actions?.[0]?.text ?? actor.system?.details?.routine ?? "");
  const disabled = !!object.hazardState?.disabled;
  const mine = !!object.mineRef;
  const cost = complex ? parseRoutineActions(routine.cost) : 1;
  const id = complex ? "hazard-routine" : "hazard-trigger";
  const name = T(`SF2eTSC.hazards.${complex ? "routine" : "trigger"}`);
  const reasons = disabled
    ? [T("SF2eTSC.ui.hazardDisabled")]
    : mine
      ? [T("SF2eTSC.mineContact.managedHint")]
      : text
        ? []
        : [T("SF2eTSC.ui.noActions")];
  return {
    key,
    id,
    kind: "hazard",
    hazardAction: complex ? "routine" : "trigger",
    name,
    icon: COST_ICON(cost),
    costLabel: actionCostLabel(cost),
    traits: "",
    enabled: !disabled && !mine && !!text,
    reasons: reasons.join(" · "),
    warnings: "",
    text: ctPlain(text),
    desc: `<p>${checkLinksHTML(ct(text))}</p>`,
    reaction: false,
    needsTarget: false,
    frequency: null,
    crewUuid: null,
    stationId: null
  };
}

export async function buildGmHudContext(objectKey) {
  if (!game.user.isGM) return null;
  const combat = activeStarshipCombat();
  if (!combat) return { none: true, gm: true, objectKey };
  const objects = gmObjects(combat);
  const object = objects.find((entry) => entry.key === objectKey);
  if (!object || !["starship", "hazard"].includes(object.type)) return { none: true, gm: true, objectKey };
  const zoneObjects = objects.filter((entry) => entry.zone === object.zone);
  const order = zoneObjects.findIndex((entry) => entry.key === objectKey) + 1;
  const base = {
    none: false,
    gm: true,
    objectKey,
    label: object.name,
    type: object.type,
    zone: object.zone,
    order,
    positionLabel: T("SF2eTSC.ui.mapPosition", { zone: object.zone, position: order }),
    shipUuid: object.actorUuid ?? objectKey,
    canManageEffects: false,
    effectShipUuid: null,
    stationIcon: object.type === "hazard" ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-gear",
    station: T(object.type === "hazard" ? "SF2eTSC.ui.hazards" : "SF2eTSC.ui.gmActions")
  };
  const actor = await resolveSensorActor(combat, object.actorUuid ?? objectKey);
  if (!actor) return { ...base, none: true, actions: [] };
  if (object.type === "hazard" || !isStarship(actor))
    return { ...base, actions: [hazardRow({ ...object, hazardState: getTsc(combat).hazardState?.[objectKey] }, actor, "hazard")] };

  const data = readStarship(actor);
  const rows = [];
  if (data.role === "npc") {
    const entries = collectNpcActions(data, { actions: Content.actions.values(), get: (id) => Content.actions.get(id) });
    entries.forEach((entry, index) => {
      if (!entry.action || entry.action.passive || entry.issues.length) return;
      const key = `${index}:${entry.station?.id ?? "ship"}:${entry.id}`;
      rows.push({
        ...actionRow(entry.action, { ship: actor, crew: null, station: entry.station }, key),
        kind: "ship",
        action: entry.action,
        crewActor: null,
        station: entry.station
      });
    });
  } else {
    data.stations.forEach((station, stationIndex) => {
      const crew = station.helmedBy ? fromUuidSync_(station.helmedBy) : null;
      if (!crew) return;
      for (const action of stationActions(data, station)) {
        const key = `${stationIndex}:${station.id}:${action.id}`;
        rows.push({
          ...actionRow(action, { ship: actor, crew, station }, key),
          kind: "ship",
          action,
          crewActor: crew,
          station
        });
      }
    });
  }
  return {
    ...base,
    shipActor: actor,
    canManageEffects: true,
    effectShipUuid: actor.uuid,
    actions: rows
  };
}

export async function runGmHudAction(objectKey, actionKey, event = null) {
  if (!game.user.isGM) return null;
  const context = await buildGmHudContext(objectKey);
  if (context.none) return null;
  const row = context.actions.find((entry) => entry.key === actionKey || entry.id === actionKey);
  if (!row?.enabled) return null;
  if (row.kind === "hazard")
    return row.hazardAction === "routine"
      ? HazardEngine.executeRoutine(objectKey)
      : HazardEngine.trigger(objectKey, { reason: T("SF2eTSC.hazards.manualTrigger") });
  return runAction(row.action, { ship: context.shipActor, crew: row.crewActor, station: row.station, event });
}

/** Run one catalogue action of the picked station through the normal client flow (target pick, options, GM execution). */
export async function runHudAction(index, actionId, event = null) {
  const list = findHelmedStations();
  const sel = list[Math.min(Math.max(0, index), list.length - 1)];
  if (!sel) return;
  const action = Content.actions.get(actionId);
  if (!action) return;
  await runAction(action, { ship: sel.ship, crew: sel.crew, station: sel.station, event });
}
