import { Content } from "../content/loader.mjs";
import { gradeAtLeast } from "../engine/advancement.mjs";
import { emitClientEvent, onClientEvent, registerHandler, request } from "../socket.mjs";
import { fromUuidSafe, T } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";
import { stageDroneBlock, stageDroneShieldProtocolBlock } from "./drone-block.mjs";
import { can } from "../crew/permissions.mjs";
import { findObject } from "../engine/sensor-ops.mjs";
import { publicLabel } from "../chat/attack-card/model.mjs";
import { ct } from "../content/content-i18n.mjs";

const WAIT_MS = 20000;
const waiting = new Map();

/** Reactions that matter while a Strike is resolving. Others stay available through the HUD. */
const STRIKE_REACTIONS = ["reposition-shield", "drone-block"];

export const Reactions = {
  /** Eligible reaction offers for a player ship that is being hit. */
  eligible(targetData, tsc, combat) {
    const offers = [];
    if (targetData.role !== "player") return offers;
    for (const st of targetData.stations) {
      if (!st.helmedBy || st.malfunctioning) continue;
      for (const a of Content.actions.values()) {
        if (a.cost !== "reaction" || !STRIKE_REACTIONS.includes(a.id)) continue;
        if (a.station !== st.type || !gradeAtLeast(st.grade, a.minGrade ?? "commercial")) continue;
        if (a.id === "reposition-shield" && targetData.sp.value <= 0) continue;
        const crew = fromUuidSync(st.helmedBy);
        const drones =
          a.id === "drone-block"
            ? (Array.isArray(targetData.drones) ? targetData.drones : []).filter(
                (d) => d?.tscVersion === 1 && d.stationId === st.id && d.deployed === true && Content.drones.some((t) => t.id === d.ref)
              )
            : [];
        if (a.id === "drone-block" && !drones.length) continue;
        offers.push({
          actionId: a.id,
          stationId: st.id,
          crewUuid: st.helmedBy,
          crewName: crew?.name ?? "?",
          ...(a.id === "drone-block" &&
          (targetData.upgrades ?? []).some((upgrade) => upgrade.ref === "drone-shield-protocol" && upgrade.stationId === st.id)
            ? { manualOnly: true }
            : {}),
          ...(drones.length ? { drones: drones.map((d) => ({ id: d.id, ref: d.ref })) } : {})
        });
      }
    }
    return offers;
  },

  /**
   * Ask crews whether to use a reaction. Resolves to a combined result { shieldAbsorb, bypassHull, resistance }.
   * Never blocks longer than WAIT_MS and never prompts when no reaction applies.
   */
  async ask(ctx, target, { amount, traits, crit, attackLabel }) {
    const result = {};
    if (ctx.options.skipReactions) return result;
    const offers = this.eligible(target.data, ctx.tsc, ctx.combat);
    if (!offers.length) return result;
    for (const offer of offers) {
      if (ctx.droneBlockOnly && offer.actionId !== "drone-block") continue;
      const crew = await fromUuidSafe(offer.crewUuid);
      const user =
        game.users.find((u) => u.active && !u.isGM && crew?.testUserPermission?.(u, "OWNER") && can(u, target.actor, "operateStation")) ??
        game.users.activeGM;
      if (!user) continue;
      const attacker = ctx.tsc ? findObject(ctx.tsc, ctx.shipUuid ?? ctx.ship?.uuid) : null;
      const attackerLabel = user.isGM
        ? ctx.ship.name
        : ((attacker ? publicLabel(attacker, target.uuid).label : null) ?? T("SF2eTSC.attackCard.unknownAttacker"));
      const use = await new Promise((resolve) => {
        const requestId = foundry.utils.randomID(10);
        const timer = setTimeout(() => {
          waiting.delete(requestId);
          resolve(null);
        }, WAIT_MS);
        waiting.set(requestId, {
          userId: user.id,
          drones: offer.drones?.map((d) => d.id),
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          }
        });
        emitClientEvent(
          "reactionPrompt",
          { requestId, shipUuid: target.uuid, shipName: target.actor.name, offer, amount, crit, attacker: attackerLabel },
          user.id
        );
      });
      if (!use) continue;
      try {
        if (!user.isGM && (!crew?.testUserPermission?.(user, "OWNER") || !can(user, target.actor, "operateStation")))
          throw new Error(T("SF2eTSC.errors.noPermission"));
        if (offer.actionId === "drone-block") {
          const level = crew?.system?.details?.level?.value ?? crew?.level;
          if (!Number.isInteger(level) || level < 1) throw new Error(T("SF2eTSC.droneBlock.invalid"));
          const previewResistance = Math.floor(level / 2);
          const drone = target.data.drones?.find((d) => d.id === use);
          const notes = [];
          if (drone?.ref === "scramble-drone" && drone.tscInterceptUsed === true) notes.push(T("SF2eTSC.droneBlock.interceptNote"));
          if (drone?.ref === "pyrotechnics-drone" && ((drone.mineStock?.length ?? 0) > 0 || (drone.mines?.length ?? 0) > 0))
            notes.push(T("SF2eTSC.droneBlock.mineNote"));
          const mode = await confirmDroneBlock({
            target: target.actor.name,
            attacker: attackerLabel,
            attack: attackLabel ?? T("SF2eTSC.attackCard.resultTitle"),
            amount,
            resistance: previewResistance,
            drone: ct(Content.drones.find((type) => type.id === drone?.ref)?.name ?? drone?.ref ?? ""),
            notes,
            manualOnly: offer.manualOnly
          });
          if (!mode) continue;
          const resistance = await (offer.manualOnly ? stageDroneShieldProtocolBlock : stageDroneBlock)({
            draft: ctx.draft,
            targetUuid: target.uuid,
            stationId: offer.stationId,
            crew,
            droneId: use,
            strikeId: ctx.strikeId,
            combat: ctx.combat,
            worldTime: game.time?.worldTime
          });
          result.resistance = Math.max(result.resistance ?? 0, resistance);
          if (mode === "manual")
            result.manualDamage = {
              amount,
              resistance,
              attack: attackLabel ?? "",
              target: target.actor.name,
              protocolManual: !!offer.manualOnly
            };
          continue;
        }
        const { executeAction } = await import("./action-engine.mjs");
        const r = await executeAction({
          userId: user.id,
          shipUuid: target.uuid,
          actionId: offer.actionId,
          crewUuid: offer.crewUuid,
          stationId: offer.stationId,
          draft: ctx.draft,
          options: { actions: 1, reaction: true, pendingStrike: { attackerUuid: ctx.shipUuid, amount, crit }, skipReactions: true }
        });
        Object.assign(result, r?.reactionResult ?? {});
      } catch (err) {
        log.warn("reaction failed", err);
        ui.notifications.warn(err.message);
      }
    }
    return result;
  }
};

export async function confirmDroneBlock({ target, attacker, attack, amount, resistance, drone, notes = [], manualOnly = false }) {
  const Dialog = foundry.applications.api.DialogV2;
  if (typeof Dialog?.prompt !== "function") {
    ui.notifications.warn(
      T(manualOnly ? "SF2eTSC.droneBlock.protocolManualFallback" : "SF2eTSC.droneBlock.manualFallback", { resistance, amount })
    );
    return "manual";
  }
  const details = {
    target: foundry.utils.escapeHTML(target),
    attacker: foundry.utils.escapeHTML(attacker),
    attack: foundry.utils.escapeHTML(attack),
    amount,
    resistance,
    drone: foundry.utils.escapeHTML(drone)
  };
  const confirmation = manualOnly ? T("SF2eTSC.droneBlock.protocolConfirm", details) : T("SF2eTSC.droneBlock.confirm", details);
  const mode = await Dialog.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.droneBlock.confirmTitle"), icon: "fa-solid fa-shield-halved" },
    content: `<p>${confirmation}</p>${notes.map((note) => `<p class="tsc-hint">${foundry.utils.escapeHTML(note)}</p>`).join("")}${
      manualOnly
        ? ""
        : `<label>${T("SF2eTSC.droneBlock.resolution")} <select name="resolution"><option value="automatic">${T("SF2eTSC.droneBlock.automatic")}</option><option value="manual">${T("SF2eTSC.droneBlock.manual")}</option></select></label>`
    }`,
    ok: {
      label: T(manualOnly ? "SF2eTSC.droneBlock.manual" : "SF2eTSC.reaction.useBtn"),
      callback: (_event, button) => (manualOnly ? "manual" : button.form.elements.resolution.value)
    },
    rejectClose: false
  });
  return mode === "automatic" || mode === "manual" ? mode : null;
}

/** Only the user the prompt was sent to (or a GM) may answer it. Exported for regression tests. */
export function resolveReactionResponse({ user, payload }) {
  const w = waiting.get(payload?.requestId);
  if (!w) return false;
  if (!user?.isGM && w.userId !== user?.id) throw new Error(T("SF2eTSC.errors.noPermission"));
  if (payload.use && w.drones && !w.drones.includes(payload.droneId)) throw new Error(T("SF2eTSC.droneBlock.invalid"));
  waiting.delete(payload.requestId);
  w.resolve(payload.use ? (w.drones ? payload.droneId : true) : null);
  return true;
}
/** Test hook. */
export function _registerWaiting(requestId, userId, resolve) {
  waiting.set(requestId, { userId, resolve });
}

/** Client side: show the prompt. GM client resolves waiting promises when the response request arrives. */
export function registerReactionHandlers() {
  registerHandler("reactionResponse", async (req) => resolveReactionResponse(req));
  onClientEvent("reactionPrompt", async (p) => {
    const name = T(`SF2eTSC.actions.${p.offer.actionId}`);
    const droneId = p.offer.drones?.length
      ? await foundry.applications.api.DialogV2.prompt({
          classes: ["sf2e-tsc"],
          window: { title: name },
          content: `<p>${T("SF2eTSC.droneBlock.choose")}</p><select name="droneId">${p.offer.drones.map((d) => `<option value="${foundry.utils.escapeHTML(d.id)}">${foundry.utils.escapeHTML(ct(Content.drones.find((type) => type.id === d.ref)?.name ?? d.ref))} (${foundry.utils.escapeHTML(d.id)})</option>`).join("")}</select>`,
          ok: { label: T("SF2eTSC.reaction.useBtn"), callback: (_e, b) => b.form.elements.droneId.value },
          rejectClose: false
        }).catch(() => null)
      : null;
    const use = p.offer.drones?.length
      ? !!droneId
      : await foundry.applications.api.DialogV2.confirm({
          classes: ["sf2e-tsc"],
          window: { title: T("SF2eTSC.reaction.title"), icon: "fa-solid fa-bolt" },
          content: `<p><strong>${foundry.utils.escapeHTML(p.shipName)}</strong>: ${T("SF2eTSC.reaction.body", { attacker: foundry.utils.escapeHTML(p.attacker), amount: p.amount })}</p><p>${T("SF2eTSC.reaction.use", { action: name, crew: foundry.utils.escapeHTML(p.offer.crewName) })}</p>`,
          yes: { label: T("SF2eTSC.reaction.useBtn"), icon: "fa-solid fa-check" },
          no: { label: T("SF2eTSC.reaction.declineBtn") },
          rejectClose: false
        }).catch(() => false);
    try {
      await request("reactionResponse", { requestId: p.requestId, use: !!use, ...(droneId ? { droneId } : {}) });
    } catch (err) {
      log.warn("reaction response failed", err);
    }
  });
}
