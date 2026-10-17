/**
 * runtime side of @TscCondition[slug|value:N]{label}. Resolves the slug to the system's condition item
 * (compendium "<system>.conditions") and renders a normal content link (drag/drop, click opens the item).
 * Falls back to a plain styled span when the condition is not found.
 */
import { CONDITION_TOKEN } from "./inline-links.mjs";

const ALIASES = { "off-guard": ["off-guard", "flat-footed"] };
let cache = null;

function conditionPack() {
  const sys = game.system.id;
  return (
    game.packs.get(`${sys}.conditions`) ??
    game.packs.find((p) => p.documentName === "Item" && p.metadata.packageName === sys && /condition/i.test(p.metadata.name)) ??
    game.packs.find((p) => p.documentName === "Item" && /conditions?$/i.test(p.metadata.name))
  );
}
const slugify = (s) =>
  String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function loadIndex() {
  if (cache) return cache;
  cache = new Map();
  const pack = conditionPack();
  if (!pack) return cache;
  const idx = await pack.getIndex({ fields: ["system.slug"] });
  for (const e of idx) {
    const uuid = e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`;
    for (const k of [e.system?.slug, slugify(e.name)]) if (k && !cache.has(k)) cache.set(k, { uuid, name: e.name });
  }
  return cache;
}

/** { uuid, name } of the condition or null. */
export async function findCondition(slug) {
  const idx = await loadIndex();
  for (const k of ALIASES[slug] ?? [slug]) if (idx.has(k)) return idx.get(k);
  return null;
}

export async function enrichCondition(match) {
  const [, slug, value, label] = match;
  const found = await findCondition(slug);
  const text = label || `${found?.name ?? slug}${value ? ` ${value}` : ""}`;
  if (!found) {
    const s = document.createElement("span");
    s.className = "tsc-condition";
    s.textContent = text;
    return s;
  }
  const TE = foundry.applications.ux.TextEditor.implementation;
  const html = await TE.enrichHTML(`@UUID[${found.uuid}]{${text}}`);
  const div = document.createElement("div");
  div.innerHTML = html;
  const a = div.querySelector("a") ?? div.firstElementChild;
  if (!a) {
    const s = document.createElement("span");
    s.textContent = text;
    return s;
  }
  a.classList.add("tsc-condition");
  if (value) a.dataset.value = value;
  a.draggable = true;
  a.addEventListener("dragstart", (event) => {
    event.stopPropagation();
    event.dataTransfer.setData("text/plain", JSON.stringify(conditionDragData(found.uuid, value)));
  });
  return a;
}

export function registerConditionEnricher() {
  CONFIG.TextEditor.enrichers.push({ id: "tscCondition", pattern: new RegExp(CONDITION_TOKEN.source, "g"), enricher: enrichCondition });
}

/** Module windows: open the condition sheet for a rendered <a class="tsc-cond">. */
export async function openCondition(slug) {
  const found = await findCondition(slug);
  if (!found) return;
  const doc = await fromUuid(found.uuid);
  doc?.sheet?.render(true);
}

/** Native Item drop data; SF2e reads the top-level value when applying a valued condition. */
export function conditionDragData(uuid, value) {
  const n = Number(value);
  return { type: "Item", uuid, ...(Number.isInteger(n) && n > 0 ? { value: n } : {}) };
}
