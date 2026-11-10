import { MODULE_ID, FLAGS } from "../constants.mjs";
import { addObject, moveObject } from "../engine/sensor-ops.mjs";
import { isStarship } from "../starship/starship-state.mjs";

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
export function dropActorOnMap(state, actor, zone, { publicActor = false } = {}) {
  if (!actor || actor.documentName !== "Actor" || typeof actor.uuid !== "string" || !actor.uuid || !actor.name)
    throw new Error("invalidActor");
  if (!Number.isInteger(zone) || zone < 1 || zone > state.zones) throw new Error("invalidZone");
  const ship = isStarship(actor);
  const hazard = !ship && actor.type === "hazard";
  if (!ship && !hazard) throw new Error("unsupportedActor");
  const matches = state.objects.filter((o) => o.actorUuid === actor.uuid || o.key === actor.uuid);
  if (matches.length > 1) throw new Error("duplicateActors");
  if (matches.length) {
    const old = matches[0];
    if (old.mineRef) throw new Error("managedMine");
    return { state: old.zone === zone ? state : moveObject(state, old.key, zone), result: old.zone === zone ? "unchanged" : "moved" };
  }
  if (!publicActor) throw new Error("disclosureRequired");
  const rawHeading = actor.flags?.[MODULE_ID]?.[FLAGS.STARSHIP]?.heading;
  const heading = ship && ["left", "right"].includes(rawHeading) ? rawHeading : null;
  const object = {
    key: actor.uuid,
    actorUuid: actor.uuid,
    type: ship ? "starship" : "hazard",
    name: actor.name,
    zone,
    heading,
    detection: { party: "identified" },
    ...(ship ? { mapTransform: { baseDirection: "unknown" } } : { icon: "⚠" })
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
  return { state: next, result: "added" };
}
