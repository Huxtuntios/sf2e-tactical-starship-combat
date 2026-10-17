import { Content } from "../content/loader.mjs";
import { gradeAtLeast } from "../engine/advancement.mjs";
import { emitClientEvent, onClientEvent, registerHandler, request } from "../socket.mjs";
import { fromUuidSafe, T } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";

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
        if (a.id === "drone-block" && (targetData.drones ?? []).length && !(targetData.drones ?? []).some((d) => d.deployed)) continue;
        const crew = fromUuidSync(st.helmedBy);
        offers.push({ actionId: a.id, stationId: st.id, crewUuid: st.helmedBy, crewName: crew?.name ?? "?" });
      }
    }
    return offers;
  },

  /**
   * Ask crews whether to use a reaction. Resolves to a combined result { shieldAbsorb, bypassHull, resistance }.
   * Never blocks longer than WAIT_MS and never prompts when no reaction applies.
   */
  async ask(ctx, target, { amount, traits, crit }) {
    const result = {};
    if (ctx.options.skipReactions) return result;
    const offers = this.eligible(target.data, ctx.tsc, ctx.combat);
    if (!offers.length) return result;
    for (const offer of offers) {
      const crew = await fromUuidSafe(offer.crewUuid);
      const user = game.users.find((u) => u.active && !u.isGM && crew?.testUserPermission?.(u, "OWNER")) ?? game.users.activeGM;
      if (!user) continue;
      const use = await new Promise((resolve) => {
        const requestId = foundry.utils.randomID(10);
        const timer = setTimeout(() => {
          waiting.delete(requestId);
          resolve(null);
        }, WAIT_MS);
        waiting.set(requestId, {
          userId: user.id,
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          }
        });
        emitClientEvent(
          "reactionPrompt",
          { requestId, shipUuid: target.uuid, shipName: target.actor.name, offer, amount, crit, attacker: ctx.ship.name },
          user.id
        );
      });
      if (!use) continue;
      try {
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
/** Only the user the prompt was sent to (or a GM) may answer it. Exported for regression tests. */
export function resolveReactionResponse({ user, payload }) {
  const w = waiting.get(payload?.requestId);
  if (!w) return false;
  if (!user?.isGM && w.userId !== user?.id) throw new Error(T("SF2eTSC.errors.noPermission"));
  waiting.delete(payload.requestId);
  w.resolve(payload.use ? true : null);
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
    const use = await foundry.applications.api.DialogV2.confirm({
      window: { title: T("SF2eTSC.reaction.title"), icon: "fa-solid fa-bolt" },
      content: `<p><strong>${foundry.utils.escapeHTML(p.shipName)}</strong>: ${T("SF2eTSC.reaction.body", { attacker: foundry.utils.escapeHTML(p.attacker), amount: p.amount })}</p><p>${T("SF2eTSC.reaction.use", { action: name, crew: foundry.utils.escapeHTML(p.offer.crewName) })}</p>`,
      yes: { label: T("SF2eTSC.reaction.useBtn"), icon: "fa-solid fa-check" },
      no: { label: T("SF2eTSC.reaction.declineBtn") },
      rejectClose: false
    }).catch(() => false);
    try {
      await request("reactionResponse", { requestId: p.requestId, use: !!use });
    } catch (err) {
      log.warn("reaction response failed", err);
    }
  });
}
