/**
 * NPC starship actions that are not in the shared action catalogue are rebuilt *on the GM* from the ship's own
 * statblock data (never from client-supplied definitions):
 *   - "npc-strike:<slug>"  → an automated Strike (attack roll vs AC, damage through the starship damage pipeline)
 *   - "inline:<slug>"      → a manual action card with the statblock text (GM applies the effect)
 * Pure module (no Foundry globals) so it can be unit-tested.
 */
import { normalizeNpcStrike, stationActionName } from "./npc-rows.mjs";
export const slugifyName = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export const COST_FROM = {
  "one-action": 1,
  "two-actions": 2,
  "three-actions": 3,
  reaction: "reaction",
  "free-action": "free",
  passive: null,
  1: 1,
  2: 2,
  3: 3,
  free: "free"
};

export function npcStrikeAction(strike) {
  return {
    id: `npc-strike:${slugifyName(strike.name)}`,
    slug: slugifyName(strike.name),
    name: strike.name,
    station: "npc",
    npcOnly: true,
    cost: 1,
    traits: ["attack", ...(strike.traits ?? [])],
    text: `${strike.kind === "melee" ? "Melee" : "Ranged"} +${strike.attack}, ${strike.damage}`,
    targeting: { type: "starship", range: "weapon" },
    builtin: "npc-strike",
    strike,
    inline: true
  };
}

export function npcActionDescription(action, translate = (text) => text) {
  let text = translate(action.text ?? "");
  const family = action.familyText ?? "";
  const saves = [
    ...new Set(
      [...family.matchAll(/\b(basic\s+)?(Fortitude|Reflex|Will) save\b/gi)].map((m) => `${m[2].toLowerCase()}${m[1] ? "|basic" : ""}`)
    )
  ];
  const dcs = [...new Set([...(action.text ?? "").matchAll(/\bDC\s+(\d+)\b/g)].map((m) => m[1]))];
  if (
    saves.length === 1 &&
    dcs.length === 1 &&
    !text.includes("@Check[") &&
    !/\b(?:Fortitude|Reflex|Will) save\b/i.test(action.text ?? "")
  ) {
    const [save, basic] = saves[0].split("|");
    text = text.replace(
      new RegExp(`(?:DC|КС)\\s+${dcs[0]}\\b`),
      (label) => `@Check[${save}|dc:${dcs[0]}${basic ? "|basic" : ""}]{${label}}`
    );
  }
  const detail = action.detailText && action.detailText !== action.text ? translate(action.detailText) : "";
  return [text, detail, translate(family)].filter(Boolean).join("\n\n");
}

export function npcInlineAction(name, own, station = null) {
  const cost = own ? COST_FROM[own.cost] : 1;
  return {
    id: `inline:${slugifyName(name)}`,
    slug: slugifyName(name),
    name,
    inline: true,
    station: station?.type ?? "npc",
    npcOnly: true,
    cost: cost === undefined ? 1 : cost,
    passive: own?.cost === "passive",
    traits: own?.traits ?? [],
    text: own?.text ?? name,
    familyText: own?.familyText ?? "",
    frequency: parseFrequency(own?.text),
    effects: [{ type: "manual", text: own?.text ?? name }]
  };
}

function parseFrequency(text) {
  const m = /Frequency (once|twice) per (turn|round|day|hour|minute)/i.exec(String(text ?? ""));
  return m ? { uses: m[1].toLowerCase() === "once" ? 1 : 2, per: m[2].toLowerCase() } : null;
}

/** Resolve "npc-strike:*" / "inline:*" ids against starship flag data ({strikes, npcActions, stations}). */
export function buildNpcAction(data, actionId) {
  const id = String(actionId ?? "");
  if (id.startsWith("npc-strike:")) {
    const slug = id.slice(11);
    const s = (Array.isArray(data.strikes) ? data.strikes : []).find((x) => slugifyName(x?.name) === slug);
    if (!s) return null;
    const r = normalizeNpcStrike(s);
    return r.fatal ? null : npcStrikeAction(r.strike);
  }
  if (id.startsWith("inline:")) {
    const slug = id.slice(7);
    const own = (Array.isArray(data.npcActions) ? data.npcActions : []).find((a) => slugifyName(a?.name) === slug);
    const st =
      (Array.isArray(data.stations) ? data.stations : []).find((s) =>
        (s?.actions ?? []).some((n) => slugifyName(stationActionName(n)) === slug)
      ) ?? null;
    const name = own?.name ?? (st ? stationActionName(st.actions.find((n) => slugifyName(stationActionName(n)) === slug)) : null);
    return name ? npcInlineAction(name, own, st) : null;
  }
  return null;
}
