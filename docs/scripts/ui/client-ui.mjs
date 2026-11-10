/** Client-only presentation. Writes are serialized to avoid losing another window's saved preferences. */
import { MODULE_ID } from "../constants.mjs";
let pendingSave = Promise.resolve();
export const uiStateKey = (app) => `${app.constructor.name}:${app.document?.uuid ?? "window"}`;
export function restoreUiState(app) {
  if (app._qolRestored) return;
  app._qolRestored = true;
  const state = game.settings.get(MODULE_ID, "uiState")?.[uiStateKey(app)];
  if (!state) return;
  if (state.tab && app.tabs?.some?.((t) => (typeof t === "string" ? t : t.id) === state.tab)) app.tab = state.tab;
  app._qolPosition = state.position;
}
export function saveUiState(app) {
  const key = uiStateKey(app),
    p = app.position ?? {};
  const value = {
    tab: app.tab,
    position: {
      width: Math.max(320, Math.min(3000, Number(p.width) || 780)),
      height: Math.max(240, Math.min(2400, Number(p.height) || 640))
    }
  };
  pendingSave = pendingSave
    .catch(() => {})
    .then(async () => {
      const state = { ...(game.settings.get(MODULE_ID, "uiState") ?? {}), [key]: value };
      const entries = Object.entries(state).slice(-100);
      await game.settings.set(MODULE_ID, "uiState", Object.fromEntries(entries));
    })
    .catch((err) => console.warn("TSC: client preferences were not saved", err));
  return pendingSave;
}
export function filterRows(rows, query = "", filter = "all") {
  const q = query.trim().toLocaleLowerCase();
  for (const row of rows) {
    const text =
      `${row.textContent ?? ""} ${[...(row.querySelectorAll?.("input,select") ?? [])].map((el) => el.value).join(" ")}`.toLocaleLowerCase();
    const matches = filter === "all" || (filter === "undo" && row.dataset.filterUndo === "true");
    row.hidden = !text.includes(q) || !matches;
  }
}
export function wireClientUi(app) {
  const root = app.element;
  if (!root?.querySelectorAll) return;
  if (!root.querySelector(".tsc-history-list")) return;
  const rows = root.querySelectorAll("[data-qol-row]");
  app._qolQueries ??= {};
  const query = app._qolQueries[app.tab ?? "window"] ?? { text: "", filter: "all" };
  const apply = () => filterRows(rows, query.text, query.filter);
  const search = root.querySelector("[data-qol-search]"),
    filter = root.querySelector("[data-qol-filter]");
  if (search) {
    search.disabled = false;
    search.value = query.text;
    search.oninput = () => {
      query.text = search.value;
      app._qolQueries[app.tab ?? "window"] = query;
      apply();
    };
  }
  if (filter) {
    filter.disabled = false;
    filter.hidden = !root.querySelector(".tsc-history-list");
    if (filter.hidden) query.filter = "all";
    filter.value = query.filter;
    filter.onchange = () => {
      query.filter = filter.value;
      app._qolQueries[app.tab ?? "window"] = query;
      apply();
    };
  }
  apply();
}
