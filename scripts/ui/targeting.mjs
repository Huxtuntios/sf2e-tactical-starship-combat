import { findObject } from "../engine/sensor-ops.mjs";
import { evaluateTarget } from "../engine/target-rules.mjs";
import { refreshApps } from "./base-app.mjs";
import { moduleSetting } from "../utils/foundry.mjs";

/** Warn mode (default): range / detection problems are shown on the target, never block the pick. */
const softRules = () => {
  try {
    return moduleSetting("ruleEnforcement") !== "strict";
  } catch {
    return false;
  }
};

/** Shared targeting session between the Station HUD and the Sensor Map. */
export const Targeting = {
  current: null,
  begin(session) {
    this.current = session;
    refreshApps("targeting");
  },
  end() {
    this.current = null;
    refreshApps("targeting");
  },
  pick(key, tsc = null) {
    const s = this.current;
    if (!s) return;
    // unavailable targets can't be picked (the GM re-validates anyway); GM sessions may pick anything
    if (tsc && !s.gm) {
      const o = findObject(tsc, key);
      const c = o ? this.classify(tsc, o) : null;
      if (!c?.available) {
        ui.notifications.warn(game.i18n.localize(`SF2eTSC.targeting.reason.${c?.reason ?? "notPlaced"}`));
        return;
      }
    }
    const cb = s.onPick;
    this.current = null;
    refreshApps("targeting");
    cb?.(key);
  },
  /** Classification of a candidate object relative to the active session (same rules as the GM validation). */
  classify(tsc, obj) {
    const s = this.current;
    if (!s) return null;
    const ev = evaluateTarget({
      tsc,
      shipKey: s.shipUuid,
      obj: findObject(tsc, obj.key) ?? obj,
      range: s.range ?? 99,
      rangeIncrement: s.rangeIncrement ?? null,
      allowSelf: !!s.allowSelf,
      enforceDetection: s.enforceDetection !== false,
      override: !!s.gm,
      soft: softRules()
    });
    const why = ev.warning ?? ev.reason;
    const status =
      ev.available && !ev.warning
        ? ev.distance === 0
          ? "same-zone"
          : "valid"
        : ({ undetected: "undetected", hidden: "hidden", outOfRange: "out-of-range", tooFar: "out-of-range" }[why] ?? "invalid");
    return {
      status,
      distance: ev.distance ?? 0,
      range: s.range,
      level: ev.level,
      available: ev.available,
      reason: why,
      warning: ev.warning ?? null
    };
  }
};
