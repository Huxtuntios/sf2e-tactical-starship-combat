import { DEGREE_KEYS, MODULE_ID } from "../constants.mjs";
import { escapeHtml as foundryEscapeHtml, T, moduleActive, fromUuidSync_ } from "../utils/foundry.mjs";
import { checkLinksHTML } from "../content/inline-checks.mjs";
import { wireInlineClicks } from "../ui/inline-clicks.mjs";
import { ct } from "../content/content-i18n.mjs";
import { actionOutcomeSections, formatActionResultText, isCompletedActionResult } from "../actions/result-text.mjs";

export const CARD_DATA_FLAG = "cardData";
const escapeHtml = (value) =>
  globalThis.foundry?.utils?.escapeHTML
    ? foundryEscapeHtml(value)
    : String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const rich = (value) => checkLinksHTML(value, { nativeChecks: false });
const cleanCardHtml = (value) => {
  const html = String(value ?? "");
  return globalThis.foundry?.utils?.cleanHTML ? foundry.utils.cleanHTML(html) : escapeHtml(html);
};
const row = (label, value) =>
  `<div class="tsc-row"><span class="tsc-label">${escapeHtml(label)}</span><span class="tsc-value">${value}</span></div>`;

export function degreeOutcomeHtml(outcomes = [], rolledDegrees = [], { localize = T, escape = escapeHtml, enrich = rich } = {}) {
  if (!outcomes.length) return "";
  const rolled = new Set(rolledDegrees.filter(Number.isInteger));
  return `<div class="tsc-outcomes degree-of-success">${outcomes
    .map(({ key, degree, texts }) => {
      const isRolled = rolled.has(degree);
      return `<p class="tsc-outcome ${escape(key)}${isRolled ? " is-rolled" : ""}" data-degree="${escape(key)}"${
        isRolled ? ' aria-current="true"' : ""
      }><strong>${escape(localize(`SF2eTSC.degree.${key}`))}:</strong> ${texts.map(enrich).join("<br>")}</p>`;
    })
    .join("")}</div>`;
}

export function cardShell(kind, header, content, footer = "", attributes = "") {
  return `<article class="pf2e chat-card sf2e-tsc-card ${escapeHtml(kind)}"${attributes}>${header}<div class="card-content tsc-body">${content}</div>${footer}</article>`;
}

export function renderCard({
  kind,
  title,
  subtitle = "",
  img = null,
  rows = [],
  reports = [],
  alerts = [],
  manual = [],
  actions = "",
  bodyHtml = "",
  degree = "",
  outcomes = [],
  rolledDegree = null,
  attributes = ""
}) {
  const header = `<header class="card-header flexrow">${img ? `<img src="${escapeHtml(img)}" alt="">` : ""}<h3>${escapeHtml(title)}</h3>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}</header>`;
  const details = rows.length
    ? `<div class="tsc-card-details">${rows.map((entry) => (typeof entry === "string" ? entry : row(entry.label, entry.value))).join("")}</div>`
    : "";
  const consequenceHtml = reports.map((report) => `<p class="tsc-report">${rich(report)}</p>`).join("");
  const alertHtml = alerts.map((alert) => `<p class="tsc-alert">${alert}</p>`).join("");
  const manualHtml = manual.length
    ? `<div class="tsc-manual"><strong>${escapeHtml(T("SF2eTSC.chat.manualResolve"))}</strong>${manual.map((entry) => `<p>${rich(entry)}</p>`).join("")}</div>`
    : "";
  const degreeKey = Number.isInteger(rolledDegree) ? DEGREE_KEYS[rolledDegree] : null;
  const degreeHtml = degree
    ? `<div class="tsc-degree${degreeKey ? ` ${degreeKey}` : ""}"${degreeKey ? ` data-degree="${degreeKey}"` : ""}>${escapeHtml(degree)}</div>`
    : "";
  const outcomeHtml = degreeOutcomeHtml(outcomes, Number.isInteger(rolledDegree) ? [rolledDegree] : []);
  const footer = actions ? `<footer class="card-footer card-buttons">${actions}</footer>` : "";
  return cardShell(
    kind,
    header,
    `${degreeHtml}${outcomeHtml}${details}${cleanCardHtml(bodyHtml)}${consequenceHtml}${alertHtml}${manualHtml}`,
    footer,
    attributes
  );
}

function toolbeltSetting(tool, key) {
  const getter = game.toolbelt?.getToolSetting;
  if (typeof getter === "function") {
    const value = getter.call(game.toolbelt, tool, key);
    if (value !== undefined) return value;
  }
  try {
    return game.settings.get("pf2e-toolbelt", `${tool}.${key}`);
  } catch {
    return undefined;
  }
}

export function toolbeltTargetHelper() {
  if (!moduleActive("pf2e-toolbelt")) return null;
  const api = game.toolbelt?.api?.targetHelper;
  if (typeof api?.getMessageTargets !== "function" || typeof api?.setMessageFlagTargets !== "function") return null;
  if (toolbeltSetting("targetHelper", "enabled") !== true || toolbeltSetting("targetHelper", "targets") !== true) return null;
  return api;
}

function tokenForTarget(uuid) {
  if (typeof uuid !== "string" || !uuid) return null;
  if (uuid.startsWith("Scene.")) return fromUuidSync_(uuid);
  const actor = fromUuidSync_(uuid);
  if (!actor?.uuid) return null;
  return (
    (globalThis.canvas?.tokens?.placeables ?? []).find((token) => {
      const document = token.document ?? token;
      return document.actor?.uuid === actor.uuid || document.actorUuid === actor.uuid;
    })?.document ?? null
  );
}

function compatibleTokenUUIDs(targetUUIDs = []) {
  const seen = new Set();
  const uuids = [];
  for (const uuid of Array.isArray(targetUUIDs) ? targetUUIDs.slice(0, 50) : []) {
    const token = tokenForTarget(uuid);
    const tokenUuid = token?.uuid;
    if (!token?.actor || !tokenUuid || seen.has(tokenUuid) || (!game.user.isGM && token.hidden)) continue;
    seen.add(tokenUuid);
    uuids.push(tokenUuid);
  }
  return uuids;
}

export function withToolbeltTargets(data, targetUUIDs) {
  const helper = toolbeltTargetHelper();
  if (!helper) return data;
  const uuids = compatibleTokenUUIDs(targetUUIDs);
  return uuids.length ? helper.setMessageFlagTargets(data, uuids) : data;
}

export function toolbeltMessageTargets(message) {
  const helper = toolbeltTargetHelper();
  if (!helper) return [];
  try {
    return compatibleTokenUUIDs((helper.getMessageTargets(message) ?? []).map((token) => token?.uuid).filter(Boolean));
  } catch {
    return [];
  }
}

function damageTypeLabel(type) {
  const key = `SF2eTSC.damageTypes.${type}`;
  return game.i18n.has(key) ? T(key) : String(type ?? "");
}

function actionTitle(action = {}) {
  return game.i18n.has(`SF2eTSC.actions.${action.id}`) ? T(`SF2eTSC.actions.${action.id}`) : ct(action.name);
}

function damageCardData(data, message) {
  const result = data.result ?? {};
  const lines = [];
  if (data.attackLine) lines.push(data.attackLine);
  const targets = toolbeltMessageTargets(message);
  const targetUUIDs = targets.length ? targets : (data.targetUUIDs ?? []);
  const names = compatibleTokenUUIDs(targetUUIDs)
    .map((uuid) => fromUuidSync_(uuid))
    .filter(Boolean)
    .map((token) => token.name ?? token.actor?.name)
    .filter(Boolean);
  if (names.length) lines.push(row(T("SF2eTSC.chat.selectedTargets"), escapeHtml([...new Set(names)].join(", "))));
  const damageParts = result.components ?? data.parts ?? (data.damageType ? [{ type: data.damageType }] : []);
  const types = damageParts.map((part) => damageTypeLabel(part.type)).filter(Boolean);
  if (types.length) lines.push(row(T("SF2eTSC.ui.damageType"), escapeHtml(types.join(", "))));
  lines.push(
    row(
      T("SF2eTSC.chat.damage"),
      `${result.originalDamage}${result.mitigatedDamage !== result.originalDamage ? ` → ${result.mitigatedDamage}` : ""}`
    )
  );
  if (result.bypassedShields) lines.push(row(T("SF2eTSC.traits.bypassing"), "✔"));
  if (result.resistanceReduction) lines.push(row(T("SF2eTSC.chat.resistance"), `-${result.resistanceReduction}`));
  if (result.hardnessReduction) lines.push(row(T("SF2eTSC.chat.hardness"), `-${result.hardnessReduction}`));
  if (result.weaknessIncrease) lines.push(row(T("SF2eTSC.chat.weakness"), `+${result.weaknessIncrease}`));
  lines.push(row(T("SF2eTSC.ui.shieldPoints"), `-${result.shieldDamage}`));
  lines.push(row(T("SF2eTSC.ui.hullPoints"), `-${result.hullDamage}`));
  const alerts = [];
  if (result.immune) alerts.push(T("SF2eTSC.chat.immune"));
  if (result.becameCompromised)
    alerts.push(`<strong>${escapeHtml(T("SF2eTSC.chat.nowCompromised", { value: result.newState.compromised }))}</strong>`);
  else if (result.compromisedIncrease) alerts.push(escapeHtml(T("SF2eTSC.chat.compromisedUp", { value: result.newState.compromised })));
  if (result.stationsMalfunctioned) alerts.push(`⚠ ${escapeHtml(T("SF2eTSC.chat.stationsMalfunction"))}`);
  if (result.destroyed) alerts.push(`☠ ${escapeHtml(T("SF2eTSC.chat.destroyed"))}`);
  const undoable =
    data.undoRef &&
    !result.becameCompromised &&
    !result.becameInoperable &&
    !result.destroyed &&
    !result.stationsMalfunctioned &&
    !(result.compromisedIncrease > 0);
  const actions = undoable
    ? `<div class="tsc-card-undo"><button type="button" data-tsc-undo-damage data-message-id="${escapeHtml(data.undoRef.messageId)}" data-target-uuid="${escapeHtml(data.undoRef.targetUuid)}" data-roll-index="${escapeHtml(data.undoRef.rollIndex)}">${escapeHtml(T("SF2eTSC.toolbelt.undoDamage"))}</button></div>`
    : "";
  return renderCard({
    kind: "damage",
    title: data.initiator,
    subtitle: data.source ?? T("SF2eTSC.chat.damageTaken"),
    rows: lines,
    alerts,
    actions
  });
}

export function renderStoredCard(message) {
  const data = message.flags?.[MODULE_ID]?.[CARD_DATA_FLAG];
  if (!data) return "";
  if (data.kind === "damage") return damageCardData(data, message);
  if (data.kind === "simple") return renderCard({ kind: "simple", title: data.initiator, subtitle: data.title, bodyHtml: data.bodyHtml });
  if (data.kind === "action") {
    const rows = (data.lines ?? []).map((line) => row(line.label, escapeHtml(String(line.value))));
    if (data.crewName) rows.unshift(row(T("SF2eTSC.chat.crew"), escapeHtml(data.crewName)));
    const targets = toolbeltMessageTargets(message);
    const targetUUIDs = targets.length ? targets : (data.targetUUIDs ?? []);
    const names = compatibleTokenUUIDs(targetUUIDs)
      .map((uuid) => fromUuidSync_(uuid))
      .filter(Boolean)
      .map((token) => token.name ?? token.actor?.name)
      .filter(Boolean);
    if (names.length) rows.push(row(T("SF2eTSC.chat.selectedTargets"), escapeHtml([...new Set(names)].join(", "))));
    const completed = data.result ? isCompletedActionResult(data.result) : true;
    const outcomes = completed && Number.isInteger(data.degree) ? actionOutcomeSections(data.action?.outcomes, { translate: ct }) : [];
    return renderCard({
      kind: "action",
      title: data.initiator,
      subtitle: `${actionTitle(data.action)}${data.stationName ? ` — ${ct(data.stationName)}` : ""}`,
      rows,
      degree: completed ? data.degreeLabel : "",
      outcomes,
      rolledDegree: completed ? data.degree : null,
      reports: completed ? data.reports : [],
      manual: completed ? data.manual : []
    });
  }
  if (data.kind === "hazard")
    return renderCard({
      kind: "hazard",
      title: T("SF2eTSC.chat.hazardTitle"),
      subtitle: `${ct(data.hazardName)}${data.zone ? ` — ${T("SF2eTSC.ui.zone")} ${escapeHtml(data.zone)}` : ""}`,
      bodyHtml: `<p>${escapeHtml(data.title ?? T("SF2eTSC.chat.hazardTriggered"))}</p>${data.effectText ? `<p>${rich(data.effectText)}</p>` : ""}`
    });
  if (data.kind === "integrity")
    return renderCard({
      kind: "integrity",
      title: data.initiator,
      subtitle: T("SF2eTSC.chat.hullIntegrity"),
      rows: [
        row(T("SF2eTSC.ui.dcShort"), escapeHtml(data.dc)),
        row(T("SF2eTSC.chat.result"), escapeHtml(data.degreeLabel)),
        row(T("SF2eTSC.ui.compromised"), escapeHtml(`${data.delta > 0 ? "+" : ""}${data.delta} → ${data.newValue}`))
      ],
      reports: data.outcomeText ? [data.outcomeText] : []
    });
  return "";
}

export function renderActionDescriptionCard(message, root) {
  const data = message.flags?.[MODULE_ID]?.actionDescription;
  if (!data) return "";
  const previous = root.querySelector(".tsc-action-description-message");
  const title = previous?.querySelector("h3")?.textContent ?? ct(data.actionId);
  const subtitle = previous?.querySelector(".tsc-dim")?.textContent ?? "";
  const sourceHtml = previous?.querySelector(".tsc-action-source-text")?.innerHTML ?? `<p>${rich(data.sourceText)}</p>`;
  const resultHtml = data.resultText
    ? `<div class="tsc-action-result-text">${escapeHtml(data.resultText).replace(/\n/g, "<br>")}</div>`
    : "";
  return renderCard({
    kind: "action-description",
    title,
    subtitle,
    bodyHtml: `<div class="tsc-action-source-text">${sourceHtml}</div>${resultHtml}`
  });
}

export function registerCardRendering() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    const rendered = renderStoredCard(message) || renderActionDescriptionCard(message, root);
    if (!rendered) return;
    const slot = root.querySelector(".sf2e-tsc-card, .tsc-action-description-message");
    if (!slot) return;
    const template = document.createElement("template");
    template.innerHTML = rendered.trim();
    slot.replaceWith(template.content.firstElementChild);
    wireInlineClicks(root);
  });
}

export function actionResultFlag({ degreeLabel, degree = null, outcomes = null, result = null, lines = [], reports = [], manual = [] }) {
  return formatActionResultText(
    { ...(result ?? { ok: true }), degreeLabel, degree, outcomes, lines, reports, manual },
    { localize: T, translate: ct }
  );
}
