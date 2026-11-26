import { MODULE_ID } from "../constants.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { turnKey } from "../engine/cost.mjs";
import { resolveSensorActor } from "../sensor/map-object.mjs";
import { openEffectManager } from "./effect-manager.mjs";
import { gmActionObjects } from "./hud-model.mjs";

export function resolveGmActionObjectKey(view, combatant, combat) {
  const objects = view.filter((object) => ["starship", "hazard"].includes(object.type));
  const exact = (key) => (objects.some((object) => object.key === key) ? key : null);
  const unique = (uuid) => {
    if (!uuid) return null;
    const matches = objects.filter((object) => object.key === uuid || object.actorUuid === uuid);
    return matches.length === 1 ? matches[0].key : null;
  };
  const flags = combatant?.flags?.[MODULE_ID] ?? {};
  const mapRef = flags.sensorMapObject;
  if (mapRef && (!mapRef.combatId || mapRef.combatId === combat?.id)) {
    const key = exact(mapRef.key);
    if (key) return key;
  }
  const instanceRef = flags.sensorContactInstance;
  if (instanceRef && (!instanceRef.combatId || instanceRef.combatId === combat?.id)) {
    const key = unique(instanceRef.actorUuid);
    if (key) return key;
  }
  const actorKey = unique(combatant?.actor?.uuid);
  if (actorKey) return actorKey;
  return combatant?.actorId ? unique(`Actor.${combatant.actorId}`) : null;
}

export function gmActionSelection(view, objectKey, isGM, app = null) {
  if (!isGM) return { actionObjects: undefined, actionSelection: null, actionObjectKey: null, autoActionSelection: true };
  if (app) {
    app.autoActionSelection ??= true;
    const currentTurnKey = turnKey(activeStarshipCombat());
    if (app.gmActionOverride && app.gmActionOverride.turnKey !== currentTurnKey) app.gmActionOverride = null;
    if (app.autoActionSelection && !app.gmActionOverride)
      objectKey = resolveGmActionObjectKey(view, activeStarshipCombat()?.combatant, activeStarshipCombat());
  }
  const actionObjects = gmActionObjects(view);
  if (app) app.actionObjectKeys = actionObjects.map((object) => object.key);
  const actionObjectKey = actionObjects.some((object) => object.key === objectKey) ? objectKey : null;
  const actionSelection = actionObjects.find((object) => object.key === actionObjectKey) ?? null;
  if (actionSelection) actionSelection.selected = true;
  return { actionObjects, actionSelection, actionObjectKey, autoActionSelection: app?.autoActionSelection ?? true };
}

function availableActionObjectKeys(app) {
  const select = app.element?.querySelector?.("[data-tsc-action-object]");
  return select ? [...select.options].map((option) => option.value) : (app.actionObjectKeys ?? []);
}

export async function selectGmActionObjectKey(app, objectKey) {
  if (!game.user.isGM || (objectKey != null && typeof objectKey !== "string")) return;
  const key = objectKey || null;
  if (key && !availableActionObjectKeys(app).includes(key)) return;
  app.actionObjectKey = key;
  app.gmActionOverride = { turnKey: turnKey(activeStarshipCombat()), objectKey: key };
  await app.render({ parts: ["bar", "zones", "dock"] });
}

export async function selectGmActionObject(app, target) {
  return selectGmActionObjectKey(app, target.value || target.dataset.objectKey || null);
}

export async function setGmAutoActionSelection(app, enabled) {
  if (!game.user.isGM) return;
  app.autoActionSelection = enabled === true;
  app.gmActionOverride = null;
  await app.render({ parts: ["bar", "zones", "dock"] });
}

export function handleGmActionContextMenu(app, event) {
  if (!game.user.isGM || event.button !== 2) return false;
  const object = event.target?.closest?.(".tsc-obj[data-object-key]");
  const key = object?.dataset?.objectKey;
  if (!key || !app.element?.contains?.(object) || !availableActionObjectKeys(app).includes(key)) return false;
  event.preventDefault();
  event.stopPropagation();
  selectGmActionObjectKey(app, key);
  return true;
}

export function wireGmActionControls(app) {
  const select = app.element.querySelector("[data-tsc-action-object]");
  if (select && !select.dataset.tscActionObject) {
    select.dataset.tscActionObject = "1";
    select.addEventListener("change", () => selectGmActionObject(app, select));
  }
  const toggle = app.element.querySelector("[data-tsc-auto-action-object]");
  if (toggle && !toggle.dataset.tscAutoActionObject) {
    toggle.dataset.tscAutoActionObject = "1";
    toggle.addEventListener("change", () => setGmAutoActionSelection(app, toggle.checked));
  }
  if (!app.element.dataset.tscGmActionContext) {
    app.element.dataset.tscGmActionContext = "1";
    app.element.addEventListener("contextmenu", (event) => handleGmActionContextMenu(app, event), true);
  }
}

export async function openGmEffectManager(_event, button) {
  if (!game.user.isGM) return null;
  return openEffectManager(await resolveSensorActor(activeStarshipCombat(), button.dataset.shipUuid));
}
