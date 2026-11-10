import { MODULE_ID } from "../constants.mjs";
import { T } from "../utils/foundry.mjs";
import { isStarship } from "../starship/starship-state.mjs";
import { openSensorMap, openStationHUD, openStartWizard, openToolbox, openStarshipSheet, openNPCStarshipSheet } from "./launchers.mjs";
import { canConvertToStarship } from "../integrations/aztecs.mjs";
import { canConvert } from "../integrations/causodes.mjs";
import { defaultStarship } from "../engine/validation.mjs";
import { notifyWarn, notifyInfo } from "../utils/logging.mjs";
import { DATA_VERSION } from "../constants.mjs";

/** Marks an existing vehicle (player ship) or npc (enemy ship) as a starship. Ordinary vehicles are never converted implicitly. */
export async function convertToStarship(actor, role = actor.type === "vehicle" ? "player" : "npc") {
  if (!canConvertToStarship(actor)) return notifyWarn("SF2eTSC.integrations.aztecVehicle");
  if (!canConvert(actor)) return notifyWarn("SF2eTSC.integrations.causodesActor");
  if (!["vehicle", "npc"].includes(actor.type)) return notifyWarn("SF2eTSC.errors.badActorType");
  const base = defaultStarship();
  const data = {
    ...base,
    dataVersion: DATA_VERSION,
    role,
    level: actor.system.details?.level?.value ?? actor.level ?? 1,
    ac: actor.system.attributes.ac?.value ?? base.ac,
    fort: actor.system.saves?.fortitude?.value ?? base.fort,
    reflex: actor.system.saves?.reflex?.value ?? base.reflex,
    will: actor.system.saves?.will?.value ?? base.will,
    perception: actor.system.perception?.mod ?? 0,
    sp: { value: 0, max: 0 },
    heading: role === "player" ? "right" : "left"
  };
  delete data.hp;
  await actor.update({
    [`flags.${MODULE_ID}.starship`]: data,
    "flags.core.sheetClass": `${MODULE_ID}.${role === "player" ? "StarshipSheet" : "NPCStarshipSheet"}`
  });
  notifyInfo("SF2eTSC.ui.converted", { name: actor.name });
}
export async function revertStarship(actor) {
  await actor.unsetFlag(MODULE_ID, "starship");
  await actor.update({ "flags.core.-=sheetClass": null });
  notifyInfo("SF2eTSC.ui.reverted", { name: actor.name });
}

export function registerControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const group = controls.tokens ?? (Array.isArray(controls) ? controls.find((c) => c.name === "token" || c.name === "tokens") : null);
    if (!group) return;
    const add = (name, icon, titleKey, fn, gmOnly = false, order = 100) => {
      const tool = { name, title: T(titleKey), icon, order, button: true, visible: !gmOnly || game.user.isGM, onChange: () => fn() };
      if (Array.isArray(group.tools)) group.tools.push(tool);
      else group.tools[name] = tool;
    };
    add("tscSensorMap", "fa-solid fa-satellite", "SF2eTSC.ui.sensorMap", openSensorMap, false, 101);
    add("tscStationHud", "fa-solid fa-gamepad", "SF2eTSC.ui.stationHud", openStationHUD, false, 102);
    add("tscStart", "fa-solid fa-jet-fighter", "SF2eTSC.ui.startCombat", openStartWizard, true, 103);
    add("tscToolbox", "fa-solid fa-toolbox", "SF2eTSC.ui.toolbox", openToolbox, true, 104);
  });

  const contextOptions = (options) => {
    options.push(
      {
        name: T("SF2eTSC.ui.convertPlayerShip"),
        icon: '<i class="fa-solid fa-rocket"></i>',
        condition: (li) => {
          const a = actorOfEntry(li);
          return game.user.isGM && a?.type === "vehicle" && !isStarship(a);
        },
        callback: (li) => convertToStarship(actorOfEntry(li), "player")
      },
      {
        name: T("SF2eTSC.ui.convertNpcShip"),
        icon: '<i class="fa-solid fa-jet-fighter"></i>',
        condition: (li) => {
          const a = actorOfEntry(li);
          return game.user.isGM && a?.type === "npc" && !isStarship(a);
        },
        callback: (li) => convertToStarship(actorOfEntry(li), "npc")
      },
      {
        name: T("SF2eTSC.ui.revertStarship"),
        icon: '<i class="fa-solid fa-rotate-left"></i>',
        condition: (li) => {
          const a = actorOfEntry(li);
          return game.user.isGM && isStarship(a);
        },
        callback: (li) => revertStarship(actorOfEntry(li))
      }
    );
  };
  Hooks.on("getActorContextOptions", (app, options) => contextOptions(options));

  // header button on the system's own sheets for starship actors (opens the starship sheet)
  const openSheet = (actor) => (actor.type === "vehicle" ? openStarshipSheet(actor) : openNPCStarshipSheet(actor));
  const isOurSheet = (app) => !!app?.options?.classes?.includes("tsc-sheet");
  // the system's own (AppV1) sheets use the first hook, AppV2 sheets the second
  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    const actor = sheet.actor ?? sheet.document;
    if (!actor || !isStarship(actor) || isOurSheet(sheet)) return;
    buttons.unshift({
      label: T("SF2eTSC.ui.starshipSheet"),
      class: "tsc-open",
      icon: "fa-solid fa-rocket",
      onclick: () => openSheet(actor)
    });
  });
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const actor = app.document;
    if (app.document?.documentName !== "Actor" || !isStarship(actor) || isOurSheet(app)) return;
    controls.push({ icon: "fa-solid fa-rocket", label: "SF2eTSC.ui.starshipSheet", action: "tscOpen", onClick: () => openSheet(actor) });
  });
  Hooks.on("renderTokenHUD", (hud, html) => {
    const actor = hud.object?.actor;
    if (!actor || !isStarship(actor)) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".tsc-hud-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "control-icon tsc-hud-btn";
    btn.title = T("SF2eTSC.ui.sensorMap");
    btn.setAttribute("aria-label", T("SF2eTSC.ui.sensorMap"));
    btn.innerHTML = '<i class="fa-solid fa-satellite"></i>';
    btn.addEventListener("click", () => openSensorMap());
    (root.querySelector(".col.right") ?? root).appendChild(btn);
  });
}
function actorOfEntry(li) {
  const el = li instanceof HTMLElement ? li : li?.[0];
  const id = el?.dataset?.entryId ?? el?.dataset?.documentId ?? li?.data?.("documentId");
  return game.actors.get(id) ?? null;
}
