import { OBJECT_TYPES } from "../sensor/object-types.mjs";
import { T } from "../utils/foundry.mjs";
import { request } from "../socket.mjs";
import { notifyError } from "../utils/logging.mjs";
export function objectTypeView(sel, isGM) {
  return isGM && OBJECT_TYPES.includes(sel.type)
    ? OBJECT_TYPES.map((id) => ({ id, label: T(`SF2eTSC.objectTypes.${id}`), selected: id === sel.type }))
    : null;
}
export function wireObjectType(root, combatId) {
  root.querySelectorAll("[data-object-type]").forEach((select) => {
    select.onchange = async () => {
      try {
        await request("sensorUpdate", { op: "type", key: select.dataset.objectType, type: select.value, combatId });
      } catch (err) {
        notifyError("SF2eTSC.errors.generic", { message: err.message });
      }
    };
  });
}
