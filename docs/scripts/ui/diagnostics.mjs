/**
 * Module health: what is wrong with the setup of this world, in plain words. `collectDiagnostics` is pure (the world is
 * passed in) so it is unit-tested; `openDiagnostics` renders it in a dialog.
 */
import { MODULE_ID } from "../constants.mjs";
import { readStarship, isStarship } from "../starship/starship-state.mjs";
import { CAUSODES_IDS } from "../integrations/causodes.mjs";
import { T, moduleSetting } from "../utils/foundry.mjs";
import { escHTML } from "./sheet/sheet-model.mjs";
import { itemTagFix } from "../content/world-maintenance.mjs";

const row = (level, label, detail = "") => ({ level, label, detail });

/** @returns {{level:"ok"|"warn"|"bad"|"info", label:string, detail:string}[]} */
export function collectDiagnostics({ game, resolve = (uuid) => fromUuidSync(uuid) }) {
  const rows = [];
  const mod = game.modules.get(MODULE_ID);
  rows.push(
    row(
      "info",
      T("SF2eTSC.diag.versions"),
      `${mod?.version ?? "?"} · ${game.system?.id ?? "?"} ${game.system?.version ?? "?"} · Foundry ${game.version ?? "?"}`
    )
  );

  // players need an active GM client: every action is executed there
  const gmOnline = [...game.users].some((u) => u.active && u.isGM);
  rows.push(gmOnline ? row("ok", T("SF2eTSC.diag.gmOnline")) : row("bad", T("SF2eTSC.diag.noGm"), T("SF2eTSC.diag.noGmHint")));

  const ships = [...game.actors].filter((a) => isStarship(a));
  rows.push(
    row(
      "info",
      T("SF2eTSC.diag.ships"),
      T("SF2eTSC.diag.shipCount", {
        player: ships.filter((s) => readStarship(s).role === "player").length,
        npc: ships.filter((s) => readStarship(s).role === "npc").length
      })
    )
  );

  const issues = [];
  for (const s of ships) {
    const d = readStarship(s);
    for (const err of d._errors ?? []) issues.push(`${s.name}: ${typeof err === "string" ? err : (err.code ?? "data")}`);
    for (const c of d.crew ?? [])
      if (c.actorUuid && !resolve(c.actorUuid)) issues.push(T("SF2eTSC.diag.missingCrew", { ship: s.name, name: c.name ?? c.actorUuid }));
  }
  rows.push(
    issues.length
      ? row("warn", T("SF2eTSC.diag.dataIssues", { n: issues.length }), issues.slice(0, 12).join("\n"))
      : row("ok", T("SF2eTSC.diag.dataClean"))
  );

  // items of the module (world items, station actions on characters, hazard abilities) that miss the starship tag
  const untagged = [];
  for (const it of game.items ?? []) if (itemTagFix(it, null)) untagged.push(it.name);
  for (const a of game.actors ?? []) for (const it of a.items ?? []) if (itemTagFix(it, a)) untagged.push(`${a.name}: ${it.name}`);
  rows.push(
    untagged.length
      ? row("warn", T("SF2eTSC.diag.tagsMissing", { n: untagged.length }), untagged.slice(0, 12).join("\n"))
      : row("ok", T("SF2eTSC.diag.tagsOk"))
  );

  const other = CAUSODES_IDS.filter((id) => game.modules.get(id)?.active);
  rows.push(other.length ? row("warn", T("SF2eTSC.diag.causodes"), other.join(", ")) : row("ok", T("SF2eTSC.diag.noConflict")));
  rows.push(
    row(
      "info",
      T("SF2eTSC.diag.enforcement"),
      T(`SF2eTSC.settings.ruleEnforcement.${moduleSetting("ruleEnforcement") === "strict" ? "strict" : "warn"}`)
    )
  );
  rows.push(row("info", T("SF2eTSC.diag.holodock"), game.modules.get("holodock")?.active ? T("SF2eTSC.diag.on") : T("SF2eTSC.diag.off")));
  return rows;
}

const ICON = { ok: "fa-circle-check", warn: "fa-triangle-exclamation", bad: "fa-circle-xmark", info: "fa-circle-info" };

export function diagnosticsHTML(rows) {
  const items = rows
    .map(
      (r) =>
        `<li class="tsc-diag ${r.level}"><i class="fa-solid ${ICON[r.level]}" aria-hidden="true"></i> <strong>${escHTML(r.label)}</strong>${r.detail ? `<pre>${escHTML(r.detail)}</pre>` : ""}</li>`
    )
    .join("");
  return `<ul class="tsc-diag-list">${items}</ul>`;
}

export async function openDiagnostics() {
  return foundry.applications.api.DialogV2.prompt({
    window: { title: T("SF2eTSC.ui.diagnostics"), icon: "fa-solid fa-stethoscope" },
    classes: ["sf2e-tsc"],
    position: { width: 460 },
    content: diagnosticsHTML(collectDiagnostics({ game })),
    ok: { label: T("SF2eTSC.ui.close") },
    rejectClose: false
  });
}
