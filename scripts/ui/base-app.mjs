import { restoreUiState, saveUiState, wireClientUi } from "./client-ui.mjs";
import { MODULE_ID } from "../constants.mjs";
import { wireInlineClicks } from "./inline-clicks.mjs";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Live applications that want to be refreshed from Hooks/document updates (no polling anywhere). */
const live = new Set();
/** app -> { timer, parts: Set<string> | null }  (null = full render) */
const pending = new Map();

/**
 * Merge a pending part request with a new one. `null` means "render everything" and wins;
 * an empty array means "nothing to re-render" for that channel.
 * @returns {Set<string>|null}
 */
export function mergeParts(prev, want) {
  if (prev === null || want === null || want === undefined) return null;
  const out = new Set(prev ?? []);
  for (const p of want) out.add(p);
  return out;
}

/** Registers a window for targeted refreshes and cleans up on close (no leaked listeners/timers). */
export const LiveMixin = (Base) =>
  class Live extends Base {
    /** Which refresh channels this window listens to: "combat" | "actor" | "targeting" | "settings" | "crew" */
    channels = ["combat", "actor"];
    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      live.add(this);
      restoreUiState(this);
      if (this._qolPosition) this.setPosition?.(this._qolPosition);
    }
    _onRender(context, options) {
      super._onRender?.(context, options);
      wireClientUi(this);
    }
    _onClose(options) {
      saveUiState(this);
      live.delete(this);
      clearTimeout(pending.get(this)?.timer);
      pending.delete(this);
      super._onClose?.(options);
      this._cleanup?.();
    }
    /** Override to decide whether a given document change matters for this window. */
    wants(channel, doc) {
      return this.channels.includes(channel);
    }
    /** override to re-render only some parts for a channel (array of part ids; null = full render). */
    partsFor(channel, doc) {
      return null;
    }
  };

export class TscApp extends LiveMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = { classes: ["sf2e-tsc"], window: { resizable: true } };
  _onRender(context, options) {
    super._onRender?.(context, options);
    wireInlineClicks(this.element);
  }
}

/** a select / text input inside the window has focus -> postpone the refresh until it is left (max 30 s). */
export function isEditingElement(root, active) {
  if (!root || !active || !root.contains?.(active)) return false;
  const tag = String(active.tagName ?? "").toUpperCase();
  return (
    tag === "SELECT" ||
    tag === "TEXTAREA" ||
    (tag === "INPUT" && !["checkbox", "radio", "button", "submit"].includes(String(active.type ?? "").toLowerCase()))
  );
}
const isEditing = (app) => isEditingElement(app.element, globalThis.document?.activeElement);

/** Debounced, targeted re-render of open windows; requests within 60 ms are merged into one (partial) render. */
export function refreshApps(channel, doc = null) {
  for (const app of live) {
    if (!app.rendered || !app.wants(channel, doc)) continue;
    const want = app.partsFor?.(channel, doc) ?? null;
    const prev = pending.get(app);
    if (!prev && Array.isArray(want) && !want.length) continue;
    const parts = prev ? mergeParts(prev.parts, want) : want ? new Set(want) : null;
    clearTimeout(prev?.timer);
    const fire = (tries = 0) => {
      if (!app.rendered) {
        pending.delete(app);
        return;
      }
      if (isEditing(app) && tries < 120) {
        pending.set(app, { timer: setTimeout(() => fire(tries + 1), 250), parts });
        return;
      }
      pending.delete(app);
      if (parts && !parts.size) return;
      app.render(parts ? { parts: [...parts] } : undefined);
    };
    const timer = setTimeout(() => fire(0), 60);
    pending.set(app, { timer, parts });
  }
}
export function openApps(cls) {
  return [...live].filter((a) => a instanceof cls);
}
export const tpl = (name) => `modules/${MODULE_ID}/templates/${name}.hbs`;
