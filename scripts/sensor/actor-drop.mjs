import { MODULE_ID, FLAGS } from "../constants.mjs";
import { addObject, moveObject } from "../engine/sensor-ops.mjs";
import { isStarship } from "../starship/starship-state.mjs";
import { initialShipTransform } from "./appearance.mjs";

/** Данные события не являются доверенным документом: авторитетный GM повторно разрешает UUID. */
export function sensorDragData(event) {
  try {
    const editorClass = globalThis.foundry?.applications?.ux?.TextEditor;
    const editor = editorClass?.implementation ?? editorClass ?? globalThis.TextEditor;
    return editor?.getDragEventData?.(event) ?? JSON.parse(event.dataTransfer?.getData("text/plain") || "null");
  } catch {
    return null;
  }
}

/** Новые записи становятся общедоступными только после явного подтверждения ведущего. */
export function dropActorOnMap(state, actor, zone, { publicActor = false, reuseActor = false, key = actor?.uuid } = {}) {
  if (!actor || actor.documentName !== "Actor" || typeof actor.uuid !== "string" || !actor.uuid || !actor.name)
    throw new Error("invalidActor");
  if (!Number.isInteger(zone) || zone < 1 || zone > state.zones) throw new Error("invalidZone");
  const ship = isStarship(actor);
  const hazard = !ship && actor.type === "hazard";
  if (!ship && !hazard) throw new Error("unsupportedActor");
  const additionalReference = key !== actor.uuid;
  const actorMatches = state.objects.filter((o) => o.actorUuid === actor.uuid || o.key === actor.uuid);
  if (additionalReference) {
    if (typeof key !== "string" || !key || state.objects.some((o) => o.key === key)) throw new Error("duplicateActors");
    if (actorMatches.some((o) => o.mineRef)) throw new Error("managedMine");
  } else {
    if (actorMatches.length > 1) throw new Error("duplicateActors");
    if (actorMatches.length) {
      const old = actorMatches[0];
      if (old.mineRef) throw new Error("managedMine");
      return {
        state: old.zone === zone ? state : moveObject(state, old.key, zone),
        result: old.zone === zone ? "unchanged" : "moved",
        key: old.key
      };
    }
  }
  if (!publicActor) throw new Error("disclosureRequired");
  const rawHeading = actor.flags?.[MODULE_ID]?.[FLAGS.STARSHIP]?.heading;
  const heading = ship && ["left", "right"].includes(rawHeading) ? rawHeading : null;
  const object = {
    key,
    actorUuid: actor.uuid,
    ...(reuseActor ? { reuseActor: true } : {}),
    type: ship ? "starship" : "hazard",
    name: actor.name,
    zone,
    heading,
    detection: { party: "identified" },
    ...(ship ? { mapTransform: initialShipTransform(actor.flags?.[MODULE_ID]?.[FLAGS.STARSHIP]?.mapTransform, heading) } : { icon: "⚠" })
  };
  let next = addObject(state, object);
  if (hazard)
    next = {
      ...next,
      hazardState: {
        ...next.hazardState,
        [actor.uuid]: { disabled: false, placement: "sensor", ...(next.hazardState?.[actor.uuid] ?? {}) }
      }
    };
  return { state: next, result: "added", key };
}
