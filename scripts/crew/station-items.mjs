/**
 * station actions on the character sheet.
 *
 * While a Tactical Starship Combat exists, every crew member who occupies a station receives the actions of that
 * station as native sf2e Items of type "action" (the same document type as Compendium.sf2e.actions). They appear on
 * the character sheet's Actions tab, can be posted to chat like any system action, and contain a
 * "Perform on the ship" link that runs the module's authoritative action flow.
 * The items are removed automatically when the crew member changes or leaves the station, leaves the crew,
 * or when the starship combat ends. Only the active GM writes; synchronisation is idempotent (diff by flag).
 */
import { MODULE_ID, HOOK_EVENTS, STARSHIP_TAG } from "../constants.mjs";
import { Content, actionsForStation } from "../content/loader.mjs";
import { allStarships, readStarship, isStarship } from "../starship/starship-state.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { gradeIndex } from "../engine/advancement.mjs";
import { ct } from "../content/content-i18n.mjs";
import { isActiveGM, T, escapeHtml, fromUuidSafe } from "../utils/foundry.mjs";
import { serialize } from "../utils/serial.mjs";
import { log, notifyError, notifyWarn } from "../utils/logging.mjs";

export const ITEM_FLAG = "stationAction";
const ICONS = { 1: "OneAction", 2: "TwoActions", 3: "ThreeActions", free: "FreeAction", reaction: "Reaction", passive: "Passive" };

export const stationKey = (f) => `${f?.shipUuid}|${f?.stationId}|${f?.actionId}`;
export const stationFlagOf = (item) => item?.flags?.[MODULE_ID]?.[ITEM_FLAG] ?? null;
export const isStationItem = (item) => !!stationFlagOf(item);

/** Module cost (number | number[] | "reaction" | "free") → sf2e actionType / actions. */
export function actionTypeFor(cost) {
  if (cost === "reaction") return { actionType: "reaction", actions: null };
  if (cost === "free") return { actionType: "free", actions: null };
  const n = Array.isArray(cost) ? Math.min(...cost.map(Number)) : Number(cost ?? 1);
  if (!Number.isFinite(n)) return { actionType: "action", actions: 1 };
  if (n <= 0) return { actionType: "free", actions: null };
  return { actionType: "action", actions: Math.min(3, Math.max(1, Math.round(n))) };
}
export function actionIcon(cost) {
  const t = actionTypeFor(cost);
  return `systems/${game.system.id}/icons/actions/${ICONS[t.actionType === "action" ? t.actions : t.actionType]}.webp`;
}

/** Desired station items per crew actor UUID for the given ships (pure). */
export function desiredStationItems(ships, { actionsFor = (st) => actionsForStation(st.type, st.grade, gradeIndex) } = {}) {
  const out = new Map();
  for (const ship of ships) {
    const d = readStarship(ship);
    if (d.destroyed) continue;
    for (const st of d.stations ?? []) {
      if (!st.helmedBy) continue;
      const list = out.get(st.helmedBy) ?? [];
      for (const a of actionsFor(st)) {
        if (a.npcOnly) continue;
        list.push({
          shipUuid: ship.uuid,
          shipName: ship.name,
          stationId: st.id,
          stationName: st.name,
          actionId: a.id,
          crewUuid: st.helmedBy,
          action: a
        });
      }
      out.set(st.helmedBy, list);
    }
  }
  return out;
}

/** Diff existing flagged items against the desired list (pure). Duplicates are removed. */
export function planStationItems(existing, desired) {
  const want = new Map(desired.map((d) => [stationKey(d), d]));
  const seen = new Set();
  const remove = [];
  for (const it of existing) {
    const k = stationKey(stationFlagOf(it));
    // items made before 0.10.1 lack the starship tag: they are replaced, not kept
    const tagged = (it.system?.traits?.otherTags ?? []).includes(STARSHIP_TAG) && (it.system?.traits?.value ?? []).includes(STARSHIP_TAG);
    if (!want.has(k) || seen.has(k) || !tagged) remove.push(it.id);
    else seen.add(k);
  }
  const create = [...want.entries()].filter(([k]) => !seen.has(k)).map(([, d]) => d);
  return { create, remove };
}

function validTraits(traits) {
  const known = globalThis.CONFIG?.PF2E?.actionTraits ?? globalThis.CONFIG?.SF2E?.actionTraits ?? null;
  const list = (traits ?? []).map((t) => String(t).toLowerCase().replace(/\s+/g, "-"));
  return known ? list.filter((t) => Object.hasOwn(known, t)) : [];
}

const label = (a) => (game.i18n.has(`SF2eTSC.actions.${a.id}`) ? T(`SF2eTSC.actions.${a.id}`) : ct(a.name));

/** Item source for one station action (sf2e "action" item, like Compendium.sf2e.actions). */
export function stationItemData(d) {
  const a = d.action ?? Content.actions.get(d.actionId) ?? { id: d.actionId, name: d.actionId, cost: 1 };
  const t = actionTypeFor(a.cost);
  const station = ct(d.stationName ?? "");
  const link = `<a class="tsc-run-action" data-ship-uuid="${escapeHtml(d.shipUuid)}" data-station-id="${escapeHtml(d.stationId)}" data-action-id="${escapeHtml(a.id)}" data-crew-uuid="${escapeHtml(d.crewUuid ?? "")}"><i class="fa-solid fa-rocket"></i> ${escapeHtml(T("SF2eTSC.stationItems.run"))}</a>`;
  const head = `<p><strong>${escapeHtml(T("SF2eTSC.stationItems.source", { ship: d.shipName ?? "", station }))}</strong></p>`;
  const cost = Array.isArray(a.cost)
    ? `<p><em>${escapeHtml(T("SF2eTSC.stationItems.variableCost", { min: Math.min(...a.cost), max: Math.max(...a.cost) }))}</em></p>`
    : "";
  const body = typeof a.text === "string" ? ct(a.text) : "";
  return {
    name: `${label(a)} (${station})`,
    type: "action",
    img: actionIcon(a.cost),
    system: {
      actionType: { value: t.actionType },
      actions: { value: t.actions },
      category: (a.traits ?? []).includes("attack") ? "offensive" : "interaction",
      description: { value: `${head}<p>${link}</p>${cost}${body.startsWith("<") ? body : `<p>${body}</p>`}`, gm: "" },
      traits: { value: [...new Set([STARSHIP_TAG, ...validTraits(a.traits)])], rarity: "common", otherTags: [STARSHIP_TAG] },
      slug: `tsc-${a.id}`,
      rules: [],
      publication: { title: "SF2e Tactical Starship Combat", authors: "", license: "ORC", remaster: true }
    },
    flags: { [MODULE_ID]: { [ITEM_FLAG]: { shipUuid: d.shipUuid, stationId: d.stationId, actionId: a.id, crewUuid: d.crewUuid ?? null } } }
  };
}

/** GM: make every actor's station items match the current station assignments. */
export function syncStationItems() {
  if (!isActiveGM()) return Promise.resolve(null);
  return serialize("station-items", async () => {
    const combat = activeStarshipCombat();
    const desired = combat ? desiredStationItems(allStarships()) : new Map();
    const uuids = new Set(desired.keys());
    for (const a of game.actors) if (a.items?.some?.(isStationItem)) uuids.add(a.uuid);
    const stats = { created: 0, removed: 0 };
    for (const uuid of uuids) {
      const actor = await fromUuidSafe(uuid);
      if (!actor?.items || isStarship(actor)) continue;
      const plan = planStationItems(actor.items.filter(isStationItem), desired.get(uuid) ?? []);
      try {
        if (plan.remove.length) {
          await actor.deleteEmbeddedDocuments("Item", plan.remove);
          stats.removed += plan.remove.length;
        }
        if (plan.create.length) {
          await actor.createEmbeddedDocuments("Item", plan.create.map(stationItemData));
          stats.created += plan.create.length;
        }
      } catch (err) {
        log.warn(`station items sync failed for ${actor.name}`, err);
      }
    }
    return stats;
  });
}

/** Client: the "Perform on the ship" link inside the item description / chat card. */
export async function runStationItemLink(el) {
  const { shipUuid, stationId, actionId, crewUuid } = el.dataset;
  if (!shipUuid) return runPackActionLink(el);
  const ship = await fromUuidSafe(shipUuid);
  const action = Content.actions.get(actionId);
  if (!ship || !action) return notifyWarn("SF2eTSC.stationItems.gone");
  const station = readStarship(ship).stations.find((s) => s.id === stationId);
  if (!station?.helmedBy) return notifyWarn("SF2eTSC.stationItems.gone");
  const crew = await fromUuidSafe(station.helmedBy);
  if (crewUuid && station.helmedBy !== crewUuid) return notifyWarn("SF2eTSC.stationItems.gone");
  if (!game.user.isGM && !crew?.testUserPermission?.(game.user, "OWNER")) return notifyWarn("SF2eTSC.errors.noPermission");
  const { runAction } = await import("../ui/action-runner.mjs");
  return runAction(action, { ship, crew, station });
}

/** Candidate crew actors of the clicking user: the sheet the link sits on, assigned character, controlled tokens. */
function userCrewCandidates(el) {
  const out = new Set();
  const sheetId = el.closest?.("[data-actor-id]")?.dataset?.actorId;
  const a = sheetId ? game.actors.get(sheetId) : null;
  if (a) out.add(a.uuid);
  if (game.user.character) out.add(game.user.character.uuid);
  for (const t of globalThis.canvas?.tokens?.controlled ?? []) if (t.actor && !isStarship(t.actor)) out.add(t.actor.uuid);
  return out;
}
/** Pure: pick the ship + station on which `crewUuids` may perform `action`. */
export function resolvePackAction(action, ships, crewUuids, { controlledShips = [], isGM = false } = {}) {
  const fits = (st) => action.station === "any" || action.station === st.type || action.station === "npc";
  for (const ship of ships) {
    const d = readStarship(ship);
    const st = d.stations.find((s) => s.helmedBy && crewUuids.has(s.helmedBy) && fits(s));
    if (st) return { ship, station: st, crewUuid: st.helmedBy };
  }
  if (isGM)
    for (const ship of controlledShips) {
      const d = readStarship(ship);
      const st = d.stations.find((s) => fits(s) && s.type === action.station) ?? d.stations.find(fits) ?? null;
      return { ship, station: st, crewUuid: st?.helmedBy ?? null };
    }
  return null;
}
async function runPackActionLink(el) {
  const action = Content.actions.get(el.dataset.actionId);
  if (!action) return notifyWarn("SF2eTSC.stationItems.gone");
  const controlledShips = (globalThis.canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter((a) => a && isStarship(a));
  const r = resolvePackAction(action, allStarships(), userCrewCandidates(el), { controlledShips, isGM: game.user.isGM });
  if (!r) return notifyWarn("SF2eTSC.stationItems.needStation");
  const crew = r.crewUuid ? await fromUuidSafe(r.crewUuid) : null;
  if (!game.user.isGM && !crew?.testUserPermission?.(game.user, "OWNER")) return notifyWarn("SF2eTSC.errors.noPermission");
  const { runAction } = await import("../ui/action-runner.mjs");
  return runAction(action, { ship: r.ship, crew, station: r.station });
}

export function registerStationItems() {
  const sync = foundry.utils.debounce(() => {
    syncStationItems().catch((err) => log.error("station items sync failed", err));
  }, 250);
  for (const h of [
    HOOK_EVENTS.combatStarted,
    HOOK_EVENTS.combatEnded,
    HOOK_EVENTS.crewChanged,
    HOOK_EVENTS.stationClaimed,
    "createCombat",
    "deleteCombat"
  ])
    Hooks.on(h, () => {
      if (isActiveGM()) sync();
    });
  Hooks.on("updateCombat", (c, changes) => {
    if (isActiveGM() && ("started" in changes || changes.flags?.[MODULE_ID])) sync();
  });
  Hooks.on("updateActor", (actor, changes) => {
    if (isActiveGM() && isStarship(actor) && changes.flags?.[MODULE_ID]) sync();
  });
  Hooks.on("deleteActor", (actor) => {
    if (isActiveGM() && isStarship(actor)) sync();
  });
  Hooks.once("ready", () => {
    if (isActiveGM()) sync();
  });
  if (game.ready && isActiveGM()) sync();
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target?.closest?.("a.tsc-run-action");
      if (!a) return;
      ev.preventDefault();
      ev.stopPropagation();
      runStationItemLink(a).catch((err) => notifyError("SF2eTSC.errors.generic", { message: err.message }));
    },
    true
  );
}
