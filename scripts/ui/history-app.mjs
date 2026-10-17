import { MODULE_ID } from "../constants.mjs";
import { request } from "../socket.mjs";
import { ct } from "../content/content-i18n.mjs";
import { TscApp, tpl } from "./base-app.mjs";
import { historyEntries, historySummary } from "../history/history.mjs";
import { T } from "../utils/foundry.mjs";
import { notifyError } from "../utils/logging.mjs";
import { readStarship } from "../starship/starship-state.mjs";

export class HistoryApplication extends TscApp {
  static DEFAULT_OPTIONS = {
    classes: ["sf2e-tsc", "tsc-history"],
    position: { width: 720, height: 560 },
    actions: {
      undo: async function (event, target) {
        if (
          !(await foundry.applications.api.DialogV2.confirm({
            window: { title: T("SF2eTSC.qol.undo") },
            content: `<p>${T("SF2eTSC.qol.undoHint")}</p>`
          }))
        )
          return;
        try {
          await request("undoHistory", { messageId: target.dataset.id });
          this.render();
        } catch (err) {
          notifyError("SF2eTSC.errors.generic", { message: err.message });
        }
      },
      historyLink: async function (event, target) {
        if (!game.user.isGM) return;
        const actor = await fromUuid(target.dataset.uuid);
        if (!actor) return;
        const { StarshipSheet, NPCStarshipSheet } = await import("./starship-sheet.mjs");
        const Sheet = readStarship(actor).role === "player" ? StarshipSheet : NPCStarshipSheet;
        const app = new Sheet({ document: actor });
        // Suppress tab restoration only for this explicit journal destination.
        if (target.dataset.station || target.dataset.effect) {
          app._qolRestored = true;
          app.tab = target.dataset.station ? "stations" : "overview";
        }
        await app.render(true);
        const id = target.dataset.station || target.dataset.effect;
        const attr = target.dataset.station ? "data-station-link" : "data-effect-link";
        const row = id ? app.element?.querySelector(`[${attr}="${CSS.escape(id)}"]`) : null;
        if (row) {
          row.scrollIntoView({ block: "center" });
          row.classList.add("tsc-journal-focus");
        } else if (id) ui.notifications.info(T("SF2eTSC.qol.entryGone"));
      }
    }
  };
  static PARTS = { body: { template: tpl("history"), scrollable: [""] } };
  channels = ["actor", "combat", "history"];
  shipUuid = null;
  get title() {
    return T("SF2eTSC.qol.history");
  }
  async _prepareContext() {
    return {
      entries: historyEntries(this.shipUuid).map((m) => {
        const r = m.flags[MODULE_ID].history;
        const effects = [...r.after.effects, ...r.before.effects.filter((e) => !r.after.effects.some((b) => b.id === e.id))].filter(
          (e) => !r.before.effects.some((b) => JSON.stringify(b) === JSON.stringify(e)) || !r.after.effects.some((b) => b.id === e.id)
        );
        const stations = r.after.stations.filter((s) => !r.before.stations.some((b) => JSON.stringify(b) === JSON.stringify(s)));
        return {
          id: m.id,
          ...r,
          summary: historySummary(r.before, r.after),
          fieldsText: r.fields.join(", "),
          effects: effects.map((e) => ({ ...e, label: ct(e.label) })),
          stations,
          canUndo: r.undoable && !r.undone,
          time: new Date(r.at).toLocaleString()
        };
      })
    };
  }
}
export function openHistory(shipUuid = null) {
  if (!game.user.isGM) return;
  const app = new HistoryApplication();
  app.shipUuid = shipUuid;
  return app.render(true);
}
