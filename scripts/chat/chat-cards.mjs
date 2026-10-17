import { MODULE_ID } from "../constants.mjs";
import { escapeHtml, T } from "../utils/foundry.mjs";
import { linkInline } from "../content/inline-links.mjs";
import { ct } from "../content/content-i18n.mjs";
/** Escaped text with clickable inline checks (chat messages are enriched by Foundry on render). */
const rich = (s) => linkInline(escapeHtml(s));

const wrap = (cls, inner) => `<div class="sf2e-tsc-card ${cls}">${inner}</div>`;
const row = (label, value) =>
  `<div class="tsc-row"><span class="tsc-label">${escapeHtml(label)}</span><span class="tsc-value">${value}</span></div>`;

async function post({ actor = null, content, whisperGM = false, flags = {} }) {
  const data = {
    content,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    flags: { [MODULE_ID]: { card: true, ...flags } }
  };
  if (whisperGM) data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  return ChatMessage.create(data);
}

export async function postSimpleCard({ actor, title, body, whisperGM = false }) {
  return post({
    actor,
    whisperGM,
    content: wrap(
      "simple",
      `<header><h3>${escapeHtml(actor?.name ?? "")}</h3><span>${escapeHtml(title)}</span></header><div class="tsc-body">${body}</div>`
    )
  });
}

/** Card for a station / starship action. `lines` = [{label,value}] */
export async function postActionCard({ actor, action, crewName, stationName, degreeLabel, lines = [], reports = [], manual = [] }) {
  const head = `<header><h3>${escapeHtml(actor.name)}</h3><span>${escapeHtml(game.i18n.has(`SF2eTSC.actions.${action.id}`) ? T(`SF2eTSC.actions.${action.id}`) : ct(action.name))}${stationName ? ` — ${escapeHtml(ct(stationName))}` : ""}</span></header>`;
  const meta = crewName ? row(T("SF2eTSC.chat.crew"), escapeHtml(crewName)) : "";
  const deg = degreeLabel ? `<div class="tsc-degree">${escapeHtml(degreeLabel)}</div>` : "";
  const body =
    lines.map((l) => row(l.label, escapeHtml(String(l.value)))).join("") +
    reports.map((r) => `<p class="tsc-report">${rich(r)}</p>`).join("");
  const man = manual.length
    ? `<div class="tsc-manual"><strong>${T("SF2eTSC.chat.manualResolve")}</strong>${manual.map((m) => `<p>${rich(m)}</p>`).join("")}</div>`
    : "";
  return post({ actor, content: wrap("action", `${head}${meta}${deg}<div class="tsc-body">${body}</div>${man}`) });
}

/** Card describing structured damage output (mirrors the damage engine result). */
export async function postDamageCard({ actor, source, result, attackLine = null }) {
  const r = result;
  const lines = [];
  if (attackLine) lines.push(attackLine);
  lines.push(
    row(T("SF2eTSC.chat.damage"), `${r.originalDamage}${r.mitigatedDamage !== r.originalDamage ? ` → ${r.mitigatedDamage}` : ""}`)
  );
  if (r.bypassedShields) lines.push(row(T("SF2eTSC.traits.bypassing"), "✔"));
  if (r.resistanceReduction) lines.push(row(T("SF2eTSC.chat.resistance"), `-${r.resistanceReduction}`));
  if (r.hardnessReduction) lines.push(row(T("SF2eTSC.chat.hardness"), `-${r.hardnessReduction}`));
  if (r.weaknessIncrease) lines.push(row(T("SF2eTSC.chat.weakness"), `+${r.weaknessIncrease}`));
  lines.push(row(T("SF2eTSC.ui.shieldPoints"), `-${r.shieldDamage}`));
  lines.push(row(T("SF2eTSC.ui.hullPoints"), `-${r.hullDamage}`));
  if (r.immune) lines.push(`<p class="tsc-report">${T("SF2eTSC.chat.immune")}</p>`);
  if (r.becameCompromised) lines.push(`<p class="tsc-alert">${T("SF2eTSC.chat.nowCompromised", { value: r.newState.compromised })}</p>`);
  else if (r.compromisedIncrease)
    lines.push(`<p class="tsc-alert">${T("SF2eTSC.chat.compromisedUp", { value: r.newState.compromised })}</p>`);
  if (r.stationsMalfunctioned) lines.push(`<p class="tsc-alert">⚠ ${T("SF2eTSC.chat.stationsMalfunction")}</p>`);
  if (r.destroyed) lines.push(`<p class="tsc-alert tsc-destroyed">☠ ${T("SF2eTSC.chat.destroyed")}</p>`);
  return post({
    actor,
    flags: { damage: r },
    content: wrap(
      "damage",
      `<header><h3>${escapeHtml(actor.name)}</h3><span>${escapeHtml(source ?? T("SF2eTSC.chat.damageTaken"))}</span></header><div class="tsc-body">${lines.join("")}</div>`
    )
  });
}

export async function postHazardCard({ hazard, zone, effectText, title }) {
  effectText = ct(effectText);
  return post({
    content: wrap(
      "hazard",
      `<header><h3>⚠ ${T("SF2eTSC.chat.hazardTitle")}</h3><span>${escapeHtml(hazard.name)}${zone ? ` — ${T("SF2eTSC.ui.zone")} ${zone}` : ""}</span></header><div class="tsc-body"><p>${escapeHtml(title ?? T("SF2eTSC.chat.hazardTriggered"))}</p>${effectText ? `<p>${rich(effectText)}</p>` : ""}</div>`
    )
  });
}

export async function postIntegrityCard({ actor, dc, degreeLabel, delta, newValue, outcomeText }) {
  return post({
    actor,
    content: wrap(
      "integrity",
      `<header><h3>${escapeHtml(actor.name)}</h3><span>${T("SF2eTSC.chat.hullIntegrity")}</span></header><div class="tsc-body">${row(T("SF2eTSC.ui.dcShort"), dc)}${row(T("SF2eTSC.chat.result"), escapeHtml(degreeLabel))}${row(T("SF2eTSC.ui.compromised"), `${delta > 0 ? "+" : ""}${delta} → ${newValue}`)}${outcomeText ? `<p class="tsc-report">${escapeHtml(outcomeText)}</p>` : ""}</div>`
    )
  });
}
