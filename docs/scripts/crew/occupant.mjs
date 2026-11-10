import { MODULE_ID } from "../constants.mjs";

/**
 * One shared description of "who sits at this battle station", used by every view (sheet stations/crew tabs,
 * Station HUD, crew manager, canvas station markers) so portraits and placeholders stay identical everywhere.
 */
export const EMPTY_STATION_IMG = `modules/${MODULE_ID}/assets/icons/station-empty.svg`;
export const MISSING_CREW_IMG = `modules/${MODULE_ID}/assets/icons/crew-missing.svg`;
const DEFAULT_IMGS = new Set(["icons/svg/mystery-man.svg", "icons/svg/mystery-man-black.svg", ""]);

/** Portrait of an actor: Actor.img, falling back to its (prototype) token image when the portrait is a default icon. */
export function portraitOf(actor) {
  if (!actor) return null;
  const img = actor.img ?? "";
  if (img && !DEFAULT_IMGS.has(img)) return img;
  const tok = actor.token?.texture?.src ?? actor.prototypeToken?.texture?.src ?? "";
  if (tok && !DEFAULT_IMGS.has(tok) && !/\*/.test(tok)) return tok; // wildcard token paths can't be shown directly
  return img || tok || null;
}

/**
 * @param {string|null} actorUuid  station.helmedBy / crew.actorUuid
 * @param {object} [opts] { fallbackName, resolve(uuid) → Actor|null }
 * @returns {{uuid:string|null, empty:boolean, missing:boolean, name:string, img:string, tooltip:string}}
 */
export function occupantView(actorUuid, { fallbackName = null, resolve = defaultResolve, t = defaultT } = {}) {
  if (!actorUuid)
    return {
      uuid: null,
      empty: true,
      missing: false,
      name: t("SF2eTSC.crew.unoccupied"),
      img: EMPTY_STATION_IMG,
      tooltip: t("SF2eTSC.crew.unoccupied")
    };
  const actor = resolve(actorUuid);
  if (!actor) {
    const name = fallbackName ?? t("SF2eTSC.crew.missingActor");
    return {
      uuid: actorUuid,
      empty: false,
      missing: true,
      name,
      img: MISSING_CREW_IMG,
      tooltip: `${name} — ${t("SF2eTSC.crew.missingActor")}`
    };
  }
  return {
    uuid: actorUuid,
    empty: false,
    missing: false,
    name: actor.name,
    img: portraitOf(actor) ?? MISSING_CREW_IMG,
    tooltip: actor.name
  };
}

function defaultResolve(uuid) {
  try {
    return globalThis.fromUuidSync?.(uuid) ?? null;
  } catch {
    return null;
  }
}
function defaultT(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

/** Does a document change affect how an occupant is displayed? (portrait, name, token art) */
export function affectsOccupantDisplay(changes) {
  if (!changes || typeof changes !== "object") return false;
  return "img" in changes || "name" in changes || !!changes.prototypeToken?.texture || "texture" in changes;
}

/**
 * Is this actor crew of any starship (refresh routing)? Answered from a cached set of crew actor ids so the item /
 * effect / actor update hooks of the whole world cost one lookup instead of a scan of every starship.
 * The cache is dropped whenever a starship changes (see main.mjs).
 */
let crewIndex = null;
export function invalidateCrewIndex() {
  crewIndex = null;
}
function buildCrewIndex() {
  const set = new Set();
  for (const ship of game.actors) {
    const crew = ship.flags?.[MODULE_ID]?.starship?.crew;
    if (!Array.isArray(crew)) continue;
    for (const c of crew) {
      if (!c?.actorUuid) continue;
      set.add(c.actorUuid);
      const tail = /(Actor\.[^.]+)$/.exec(c.actorUuid);
      if (tail) set.add(tail[1]);
    }
  }
  return set;
}
export function isCrewMember(actor) {
  if (!actor) return false;
  crewIndex ??= buildCrewIndex();
  return crewIndex.has(actor.uuid) || crewIndex.has(`Actor.${actor.id}`);
}

/** Handlebars partial `{{> tscOccupant occupant size="sm|md|lg" hideName=true}}` (registered at init). */
export const OCCUPANT_PARTIAL = `<span class="tsc-occupant tsc-occ-{{#if size}}{{size}}{{else}}sm{{/if}} {{#if empty}}is-empty{{/if}} {{#if missing}}is-missing{{/if}}" data-tooltip="{{tooltip}}" data-occupant-uuid="{{uuid}}"><img class="tsc-occ-img" src="{{img}}" alt="{{name}}" loading="lazy" draggable="false">{{#unless hideName}}<span class="tsc-occ-name">{{name}}</span>{{/unless}}</span>`;
