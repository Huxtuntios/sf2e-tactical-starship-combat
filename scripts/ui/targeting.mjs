import { evaluateTarget, targetingState } from "../engine/target-rules.mjs";
import { MODULE_ID } from "../constants.mjs";
import { activeStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { privateContacts } from "../sensor/private-contacts.mjs";
import { refreshApps } from "./base-app.mjs";
import { moduleSetting, fromUuidSync_ } from "../utils/foundry.mjs";

/** Warn mode (default): range / detection problems are shown on the target, never block the pick. */
const softRules = () => {
  try {
    return moduleSetting("ruleEnforcement") !== "strict";
  } catch {
    return false;
  }
};

const mapOnlyTargets = new Set();
const registeredHooks = new WeakSet();
const registeredKeybindings = new WeakSet();
const unique = (values) => [...new Set(values.filter((value) => typeof value === "string" && value))];
const findTargetObject = (tsc, key) => tsc?.objects.find((o) => o.key === key || o.actorUuid === key) ?? null;
const warn = (key) => ui.notifications.warn(game.i18n.localize(`SF2eTSC.targeting.reason.${key}`));

export function preserveHoveredObject(element, previous) {
  const hovered = element.querySelector(".tsc-obj:hover")?.dataset.objectKey;
  if (hovered) return hovered;
  if (!previous) return null;
  return [...element.querySelectorAll("[data-object-key]")].some((node) => node.dataset.objectKey === previous) ? previous : null;
}

function nativeTargetUUIDs(user = game.user) {
  const out = [];
  for (const token of user?.targets ?? []) {
    const actor = token?.actor ?? fromUuidSync_(token?.document?.actorUuid);
    if (!actor || actor.documentName !== "Actor") continue;
    if (actor.id && game.actors && !game.actors.has(actor.id)) continue;
    out.push(actor.uuid);
  }
  return unique(out);
}

function tokensForObject(obj) {
  const key = obj?.actorUuid ?? obj?.key;
  return (canvas.tokens?.placeables ?? []).filter(
    (token) => (token?.actor?.uuid ?? token?.document?.actorUuid) === key || token?.document?.uuid === obj?.key
  );
}

function releaseNativeTargets() {
  for (const token of [...(game.user?.targets ?? [])]) token.setTarget?.(false, { releaseOthers: false });
}

function sessionTsc(session) {
  const combat = activeStarshipCombat();
  if (!combat) return null;
  const tsc = getTsc(combat);
  if (!session.gm) return tsc;
  try {
    return targetingState(tsc, session.shipUuid, privateContacts(combat.id));
  } catch {
    return tsc;
  }
}

function validateNativeToken(token) {
  const session = Targeting.current;
  if (!session) return true;
  if (!session.gm && token?.visible === false) {
    warn("hidden");
    return false;
  }
  const tsc = sessionTsc(session);
  if (!tsc) return true;
  const key = token?.actor?.uuid ?? token?.document?.actorUuid ?? token?.document?.uuid;
  const obj = findTargetObject(tsc, key);
  if (!obj) {
    warn("notPlaced");
    return false;
  }
  const classification = Targeting.classify(tsc, obj);
  if (!classification?.available) {
    warn(classification?.reason ?? "notPlaced");
    return false;
  }
  return true;
}

function preTargetState(combat, privateObjects) {
  const tsc = getTsc(combat);
  const privateKeys = new Set(privateObjects.map((object) => object.key));
  return {
    ...tsc,
    objects: [...tsc.objects.filter((object) => !privateKeys.has(object.key)), ...privateObjects]
  };
}

function targetHoveredSensorMap(context) {
  const session = Targeting.current;
  const key = Targeting.hoverKey;
  if (!key) return false;
  const combat = activeStarshipCombat();
  if (!combat) return false;
  if (!session) {
    Targeting.pick(key, preTargetState(combat, privateContacts(combat.id)), { additive: !!context.isShift });
    return true;
  }
  const tsc = targetingState(getTsc(combat), session.shipUuid, privateContacts(combat.id));
  Targeting.pick(key, tsc, { additive: !!context.isShift });
  return true;
}

export function pickSensorMapObject(key, { additive = false, privateObjects = [] } = {}) {
  const session = Targeting.current;
  const combat = activeStarshipCombat();
  if (session) return Targeting.pick(key, targetingState(getTsc(combat), session.shipUuid, privateObjects), { additive });
  return Targeting.pick(key, preTargetState(combat, privateObjects), { additive });
}

export function registerNativeTargeting() {
  if (!globalThis.Hooks) return;
  if (!registeredHooks.has(globalThis.Hooks)) {
    registeredHooks.add(globalThis.Hooks);
    Hooks.on("targetToken", (user, token, targeted) => {
      if (user !== game.user) return;
      if (targeted && !validateNativeToken(token)) {
        token.setTarget?.(false, { releaseOthers: false });
        refreshApps("targeting");
        return;
      }
      refreshApps("targeting");
    });
  }
  const keybindings = game.keybindings;
  if (!keybindings || keybindings.bindings || registeredKeybindings.has(keybindings)) return;
  registeredKeybindings.add(keybindings);
  keybindings.register(MODULE_ID, "targetSensorMap", {
    name: "SF2eTSC.keybindings.targetSensorMap",
    hint: "SF2eTSC.keybindings.targetSensorMapHint",
    editable: [{ key: "KeyT" }],
    reservedModifiers: ["Shift"],
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
    onDown: targetHoveredSensorMap
  });
}

/** Thin adapter over Foundry's ephemeral Token target set; only tokenless map contacts need a temporary key set. */
export const Targeting = {
  current: null,
  hoverKey: null,
  begin(session) {
    this.current = { ...session };
    if (!this.current.onExecute && this.current.onPick) {
      const onPick = this.current.onPick;
      this.current.legacyPick = onPick;
      this.current.onExecute = async (keys) => {
        if (keys.length !== 1) {
          ui.notifications.warn(game.i18n.localize("SF2eTSC.errors.badTarget"));
          return false;
        }
        return onPick(keys[0]);
      };
    }
    refreshApps("targeting");
  },
  end() {
    this.current = null;
    this.hoverKey = null;
    mapOnlyTargets.clear();
    refreshApps("targeting");
  },
  targetUUIDs() {
    return unique([...nativeTargetUUIDs(), ...mapOnlyTargets]);
  },
  async execute() {
    const session = this.current;
    if (!session?.onExecute) return false;
    const keys = this.targetUUIDs();
    if (!keys.length) {
      ui.notifications.warn(game.i18n.localize("SF2eTSC.errors.needTarget"));
      return false;
    }
    const result = await session.onExecute(keys);
    if (result !== false && this.current === session) this.end();
    return result;
  },
  pick(key, tsc = null, { additive = false } = {}) {
    const session = this.current;
    const obj = tsc ? findTargetObject(tsc, key) : null;
    if (tsc && !obj) {
      warn("notPlaced");
      return false;
    }
    const tokens = obj ? tokensForObject(obj) : [];
    let selected = false;
    if (tokens.length) {
      const targeted = tokens.filter((token) => game.user.targets.has(token));
      if (targeted.length) {
        for (const token of targeted) token.setTarget(false, { releaseOthers: false });
      } else {
        const classification = tsc && session && !session.gm ? this.classify(tsc, obj) : null;
        if (classification && !classification.available) {
          warn(classification.reason);
          return false;
        }
        const token = tokens.find((candidate) => candidate.visible !== false);
        if (!token) {
          warn("hidden");
          return false;
        }
        token.setTarget(true, { releaseOthers: !additive });
        if (!additive) mapOnlyTargets.clear();
        selected = true;
      }
    } else {
      const classification = tsc && session && !session.gm ? this.classify(tsc, obj) : null;
      if (classification && !classification.available) {
        warn(classification.reason);
        return false;
      }
      if (mapOnlyTargets.has(key)) mapOnlyTargets.delete(key);
      else {
        if (!additive) {
          mapOnlyTargets.clear();
          releaseNativeTargets();
        }
        mapOnlyTargets.add(key);
        selected = true;
      }
    }
    refreshApps("targeting");
    if (session?.legacyPick && !additive && selected) {
      const onPick = session.legacyPick;
      this.end();
      onPick(key);
    }
    return true;
  },
  /** Classification of a candidate object relative to the active session (same rules as the GM validation). */
  classify(tsc, obj) {
    const session = this.current;
    if (!session) return null;
    const ev = evaluateTarget({
      tsc,
      shipKey: session.shipUuid,
      obj: findTargetObject(tsc, obj.key) ?? obj,
      range: session.range ?? 99,
      rangeIncrement: session.rangeIncrement ?? null,
      allowSelf: !!session.allowSelf,
      enforceDetection: session.enforceDetection !== false,
      override: !!session.gm,
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
      range: session.range,
      level: ev.level,
      available: ev.available,
      reason: why,
      warning: ev.warning ?? null
    };
  }
};
