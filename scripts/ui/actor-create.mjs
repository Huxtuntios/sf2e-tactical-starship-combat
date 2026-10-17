import { MODULE_ID } from "../constants.mjs";
import { Content } from "../content/loader.mjs";
import { buildPlayerShipData, buildShipActorData, buildHazardActorData } from "../content/ship-docs.mjs";
import { T } from "../utils/foundry.mjs";
import { log, notifyError } from "../utils/logging.mjs";
import { openBuilder } from "./launchers.mjs";
import { docI18nOptions } from "../content/importer.mjs";
import { ct } from "../content/content-i18n.mjs";

/**
 * Starship creation: an Actor Directory button (and the context menu / launchers) open the module's own dialog.
 * sf2e has no starship actor type, so the module creates the closest system type (vehicle / npc / hazard) and marks it:
 *   player starship → vehicle  ·  NPC starship → npc  ·  starship hazard → hazard
 */
export const CREATE_KINDS = { "tsc-player": "vehicle", "tsc-npc": "npc", "tsc-hazard": "hazard" };

/** Pure: creation data (without name) for a kind. Used by the creation dialog. */
export function creationData(kind, { name, level = 1, frame = null } = {}) {
  if (kind === "tsc-player") {
    if (!frame) throw new Error(game.i18n.localize("SF2eTSC.errors.noFrames"));
    return buildPlayerShipData({ name, frame, level: Math.max(1, Math.min(20, level)), i18n: docI18nOptions() });
  }
  if (kind === "tsc-npc") {
    return buildShipActorData(
      {
        id: `custom-${foundry.utils.randomID(8)}`,
        name,
        level,
        size: "medium",
        traits: ["tech"],
        hp: 20 + level * 15,
        sp: Math.max(0, level * 5),
        ac: 15 + level,
        fort: 7 + level,
        ref: 7 + level,
        will: 7 + level,
        perception: 7 + level,
        speed: 4,
        sensorRange: 4,
        stations: [
          { type: "pilot", actions: [] },
          { type: "gunnery", actions: [] },
          { type: "scanners", actions: [] }
        ],
        strikes: [],
        actions: [],
        skills: {}
      },
      { i18n: docI18nOptions() }
    );
  }
  if (kind === "tsc-hazard") {
    return buildHazardActorData(
      {
        id: `custom-${foundry.utils.randomID(8)}`,
        name,
        level,
        isComplex: false,
        complexity: "simple",
        traits: [],
        description: "",
        disable: "",
        hp: null,
        ac: null,
        fort: 0,
        ref: 0,
        will: 0,
        stealthDC: 15 + level,
        actions: [],
        strikes: []
      },
      { i18n: docI18nOptions() }
    );
  }
  return null;
}

export function registerActorCreation() {
  // 1) turn the plain system actor into a starship before it is written (only for creations made by this module)
  Hooks.on("preCreateActor", (doc, data, options, userId) => {
    if (userId !== game.user.id) return;
    const kind = options?.[MODULE_ID]?.createKind ?? null;
    if (!kind || doc.flags?.[MODULE_ID]?.starship || doc.flags?.[MODULE_ID]?.starshipHazard) return;
    try {
      const frame = Content.frames.get("explorer") ?? [...Content.frames.values()][0];
      const d = creationData(kind, { name: doc.name, level: doc.system?.details?.level?.value ?? 1, frame });
      if (!d) return;
      delete d.name;
      delete d.type;
      if (d.prototypeToken) d.prototypeToken.name = doc.name;
      doc.updateSource(d);
    } catch (err) {
      log.error("starship creation failed", err);
    }
  });
  // 2) Actor Directory header button
  Hooks.on("renderActorDirectory", (app, html) => {
    if (!game.user.isGM && !game.user.can?.("ACTOR_CREATE")) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".tsc-create-starship")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tsc-create-starship";
    btn.innerHTML = `<i class="fa-solid fa-rocket"></i> ${T("SF2eTSC.create.button")}`;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      createStarshipDialog();
    });
    const host =
      root.querySelector(".header-actions, .directory-header .action-buttons, header .action-buttons") ??
      root.querySelector("header") ??
      root;
    host.append(btn);
  });
}

/** Module dialog: name, kind and level → creates and opens the starship / hazard. */
export async function createStarshipDialog() {
  const kinds = Object.keys(CREATE_KINDS)
    .map((k) => `<option value="${k}">${T(`SF2eTSC.create.${k}`)}</option>`)
    .join("");
  const frames = [...Content.frames.values()]
    .map((f) => `<option value="${f.id}">${foundry.utils.escapeHTML(ct(f.name))}</option>`)
    .join("");
  const FDE = foundry.applications.ux.FormDataExtended;
  const r = await foundry.applications.api.DialogV2.wait({
    window: { title: T("SF2eTSC.create.title"), icon: "fa-solid fa-rocket" },
    content: `<div class="form-group"><label>${T("SF2eTSC.ui.name")}</label><input type="text" name="name" autofocus></div>
      <div class="form-group"><label>${T("SF2eTSC.ui.type")}</label><select name="kind">${kinds}</select></div>
      <div class="form-group"><label>${T("SF2eTSC.ui.level")}</label><input type="number" name="level" value="1" min="-1" max="25"></div>
      <div class="form-group"><label>${T("SF2eTSC.ui.frame")}</label><select name="frame">${frames}</select></div>
      <p class="hint">${T("SF2eTSC.create.hint")}</p>`,
    buttons: [
      {
        action: "create",
        label: T("SF2eTSC.create.create"),
        icon: "fa-solid fa-check",
        default: true,
        callback: (ev, b) => new FDE(b.form).object
      },
      { action: "builder", label: T("SF2eTSC.ui.starshipBuilder"), icon: "fa-solid fa-screwdriver-wrench", callback: () => "builder" }
    ],
    rejectClose: false
  }).catch(() => null);
  if (!r) return null;
  if (r === "builder") return openBuilder();
  try {
    const name = String(r.name ?? "").trim() || T(`SF2eTSC.create.${r.kind}`);
    const data = creationData(r.kind, { name, level: Number(r.level) || 1, frame: Content.frames.get(r.frame) });
    const actor = await Actor.create(data, { [MODULE_ID]: { createKind: r.kind } });
    actor?.sheet?.render(true);
    return actor;
  } catch (err) {
    notifyError("SF2eTSC.errors.generic", { message: err.message });
    return null;
  }
}
