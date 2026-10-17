import { restoreUiState } from "./client-ui.mjs";
import { editEffect } from "./effect-editor.mjs";
import { openHistory } from "./history-app.mjs";
import { request } from "../socket.mjs";
/**
 * Starship sheet (player starships) and the NPC variant.
 * split into sheet/sheet-model.mjs (pure), sheet-rows.mjs, sheet-context.mjs, sheet-listeners.mjs and
 * sheet-actions.mjs. The sheet renders in three parts (header | tabs | body) and refreshes only what changed.
 */
import { wireSheetTheme } from "./sheet/sheet-theme.mjs";
import { tpl, LiveMixin } from "./base-app.mjs";
import { readStarship } from "../starship/starship-state.mjs";
import { notifyError } from "../utils/logging.mjs";
import { wirePackDrop } from "../starship/pack-drop.mjs";
import { npcInlineAction } from "../actions/npc-inline.mjs";
import { TABS, NPC_TABS, sheetPartsFor } from "./sheet/sheet-model.mjs";
import { buildSheetContext } from "./sheet/sheet-context.mjs";
import { wireSheetInputs } from "./sheet/sheet-listeners.mjs";
import * as A from "./sheet/sheet-actions.mjs";
import { openStationHUD, openCrewManager } from "./launchers.mjs";
import { wireCrewSelects } from "../crew/crew-view.mjs";
import { wireInlineClicks } from "./inline-clicks.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const guard = (fn) =>
  async function (...a) {
    try {
      return await fn.apply(this, a);
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  };
const sheetParts = (prefix) => ({
  header: { template: tpl(`${prefix}-header`) },
  tabs: { template: tpl("starship-sheet-tabs") },
  body: { template: tpl(prefix), scrollable: [""] }
});

/** Starship sheet (player starships). The NPC variant below reuses everything with a GM-oriented layout. */
export class StarshipSheet extends LiveMixin(HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2)) {
  static DEFAULT_OPTIONS = {
    classes: ["sf2e-tsc", "tsc-sheet"],
    position: { width: 780, height: 640 },
    window: { resizable: true, icon: "fa-solid fa-rocket" },
    form: { handler: async () => {}, submitOnChange: false, closeOnSubmit: false },
    actions: {
      tscTab: A.switchTab,
      editImage: guard(A.editImage),
      addListItem: guard(A.addListItem),
      removeListItem: guard(A.removeListItem),
      editJson: guard(A.editJson),
      claim: guard(A.claim),
      forceClaim: guard(A.forceClaim),
      unhelm: guard(A.unhelm),
      setRole: guard(A.setRole),
      ready: guard(A.ready),
      remove: guard(A.removeCrew),
      openStationHud: () => openStationHUD(),
      openCrewManager: () => openCrewManager(),
      toggleMalf: guard(A.toggleMalf),
      addStation: guard(A.addStation),
      removeStation: guard(A.removeStation),
      addWeapon: guard(A.addWeapon),
      removeWeapon: guard(A.removeWeapon),
      openUpgrade: guard(A.openUpgrade),
      addStationUpgrade: guard(A.addStationUpgrade),
      removeStationUpgrade: guard(A.removeStationUpgrade),
      toggleUpgradeOverride: guard(A.toggleUpgradeOverride),
      assignUpgrade: guard(A.assignUpgrade),
      openMap: A.openMap,
      gmDamage: guard(A.gmDamage),
      gmRepair: guard(A.gmRepair),
      hullCheck: guard(A.hullCheck),
      applyFrame: guard(A.applyFrame),
      exportJson: A.exportJson,
      importJson: guard(A.importJson),
      runAction: guard(A.runShipAction),
      removeEffect: guard(A.removeEffect),
      openHolodock: A.holodock,
      openHistory: function () {
        openHistory(this.document.uuid);
      },
      editEffectTiming: guard(function (e, t) {
        return editEffect(this.document, t.dataset.id);
      }),
      completeEffect: guard(function (e, t) {
        return request("effectTiming", { shipUuid: this.document.uuid, effectId: t.dataset.id, op: "complete" });
      }),
      sustainEffect: guard(function (e, t) {
        return request("effectTiming", { shipUuid: this.document.uuid, effectId: t.dataset.id, op: "sustain" });
      }),
      saveNotes: guard(A.saveNotes),
      manualResolve: guard(A.manualResolve),
      rollShipCheck: guard(A.rollCheck),
      pilotingSave: guard(A.pilotingSave),
      sheetAttack: guard(A.sheetAttack),
      sheetDamage: guard(A.sheetDamage),
      updateFromContent: guard(A.updateFromContent)
    }
  };
  static PARTS = sheetParts("starship-sheet");
  tab = "overview";
  channels = ["combat", "targeting", "crew", "sheetTheme"];
  /** "crew" refreshes: a crew member's portrait/name/token art changed or the actor was deleted. */
  wants(channel, doc) {
    if (!this.channels.includes(channel)) return false;
    if (channel !== "crew" || !doc) return true;
    return readStarship(this.document).crew.some((c) => c.actorUuid === doc.uuid);
  }
  /** partial refresh (null = all parts). */
  partsFor(channel) {
    return channel === "sheetTheme" ? ["header"] : sheetPartsFor(channel);
  }
  get isNpc() {
    return false;
  }
  get tabs() {
    return TABS;
  }
  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    restoreUiState(this);
    return buildSheetContext(this);
  }
  inline(name, own, st) {
    return npcInlineAction(name, own, st);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    wireSheetTheme(this);
    wirePackDrop(this);
    wireSheetInputs(this);
    wireCrewSelects(this.element, () => this.render());
    wireInlineClicks(this.element);
  }
}

/** GM-facing NPC starship sheet: stats, stations, actions, strikes, abilities. */
export class NPCStarshipSheet extends StarshipSheet {
  static DEFAULT_OPTIONS = { classes: ["sf2e-tsc", "tsc-sheet", "tsc-npc"], position: { width: 700, height: 620 } };
  get isNpc() {
    return true;
  }
  get tabs() {
    return NPC_TABS;
  }
  tab = "overview";
}
