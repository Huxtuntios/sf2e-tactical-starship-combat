/** Starship sheet: row builders (actions, strikes, NPC actions; upgrades: sheet-upgrades.mjs). */
import { MODULE_ID } from "../../constants.mjs";
import { Content } from "../../content/loader.mjs";
import { readStarship } from "../../starship/starship-state.mjs";
import { previewAction, COST_ICON } from "../action-runner.mjs";
import { actionLabel } from "../../actions/action-engine.mjs";
import { T } from "../../utils/foundry.mjs";
import { checkLinksHTML } from "../../content/inline-checks.mjs";
import { ct, ctPlain } from "../../content/content-i18n.mjs";
import { strikeLine } from "../../utils/labels.mjs";
import { collectNpcActions, normalizeNpcStrike } from "../../actions/npc-rows.mjs";
import { escHTML, npcIssueText } from "./sheet-model.mjs";

/** One NPC action button row (the action is already validated / bound). */
export function npcRow(a, st, actor, msgs = []) {
  const p = previewAction(a, { ship: actor, crew: null, station: st });
  if (a.passive)
    return {
      id: a.id,
      name: actionLabel(a),
      icon: "∞",
      enabled: false,
      reasons: T("SF2eTSC.ui.passive"),
      text: ctPlain(a.text),
      html: checkLinksHTML(ct(a.text)),
      inline: true
    };
  const isStrike = a.builtin === "npc-strike";
  const name = isStrike && a.boundStrike ? `${actionLabel(a)}: ${ct(a.boundStrike)}` : actionLabel(a);
  const text = isStrike ? strikeLine(a.strike) : ctPlain(a.text);
  return {
    id: a.id,
    name,
    icon: COST_ICON(a.cost),
    enabled: p.enabled || game.user.isGM,
    reasons: [...p.reasons, ...msgs].join(" · "),
    text,
    html: isStrike ? (a.boundStrike ? checkLinksHTML(ct(a.text)) : "") : checkLinksHTML(ct(a.text)),
    inline: !!a.inline,
    warning: msgs.length > 0
  };
}
/** Statblock Strike list; an invalid Strike stays visible with a warning instead of breaking the sheet. */
export function strikeListRows(strikes) {
  return (Array.isArray(strikes) ? strikes : []).map((x, i) => {
    const r = normalizeNpcStrike(x);
    const name = typeof x?.name === "string" && x.name.trim() ? x.name : `#${i + 1}`;
    if (r.fatal)
      return {
        ...(x && typeof x === "object" ? x : {}),
        name: ct(name),
        invalid: true,
        html: `<span class="tsc-warn">⚠ ${escHTML(r.issues.map((iss) => npcIssueText(iss, name, T)).join(" · "))}</span>`
      };
    return { ...r.strike, name: ct(r.strike.name), html: checkLinksHTML(strikeLine(r.strike)) };
  });
}

export function canRoll(doc) {
  return (
    game.user.isGM ||
    doc.testUserPermission?.(game.user, "OBSERVER") ||
    readStarship(doc).crew?.some((c) => fromUuidSync(c.uuid ?? c.actorUuid ?? "")?.testUserPermission?.(game.user, "OWNER"))
  );
}
export function safeRows(doc, fn) {
  try {
    return fn(doc);
  } catch (err) {
    console.warn("sf2e-tsc | sheet roll rows", err);
    return [];
  }
}
export function mine(st) {
  return !!st.helmedBy && fromUuidSync(st.helmedBy)?.testUserPermission?.(game.user, "OWNER");
}

export function npcActionRows(data, actor, stations, warnings = []) {
  const rows = [];
  for (const e of collectNpcActions(data, { actions: Content.actions.values(), get: (id) => Content.actions.get(id) })) {
    const msgs = e.issues.map((i) => npcIssueText(i, e.name, T));
    if (msgs.length) warnings.push(...msgs);
    if (!e.action) {
      rows.push({
        id: e.id,
        name: ct(e.name),
        icon: "⚠",
        enabled: false,
        warning: true,
        reasons: msgs.join(" · "),
        text: msgs.join(" · "),
        html: "",
        inline: true
      });
      continue;
    }
    try {
      rows.push({ ...npcRow(e.action, e.station, actor, msgs), stationId: e.station?.id ?? null });
    } catch (err) {
      const m = T("SF2eTSC.ui.npcIssue.renderFailed", { name: e.name, message: err.message });
      warnings.push(m);
      console.error(`${MODULE_ID} | NPC action row "${e.name}"`, err);
      rows.push({ id: e.id, name: ct(e.name), icon: "⚠", enabled: false, warning: true, reasons: m, text: m, html: "", inline: true });
    }
  }
  return rows;
}
