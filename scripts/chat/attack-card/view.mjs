/**
 * Attack card: HTML view. Pure: every label/i18n function is injected (see render.mjs for the Foundry binding),
 * so the card can be rendered and tested without Foundry.
 */
import { MODULE_ID } from "../../constants.mjs";
import { CARD_FLAG, fmt } from "./model.mjs";

const esc0 = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * @param {{ t?: Function, has?: Function, actionLabel?: Function, ct?: Function, designation?: Function, esc?: Function }} labels
 * @returns {{ renderAttackCard: (message: object) => string, renderDiag: (diag: object) => string }}
 */
export function makeCardRenderer(labels = {}) {
  const T = labels.t ?? ((k) => k);
  const actionLabel = labels.actionLabel ?? ((a) => a?.name ?? "");
  const ct = labels.ct ?? ((s) => s);
  const displayDesignation = labels.designation ?? ((s) => s);
  const escapeHtml = labels.esc ?? esc0;
  const game = { i18n: { has: labels.has ?? (() => false) } };
  const REASON = (r) => T(`SF2eTSC.targeting.reason.${r}`);
  const row = (label, value) => `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`;
  const modList = (mods) =>
    (mods ?? [])
      .filter((m) => m.value)
      .map((m) => `${escapeHtml(m.label)} ${fmt(m.value)}`)
      .join(", ");
  const traitLabel = (t) => {
    const slug = String(t)
      .toLowerCase()
      .replace(/\s+\d.*$/, "")
      .replace(/\s+/g, "-");
    const k = `SF2eTSC.traits.${slug}`;
    const rest = String(t).slice(slug.length).trim();
    return game.i18n.has(k) ? `${T(k)}${rest && /^\d/.test(rest) ? ` ${rest}` : ""}` : String(t);
  };
  const dmgType = (t) => (t && game.i18n.has(`SF2eTSC.damageTypes.${t}`) ? T(`SF2eTSC.damageTypes.${t}`) : (t ?? ""));
  const targetName = (t) => (t.label ? escapeHtml(displayDesignation(t.label)) : escapeHtml(T("SF2eTSC.detection.contact")));

  /** Render a card (called on the GM when creating/updating and on every client at render time, in its own language). */
  function renderAttackCard(message) {
    const c = message.flags[MODULE_ID][CARD_FLAG];
    const img = c.crew?.img ?? c.ship.img;
    const who = c.crew
      ? `${escapeHtml(c.crew.name)}${c.station ? ` — ${escapeHtml(c.station.name)}` : ""}`
      : escapeHtml(T("SF2eTSC.attackCard.noCrew"));
    const head = `<header class="tsc-ac-head">${img ? `<img src="${escapeHtml(img)}" alt="">` : ""}<div><h3>${escapeHtml(c.ship.publicName ?? c.ship.name)}</h3><span>${escapeHtml(actionLabel(c.action))} · ${escapeHtml(ct(c.weapon.name))}</span></div></header>`;
    const dl = [];
    dl.push(row(T("SF2eTSC.attackCard.attacker"), who));
    dl.push(row(T("SF2eTSC.attackCard.attackType"), escapeHtml(T(`SF2eTSC.attackCard.type.${c.attackType}`))));
    if (c.weapon.traits?.length) dl.push(row(T("SF2eTSC.ui.traits"), escapeHtml(c.weapon.traits.map(traitLabel).join(", "))));
    if (c.weapon.damage) dl.push(row(T("SF2eTSC.chat.damage"), escapeHtml(`${c.weapon.damage} ${dmgType(c.weapon.damageType)}`.trim())));
    dl.push(
      row(
        T("SF2eTSC.attackCard.range"),
        escapeHtml(
          `${c.range.zones ?? "—"} ${T("SF2eTSC.attackCard.zones")}${c.range.increment ? ` · ${T("SF2eTSC.mods.rangeIncrement")} ${c.range.increment}` : ""}${c.range.fromZone != null ? ` · ${T("SF2eTSC.attackCard.fromZone", { zone: c.range.fromZone })}` : ""}`
        )
      )
    );
    if (c.bonus) dl.push(row(T("SF2eTSC.mods.attackBonus"), escapeHtml(fmt(c.bonus.value))));
    if (c.map && c.status === "open") {
      const prof = c.map.profile ?? { map1: -5, map2: -10 };
      const sel = c.map.choice ?? "0";
      const base = Number.isFinite(c.bonus?.value) ? c.bonus.value : null;
      const btn = (v, k, p) =>
        `<button type="button" class="tsc-map-btn${sel === v ? " active" : ""}" data-tsc-map-choice="${v}" aria-pressed="${sel === v}" title="${escapeHtml(T(k))}">${escapeHtml(T(k))} <strong>${escapeHtml(base != null ? fmt(base + p) : fmt(p))}</strong>${p ? ` <small>(${escapeHtml(fmt(p))})</small>` : ""}</button>`;
      dl.push(
        row(
          T("SF2eTSC.ui.map"),
          `<span class="tsc-map-btns" role="group" aria-label="${escapeHtml(T("SF2eTSC.ui.map"))}">${btn("0", "SF2eTSC.rolls.map0", 0)}${btn("1", "SF2eTSC.rolls.map1", prof.map1)}${btn("2", "SF2eTSC.rolls.map2", prof.map2)}</span>`
        )
      );
    } else if (c.map) dl.push(row(T("SF2eTSC.ui.map"), escapeHtml(fmt(c.map.current ?? 0))));
    if (c.commonMods?.length) dl.push(row(T("SF2eTSC.attackCard.modifiers"), `<span class="tsc-ac-mods">${modList(c.commonMods)}</span>`));
    let targets = "";
    if (c.status === "open") {
      const items = c.targets
        .map((t) =>
          t.available
            ? `<li><button type="button" data-tsc-attack="resolve" data-target-key="${escapeHtml(t.key)}"><span>${targetName(t)}</span><span>${escapeHtml(T("SF2eTSC.attackCard.zoneDist", { zone: t.zone, distance: t.distance }))}${t.ac != null ? ` · ${escapeHtml(T("SF2eTSC.ui.ac"))} ${t.ac}` : ""}${t.behind ? " ⟲" : ""}${t.warning ? ` · <em class="tsc-warn">⚠ ${escapeHtml(REASON(t.warning))}</em>` : ""}</span></button></li>`
            : `<li class="tsc-ac-off">${targetName(t)} — ${escapeHtml(REASON(t.reason))}${t.distance != null ? ` (${escapeHtml(T("SF2eTSC.attackCard.zoneDist", { zone: t.zone, distance: t.distance }))})` : ""}</li>`
        )
        .join("");
      targets = `<h4>${escapeHtml(T("SF2eTSC.attackCard.targets"))}</h4><ul class="tsc-ac-targets">${items || `<li class="tsc-ac-off">${escapeHtml(T("SF2eTSC.attackCard.noTargets"))}</li>`}</ul>
      <div class="tsc-btn-row"><button type="button" data-tsc-attack="map"><i class="fa-solid fa-satellite"></i> ${escapeHtml(T("SF2eTSC.attackCard.pickOnMap"))}</button><button type="button" data-tsc-attack="cancel"><i class="fa-solid fa-xmark"></i> ${escapeHtml(T("SF2eTSC.attackCard.cancel"))}</button></div>`;
    }
    let result = "";
    if (c.result) {
      const r = c.result,
        a = r.attack;
      const rl = [];
      rl.push(row(T("SF2eTSC.attackCard.target"), escapeHtml(displayDesignation(r.targetLabel ?? "?"))));
      if (a) {
        rl.push(row(T("SF2eTSC.chat.attack"), escapeHtml(`${a.total}${a.natural != null ? ` (d20 ${a.natural})` : ""}`)));
        if (a.modifiers?.length)
          rl.push(row(T("SF2eTSC.attackCard.modifiers"), `<span class="tsc-ac-mods">${modList(a.modifiers)}</span>`));
        rl.push(
          row(
            T("SF2eTSC.ui.ac"),
            escapeHtml(
              `${a.ac}${a.acModifiers?.length ? ` (${a.baseAC}; ${a.acModifiers.map((m) => `${m.label} ${fmt(m.value)}`).join(", ")})` : ""}`
            )
          )
        );
        rl.push(row(T("SF2eTSC.chat.result"), `<strong>${escapeHtml(a.degreeLabel ?? r.degreeLabel ?? "")}</strong>`));
      } else if (r.degreeLabel) rl.push(row(T("SF2eTSC.chat.result"), `<strong>${escapeHtml(r.degreeLabel)}</strong>`));
      for (const d of r.damage ?? []) {
        const parts = [
          `${d.rolled} ${dmgType(d.damageType)}`.trim(),
          `${T("SF2eTSC.ui.sp")} −${d.shield}`,
          `${T("SF2eTSC.ui.hp")} −${d.hull}`
        ];
        if (d.immune) parts.push(T("SF2eTSC.chat.immune"));
        if (d.resisted) parts.push(`${T("SF2eTSC.chat.resistance")} −${d.resisted}`);
        if (d.hardness) parts.push(`${T("SF2eTSC.chat.hardness")} −${d.hardness}`);
        if (d.weakness) parts.push(`${T("SF2eTSC.chat.weakness")} +${d.weakness}`);
        if (d.bypassed) parts.push(T("SF2eTSC.traits.bypassing"));
        rl.push(row(T("SF2eTSC.chat.damage"), escapeHtml(parts.join(" · "))));
        const cons = [];
        if (d.compromised) cons.push(T("SF2eTSC.attackCard.becameCompromised"));
        else if (d.compromisedIncrease) cons.push(T("SF2eTSC.attackCard.compromisedUp", { value: d.compromisedIncrease }));
        if (d.malfunction) cons.push(T("SF2eTSC.chat.stationsMalfunction"));
        if (d.destroyed) cons.push(T("SF2eTSC.chat.destroyed"));
        if (cons.length) rl.push(row(T("SF2eTSC.attackCard.consequences"), escapeHtml(cons.join(" · "))));
      }
      for (const rep of r.reports ?? []) rl.push(`<dt></dt><dd class="tsc-report">${escapeHtml(rep)}</dd>`);
      if (r.map) rl.push(row(T("SF2eTSC.ui.map"), escapeHtml(fmt(r.map.before ?? 0))));
      const pd = r.pendingDamage;
      let dmgBox = "";
      if (pd) {
        rl.push(
          row(
            T("SF2eTSC.rolls.damageFormula"),
            escapeHtml(
              `${pd.crit ? pd.critFormula : pd.formula} ${[pd.damageType, ...(pd.extraTypes ?? [])].map(dmgType).join(" + ")}${pd.crit ? ` (${T("SF2eTSC.rolls.critical")})` : ""}`
            )
          )
        );
        if (c.damageRoll) rl.push(row(T("SF2eTSC.rolls.damageRolled"), escapeHtml(`${c.damageRoll.total} (${c.damageRoll.formula})`)));
        if (c.damageApplied && c.damageResult) {
          const d = c.damageResult;
          rl.push(
            row(
              T("SF2eTSC.rolls.damageApplied"),
              escapeHtml(
                [
                  `${T("SF2eTSC.ui.sp")} −${d.shield}`,
                  `${T("SF2eTSC.ui.hp")} −${d.hull}`,
                  d.immune ? T("SF2eTSC.chat.immune") : null,
                  d.resisted ? `${T("SF2eTSC.chat.resistance")} −${d.resisted}` : null,
                  d.hardness ? `${T("SF2eTSC.chat.hardness")} −${d.hardness}` : null,
                  d.weakness ? `${T("SF2eTSC.chat.weakness")} +${d.weakness}` : null,
                  d.destroyed ? T("SF2eTSC.chat.destroyed") : null
                ]
                  .filter(Boolean)
                  .join(" · ")
              )
            )
          );
        }
        if (!c.damageApplied)
          dmgBox = `<div class="tsc-btn-row"><button type="button" data-tsc-attack="damage"><i class="fa-solid fa-burst"></i> ${escapeHtml(T(c.damageRoll ? "SF2eTSC.rolls.rerollDamage" : "SF2eTSC.rolls.rollDamage"))}</button>${c.damageRoll ? `<button type="button" data-tsc-attack="apply" data-gm-only="1"><i class="fa-solid fa-heart-crack"></i> ${escapeHtml(T("SF2eTSC.rolls.applyDamage"))}</button>` : ""}</div>`;
      }
      result = `<h4>${escapeHtml(T("SF2eTSC.attackCard.resultTitle"))}</h4><dl>${rl.join("")}</dl>${dmgBox}`;
    }
    const status =
      c.status === "resolved"
        ? `<p class="tsc-ac-status done">✔ ${escapeHtml(T("SF2eTSC.attackCard.status.resolved"))}</p>`
        : c.status === "void"
          ? `<p class="tsc-ac-status void">✖ ${escapeHtml(c.error ?? T("SF2eTSC.attackCard.status.void"))}</p>`
          : c.status === "resolving"
            ? `<p class="tsc-ac-status">⏳ ${escapeHtml(T("SF2eTSC.attackCard.status.resolving"))}</p>`
            : c.error
              ? `<p class="tsc-ac-status void">${escapeHtml(c.error)}</p>`
              : "";
    return `<div class="sf2e-tsc-card tsc-attack-card" data-status="${c.status}">${head}<dl>${dl.join("")}</dl>${targets}${result}${status}</div>`;
  }

  function renderDiag(d) {
    const rows = d.rows
      .map(
        (r) =>
          `<li>${escapeHtml(r.name)} — ${escapeHtml(T("SF2eTSC.attackCard.zoneDist", { zone: r.zone, distance: r.distance ?? "—" }))}: ${escapeHtml(r.available ? T("SF2eTSC.attackCard.diagHiddenFromPlayers") : REASON(r.reason))}</li>`
      )
      .join("");
    return `<div class="sf2e-tsc-card tsc-attack-card tsc-attack-diag"><header><h3>${escapeHtml(T("SF2eTSC.attackCard.diagTitle"))}</h3><span>${escapeHtml(d.ship)}</span></header><ul>${rows}</ul></div>`;
  }
  return { renderAttackCard, renderDiag };
}
