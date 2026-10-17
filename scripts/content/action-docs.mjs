/**
 * pure builders (no Foundry globals) for the "Starship Actions" Item compendium.
 * Every catalogue action (player battle stations, any station and NPC starships) becomes a native sf2e Item of type
 * "action" with a "Perform on the ship" link. Pack items carry the `packAction` flag (not `stationAction`), so the
 * automatic station-item synchronisation never deletes copies that a GM or player dragged onto a sheet.
 */
import { MODULE_ID, STARSHIP_TAG } from "../constants.mjs";

/** sf2e / pf2e system schema version written into module-created documents (sf2e 1.6.0: 0.959). */
export const SF2E_SCHEMA_VERSION = 0.959;
export function schemaStamp() {
  const live = Number(globalThis.game?.pf2e?.MigrationRunner?.LATEST_SCHEMA_VERSION);
  return { version: Number.isFinite(live) && live > 0 ? live : SF2E_SCHEMA_VERSION, previous: null };
}

export const PACK_FLAG = "packAction";
/** Traits that exist in sf2e's action-trait list; module-only tags ("station", "spell") are dropped. */
export const PACK_ACTION_TRAITS = new Set([
  "starship",
  "attack",
  "cantrip",
  "concentrate",
  "flourish",
  "healing",
  "incapacitation",
  "manipulate",
  "move",
  "auditory",
  "visual",
  "mental",
  "fortune",
  "misfortune"
]);
const ICON = { 1: "OneAction", 2: "TwoActions", 3: "ThreeActions", free: "FreeAction", reaction: "Reaction" };

export function packActionType(cost) {
  if (cost === "reaction") return { actionType: "reaction", actions: null };
  if (cost === "free") return { actionType: "free", actions: null };
  const n = Array.isArray(cost) ? Math.min(...cost.map(Number)) : Number(cost ?? 1);
  if (!Number.isFinite(n)) return { actionType: "action", actions: 1 };
  if (n <= 0) return { actionType: "free", actions: null };
  return { actionType: "action", actions: Math.min(3, Math.max(1, Math.round(n))) };
}
import { linkInline } from "./inline-links.mjs";
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Optional localisation (0.9.1, RU pack copies): tr(text), gradeLabel(grade), labels {actions, minGrade, page}. Flags stay English. */
export function buildActionItemData(
  a,
  {
    systemId = "sf2e",
    stationName = "",
    runLabel = "Выполнить на корабле / Perform on the ship",
    tr = (x) => x,
    gradeLabel = (g) => g,
    labels = {}
  } = {}
) {
  const L = { actions: "actions", minGrade: "min. grade", page: "p.", ...labels };
  const t = packActionType(a.cost);
  const traits = [...new Set((a.traits ?? []).map((x) => String(x).toLowerCase()))].filter((x) => PACK_ACTION_TRAITS.has(x));
  const cost = Array.isArray(a.cost) ? `<p><em>${esc(a.cost.join("–"))} ${esc(L.actions)}</em></p>` : "";
  const meta = [
    stationName && `<strong>${esc(stationName)}</strong>`,
    a.minGrade && `${esc(L.minGrade)}: ${esc(gradeLabel(a.minGrade))}`,
    a.source?.page && `${esc(a.source.book ?? "")} ${esc(L.page)} ${esc(a.source.page)}`
  ]
    .filter(Boolean)
    .join(" · ");
  const link = `<a class="tsc-run-action" data-action-id="${esc(a.id)}" data-station-type="${esc(a.station ?? "")}"><i class="fa-solid fa-rocket"></i> ${esc(runLabel)}</a>`;
  const text = typeof a.text === "string" ? tr(a.text) : null;
  const body = typeof text === "string" ? (text.startsWith("<") ? linkInline(text) : `<p>${linkInline(esc(text))}</p>`) : "";
  return {
    name: a.name ? tr(a.name) : a.id,
    type: "action",
    img: `systems/${systemId}/icons/actions/${ICON[t.actionType === "action" ? t.actions : t.actionType]}.webp`,
    system: {
      actionType: { value: t.actionType },
      actions: { value: t.actions },
      category: traits.includes("attack") ? "offensive" : "interaction",
      description: { value: `${meta ? `<p>${meta}</p>` : ""}<p>${link}</p>${cost}${body}`, gm: "" },
      traits: { value: [...new Set([...traits, STARSHIP_TAG])], rarity: "common", otherTags: [STARSHIP_TAG] },
      slug: `tsc-${a.id}`,
      rules: [],
      publication: { title: "SF2e Tactical Starship Combat", authors: "", license: "ORC", remaster: true },
      _migration: schemaStamp()
    },
    flags: { [MODULE_ID]: { [PACK_FLAG]: { actionId: a.id, station: a.station ?? null } } }
  };
}
