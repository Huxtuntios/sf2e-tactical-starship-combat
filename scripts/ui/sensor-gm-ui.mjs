import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { resolveSensorActor } from "../sensor/map-object.mjs";
import { openEffectManager } from "./effect-manager.mjs";
import { gmActionObjects } from "./hud-model.mjs";

export function gmActionSelection(view, objectKey, isGM) {
  if (!isGM) return { actionObjects: undefined, actionSelection: null, actionObjectKey: null };
  const actionObjects = gmActionObjects(view);
  const actionObjectKey = actionObjects.some((object) => object.key === objectKey) ? objectKey : null;
  const actionSelection = actionObjects.find((object) => object.key === actionObjectKey) ?? null;
  if (actionSelection) actionSelection.selected = true;
  return { actionObjects, actionSelection, actionObjectKey };
}

export async function selectGmActionObject(app, target) {
  if (!game.user.isGM) return;
  app.actionObjectKey = target.value || target.dataset.objectKey || null;
  await app.render({ parts: ["bar", "zones", "dock"] });
}

export function wireGmActionObject(app, onChange) {
  const select = app.element.querySelector("[data-tsc-action-object]");
  if (!select || select.dataset.tscActionObject) return;
  select.dataset.tscActionObject = "1";
  select.addEventListener("change", (event) => onChange(event, select));
}

export async function openGmEffectManager(_event, button) {
  if (!game.user.isGM) return null;
  return openEffectManager(await resolveSensorActor(activeStarshipCombat(), button.dataset.shipUuid));
}
