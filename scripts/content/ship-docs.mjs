import { MODULE_ID, DATA_VERSION, STARSHIP_TAG } from "../constants.mjs";
import { stationGradeForLevel } from "../engine/advancement.mjs";
import { STARSHIP_IMMUNITIES } from "../engine/validation.mjs";
import { linkInline } from "./inline-links.mjs";
import { schemaStamp } from "./action-docs.mjs";

export const ICONS = {
  player: `modules/${MODULE_ID}/assets/icons/starship.svg`,
  npc: `modules/${MODULE_ID}/assets/icons/npc-starship.svg`,
  hazard: `modules/${MODULE_ID}/assets/icons/hazard.svg`
};
/** Image paths that do not exist in Foundry v14 (written by 0.1/0.2) and are replaced by the module icons. */
export const LEGACY_ICONS = ["icons/svg/ship.svg"];

/** Pure builders (no Foundry globals) that turn content JSON into Actor creation data. Shared by the importer and the pack builder. */
const SIZE = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };
const STATION_NAME = {
  pilot: "Pilot’s Console",
  generator: "Generator",
  gunnery: "Gunnery",
  scanners: "Scanners",
  "magic-conduit": "Magic Conduit",
  "drone-console": "Drone Console",
  custom: "Custom"
};
const slug = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const esc0 = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const esc = (s) => linkInline(esc0(s));
const SYSTEM_SKILLS = new Set([
  "acrobatics",
  "arcana",
  "athletics",
  "crafting",
  "deception",
  "diplomacy",
  "intimidation",
  "medicine",
  "nature",
  "occultism",
  "performance",
  "religion",
  "society",
  "stealth",
  "survival",
  "thievery",
  "computers",
  "piloting"
]);

/**
 * Optional localisation of the generated actor documents (actor name + HTML notes; rules data in flags stays English).
 * opts.tr(text) translates a content string, opts.label(key, data) returns a localized label. Defaults: English.
 */
const EN_LABELS = {
  melee: "Melee",
  ranged: "Ranged",
  special: "Special",
  immunities: "Immunities",
  resistances: "Resistances",
  weaknesses: "Weaknesses",
  battleStations: "Battle stations",
  starshipLevel: "Starship {level}",
  sourcePage: "Tech Core p.{page}",
  trigger: "Trigger",
  requirements: "Requirements",
  effect: "Effect",
  critSuccess: "Critical Success",
  success: "Success",
  failure: "Failure",
  critFailure: "Critical Failure"
};
function docI18n(opts = {}) {
  const tr = typeof opts.tr === "function" ? opts.tr : (x) => x;
  const label = (k, data = {}) =>
    (typeof opts.label === "function" ? opts.label(k, data) : null) ?? EN_LABELS[k].replace(/\{(\w+)\}/g, (m, x) => data[x] ?? m);
  const trList = (list) => (list ?? []).map((x) => (typeof opts.trait === "function" ? opts.trait(x) : x));
  return { tr, label, trList };
}

/** Station quality from the starship advancement table; custom stations and level < 1 stay commercial. */
const gradeAt = (type, level) => (type === "custom" ? "commercial" : stationGradeForLevel(type, Number(level) || 1));

export function stationsFromContent(ship) {
  const out = [];
  const count = {};
  for (const st of ship.stations ?? []) {
    const type = st.type;
    count[type] = (count[type] ?? 0) + 1;
    out.push({
      id: `${type}-${count[type]}`,
      type,
      name: st.label ?? STATION_NAME[type] ?? type,
      grade: gradeAt(type, ship.level),
      helmedBy: null,
      malfunctioning: false,
      location: null,
      upgrades: [],
      actions: (st.actions ?? []).map((a) => a.name),
      uniqueActions: (st.actions ?? []).filter((a) => a.unique).map((a) => a.name),
      sharedActions: (st.actions ?? []).filter((a) => a.shared).map((a) => a.name)
    });
  }
  return out;
}

/** Hull/shield/stat block for the starship flag from a statblock entry. */
export function starshipFlagFromContent(ship, role = "npc") {
  return {
    dataVersion: DATA_VERSION,
    isStarship: true,
    role,
    sourceId: ship.id,
    level: ship.level,
    frame: null,
    size: ship.size ?? "medium",
    sensorRange: ship.sensorRange ?? 4,
    speed: ship.speed ?? 3,
    ac: ship.ac ?? 10 + ship.level,
    fort: ship.fort ?? 0,
    reflex: ship.ref ?? 0,
    will: ship.will ?? 0,
    perception: ship.perception ?? 0,
    compromised: 0,
    wrecked: 0,
    inoperable: false,
    offKilter: false,
    destroyed: false,
    heading: "left",
    fortify: ship.fortify ?? 0,
    immunities: [...STARSHIP_IMMUNITIES],
    resistances: {},
    weaknesses: {},
    traits: ship.traits ?? [],
    skills: ship.skills ?? {},
    sp: { value: ship.sp ?? 0, max: ship.sp ?? 0 },
    stations: stationsFromContent(ship),
    crew: [],
    weapons: [],
    upgrades: [],
    expansionBays: [],
    effects: [],
    knownStations: [],
    frequencyUsed: {},
    drones: [],
    strikes: ship.strikes ?? [],
    npcActions: ship.actions ?? [],
    faction: ship.faction ?? null,
    notes: "",
    gmNotes: "",
    source: ship.source ?? null,
    needsReview: !!ship.needsReview
  };
}

/** "Name (Lv 5)" — the level helps the GM pick NPC starships in compendiums, the sidebar and the start wizard. */
export function shipNameWithLevel(name, level, short = "Lv") {
  const base = String(name ?? "").replace(/\s*\((?:Lv|ур\.)\s*-?\d+\)\s*$/i, "");
  return Number.isFinite(Number(level)) ? `${base} (${short || "Lv"} ${Number(level)})` : base;
}

export function buildShipActorData(ship, { allowedTraits = null, role = "npc", i18n = null, levelInName = false } = {}) {
  const { tr, label, trList } = docI18n(i18n ?? {});
  const flag = starshipFlagFromContent(ship, role);
  const traits = [...new Set(["starship", ...(ship.traits ?? []).map((t) => String(t).toLowerCase())])].filter(
    (t) => !allowedTraits || allowedTraits.includes(t)
  );
  const skills = {};
  for (const [k, v] of Object.entries(ship.skills ?? {})) {
    const s = slug(k);
    if (SYSTEM_SKILLS.has(s)) skills[s] = { base: v };
  }
  const strikes = (ship.strikes ?? [])
    .map(
      (s) =>
        `<li><strong>${esc(tr(s.name))}</strong> ${label(s.kind === "melee" ? "melee" : "ranged")} +${s.attack}${s.traits?.length ? ` (${esc(trList(s.traits).join(", "))})` : ""}, ${esc(i18n?.damage ? i18n.damage(s.damage) : s.damage)}</li>`
    )
    .join("");
  const actions = (ship.actions ?? [])
    .map(
      (a) =>
        `<p><strong>${esc(tr(a.name))}</strong> [${esc(i18n?.cost ? i18n.cost(a.cost) : a.cost)}] ${a.traits?.length ? `(${esc(trList(a.traits).join(", "))}) ` : ""}${esc(tr(a.text))}</p>`
    )
    .join("");
  const stations = (ship.stations ?? [])
    .map((s) => `${tr(s.label ?? STATION_NAME[s.type] ?? s.type)}: ${s.actions.map((a) => tr(a.name) + (a.shared ? "*" : "")).join(", ")}`)
    .join("; ");
  const review = ship.needsReview && ship.review?.length ? `<p><em>⚠ ${esc(ship.review.join("; "))}</em></p>` : "";
  const notes =
    `<p><em>${esc(tr(ship.faction ?? ""))} — ${esc(label("sourcePage", { page: ship.source?.page ?? "?" }))}</em></p>${review}` +
    `<p>${ship.immunities ? `<strong>${label("immunities")}</strong> ${esc(tr(ship.immunities))}` : ""}${ship.resistances ? `; <strong>${label("resistances")}</strong> ${esc(tr(ship.resistances))}` : ""}${ship.weaknesses ? `; <strong>${label("weaknesses")}</strong> ${esc(tr(ship.weaknesses))}` : ""}${ship.hpNote ? `; ${esc(tr(ship.hpNote))}` : ""}</p>` +
    `<p><strong>${label("battleStations")}</strong> ${esc(stations)}</p>${strikes ? `<ul>${strikes}</ul>` : ""}${actions}`;
  return {
    name: levelInName ? shipNameWithLevel(tr(ship.name), ship.level, i18n?.levelShort) : tr(ship.name),
    type: "npc",
    img: ICONS.npc,
    system: {
      details: { level: { value: ship.level }, publicNotes: notes, blurb: label("starshipLevel", { level: ship.level }) },
      attributes: {
        hp: { value: ship.hp, max: ship.hp, details: ship.sp ? `SP ${ship.sp}` : "" },
        ac: { value: ship.ac ?? 10 + ship.level },
        allSaves: { value: "" }
      },
      saves: { fortitude: { value: ship.fort ?? 0 }, reflex: { value: ship.ref ?? 0 }, will: { value: ship.will ?? 0 } },
      perception: { mod: ship.perception ?? 0 },
      abilities: ship.abilities ? Object.fromEntries(Object.entries(ship.abilities).map(([k, v]) => [k, { mod: v }])) : undefined,
      initiative: { statistic: "perception" },
      skills,
      traits: { value: traits, rarity: ship.rarity ?? "common", size: { value: SIZE[ship.size] ?? "huge" } },
      _migration: schemaStamp()
    },
    prototypeToken: { name: tr(ship.name), actorLink: false, disposition: -1, texture: { src: ICONS.npc } },
    flags: {
      [MODULE_ID]: { starship: flag, content: { id: ship.id, kind: "starship" } },
      core: { sheetClass: `${MODULE_ID}.NPCStarshipSheet` }
    }
  };
}

/**
 * hazard abilities (actions, reactions, free actions, passives) and strikes are embedded sf2e items, so the
 * hazard sheet lists them in its Actions block (like the system's own hazards) instead of the description.
 */
const ABILITY_MARKS = [
  ["critSuccess", "Critical Success|Критический успех"],
  ["critFailure", "Critical Failure|Критический провал"],
  ["success", "Success|Успех"],
  ["failure", "Failure|Провал"],
  ["trigger", "Trigger|Триггер"],
  ["requirements", "Requirements|Требования"],
  ["effect", "Effect|Эффект"]
];
const MARK_RE = new RegExp(`(^|[.;:!?)]\\s*)(${ABILITY_MARKS.map(([, w]) => w).join("|")}):?\\s+`, "gu");
const DEGREES = new Set(["critSuccess", "success", "failure", "critFailure"]);
/** Plain ability text -> sf2e item HTML: <strong>Trigger</strong> / <hr /> / <strong>Effect</strong> / degrees of success. */
export function hazardAbilityHTML(text, label = (k) => EN_LABELS[k]) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  const parts = [];
  const re = new RegExp(MARK_RE.source, "gu");
  let last = 0,
    cur = null,
    m;
  while ((m = re.exec(s))) {
    const at = m.index + m[1].length;
    parts.push({ key: cur, text: s.slice(last, at) });
    cur = ABILITY_MARKS.find(([, w]) => new RegExp(`^(?:${w})$`, "u").test(m[2]))[0];
    last = re.lastIndex;
  }
  parts.push({ key: cur, text: s.slice(last) });
  let html = "",
    hadHead = false,
    hadDegree = false;
  for (const p of parts) {
    const t = p.text.replace(/^[\s;]+|[\s;]+$/g, "");
    if (!t) continue;
    const body = esc(t);
    if (!p.key) {
      html += `<p>${body}</p>`;
      continue;
    }
    if (p.key === "trigger" || p.key === "requirements") hadHead = true;
    if (p.key === "effect" && hadHead) html += "<hr />";
    if (DEGREES.has(p.key) && !hadDegree) {
      html += "<hr />";
      hadDegree = true;
    }
    html += `<p><strong>${esc0(label(p.key))}</strong> ${body}</p>`;
  }
  return html;
}
const ACTION_ICON = { 1: "OneAction", 2: "TwoActions", 3: "ThreeActions", free: "FreeAction", reaction: "Reaction", passive: "Passive" };
export function hazardCost(cost) {
  const c = String(cost ?? "").toLowerCase();
  if (c === "reaction") return { actionType: "reaction", actions: null };
  if (c === "free-action" || c === "free") return { actionType: "free", actions: null };
  if (c === "passive" || c === "") return { actionType: "passive", actions: null };
  const n = { "one-action": 1, "two-actions": 2, "three-actions": 3 }[c] ?? Number(c);
  return { actionType: "action", actions: Number.isFinite(n) ? Math.min(3, Math.max(1, Math.round(n))) : 1 };
}
/** "2d8+7 piercing plus chain wrap" -> { rolls: [{damage, damageType, category}], effects: ["chain wrap"] } */
export function parseStrikeDamage(text) {
  const rolls = [],
    effects = [];
  // "(range increment 4 zones), 1d8+12 fire (no multiple attack penalty)": parenthesised notes go to the description
  const rest = String(text ?? "")
    .replace(/\(([^)]*)\)/g, (m, x) => {
      if (x.trim()) effects.push(x.trim());
      return "";
    })
    .replace(/^[\s,;]+|[\s,;]+$/g, "");
  for (const part of rest.split(/\s+plus\s+/i)) {
    const m = part.trim().match(/^(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s+(persistent\s+)?([a-z]+)(?:\s+damage)?$/i);
    if (m) rolls.push({ damage: m[1].replace(/\s+/g, ""), damageType: m[3].toLowerCase(), category: m[2] ? "persistent" : null });
    else if (part.trim()) effects.push(part.trim());
  }
  return { rolls, effects };
}
const traitSlugs = (list) => [
  ...new Set((list ?? []).map((t) => String(t).toLowerCase().trim()).filter((t) => /^[a-z][a-z0-9-]*$/.test(t)))
];
export function buildHazardItems(h, { i18n = null, systemId = "sf2e" } = {}) {
  const { tr, label, trList } = docI18n(i18n ?? {});
  const pub = hazardPublication(h),
    stamp = schemaStamp();
  const flag = (kind, index) => ({ [MODULE_ID]: { hazardItem: { contentId: h.id, kind, index } } });
  const actions = (h.actions ?? []).map((a, i) => {
    const c = hazardCost(a.cost);
    return {
      name: tr(a.name),
      type: "action",
      img: `systems/${systemId}/icons/actions/${ACTION_ICON[c.actionType === "action" ? c.actions : c.actionType]}.webp`,
      system: {
        description: { value: hazardAbilityHTML(tr(a.text), label), gm: "" },
        actionType: { value: c.actionType },
        actions: { value: c.actions },
        category: null,
        traits: { value: [...new Set([STARSHIP_TAG, ...traitSlugs(a.traits)])], rarity: "common", otherTags: [STARSHIP_TAG] },
        publication: pub,
        rules: [],
        slug: slug(a.name),
        _migration: stamp
      },
      flags: flag("action", i)
    };
  });
  const known = new Set(actions.map((x) => x.system.slug));
  const strikes = (h.strikes ?? []).map((s, i) => {
    const { rolls, effects } = parseStrikeDamage(s.damage);
    const linked = effects.filter((e) => known.has(slug(e))).map(slug);
    const notes = [...(s.traits ?? []).filter((t) => !traitSlugs([t]).length), ...effects.filter((e) => !known.has(slug(e)))];
    const damageRolls = Object.fromEntries(rolls.map((r, j) => [`${slug(s.name) || "strike"}-${j}`, r]));
    const name = tr(s.name);
    const display = name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
    const desc = `<p><strong>${esc0(label(s.kind === "melee" ? "melee" : "ranged"))}</strong>${notes.length ? ` ${esc(trList(notes).join(", "))}` : ""}</p>`;
    return {
      name: display,
      type: "melee",
      img: "icons/svg/sword.svg",
      system: {
        description: { value: desc, gm: "" },
        bonus: { value: Number(s.attack) || 0 },
        damageRolls,
        attackEffects: { value: linked },
        traits: { value: [...new Set([STARSHIP_TAG, ...traitSlugs(s.traits)])], rarity: "common", otherTags: [STARSHIP_TAG] },
        publication: pub,
        rules: [],
        slug: slug(s.name),
        _migration: stamp
      },
      flags: flag("strike", i)
    };
  });
  return [...strikes, ...actions];
}

/** publication block (the sf2e compendium browser skips hazards without it). */
export function hazardPublication(h) {
  return { title: h.source?.book ?? "Starfinder Tech Core", authors: "", license: "ORC", remaster: true };
}

export function buildHazardActorData(h, { i18n = null, levelInName = false } = {}) {
  const { tr, label } = docI18n(i18n ?? {});
  const stealthValue = h.stealthDC != null ? h.stealthDC - 10 : (h.stealthBonus ?? 0);
  const text = (s) => (s ? `<p>${esc(tr(s))}</p>` : "");
  // actions, reactions, passives and strikes are embedded items (see buildHazardItems), not description text.
  const acts = h.special ? `<p><strong>${label("special")}</strong> ${esc(tr(h.special))}</p>` : "";
  const effectText = h.actions?.[0]?.text ?? "";
  return {
    name: levelInName ? shipNameWithLevel(tr(h.name), h.level, i18n?.levelShort) : tr(h.name),
    type: "hazard",
    img: ICONS.hazard,
    system: {
      details: {
        isComplex: !!h.isComplex,
        level: { value: h.level },
        publication: hazardPublication(h),
        description: text(h.description) + acts,
        disable: text(h.disable),
        routine: h.routine ? `<p>(${esc(i18n?.cost ? i18n.cost(h.routine.cost) : h.routine.cost)}) ${esc(tr(h.routine.text))}</p>` : "",
        reset: text(h.reset)
      },
      attributes: {
        hp: { value: h.hp ?? 0, max: h.hp ?? 0, brokenThreshold: h.bt ?? 0 },
        ac: { value: h.ac ?? 0 },
        hardness: h.hardness ?? 0,
        stealth: { value: stealthValue, details: h.stealthRank ?? "" },
        hasHealth: h.hp != null
      },
      traits: { value: [...new Set((h.traits ?? []).map((t) => String(t).toLowerCase()))], rarity: h.rarity ?? "common" },
      saves: { fortitude: { value: h.fort ?? 0 }, reflex: { value: h.ref ?? 0 }, will: { value: h.will ?? 0 } },
      _migration: schemaStamp()
    },
    prototypeToken: { name: tr(h.name), actorLink: false, disposition: -1, texture: { src: ICONS.hazard } },
    items: buildHazardItems(h, { i18n }),
    flags: {
      [MODULE_ID]: {
        starshipHazard: {
          isStarshipHazard: true,
          id: h.id,
          isComplex: !!h.isComplex,
          level: h.level,
          stealthDC: h.stealthDC ?? null,
          routine: h.routine ?? null,
          reset: h.reset ?? null,
          effectText,
          actions: h.actions ?? [],
          placement: "sensor",
          traits: h.traits ?? [],
          needsReview: !!h.needsReview,
          source: h.source
        },
        content: { id: h.id, kind: "hazard" }
      }
    }
  };
}

/** Player starship (vehicle actor) from a frame + level. */
export function buildPlayerShipData({ name, frame, level = 1, stations = null, crewSize = 4, i18n = null }) {
  const { tr } = docI18n(i18n ?? {});
  const row = frame.table.find((r) => r.level === level) ?? frame.table[0];
  const defaultStations = (stations ?? frame.defaultStations ?? []).map((s, i) => ({
    id: `${s.type}-${i + 1}`,
    type: s.type,
    name: STATION_NAME[s.type] ?? s.type,
    grade: s.grade ?? gradeAt(s.type, level),
    helmedBy: null,
    malfunctioning: false,
    location: null,
    upgrades: s.upgrade ? [s.upgrade] : [],
    actions: []
  }));
  const flag = {
    dataVersion: DATA_VERSION,
    isStarship: true,
    role: "player",
    level,
    frame: frame.id,
    size: frame.size,
    sensorRange: frame.sensorRange,
    speed: row.speed,
    ac: row.ac,
    fort: row.fort,
    reflex: row.ref,
    will: row.will,
    perception: 0,
    compromised: 0,
    wrecked: 0,
    inoperable: false,
    offKilter: false,
    destroyed: false,
    heading: "right",
    sp: { value: row.sp, max: row.sp },
    immunities: [...STARSHIP_IMMUNITIES],
    resistances: {},
    weaknesses: {},
    traits: frame.traits ?? ["tech"],
    stations: defaultStations,
    crew: [],
    weapons: [],
    upgrades: [],
    expansionBays: Array.from({ length: frame.expansionBays ?? 4 }, (_, i) => ({ id: `bay-${i + 1}`, name: null })),
    effects: [],
    knownStations: [],
    frequencyUsed: {},
    drones: [],
    notes: "",
    gmNotes: "",
    source: frame.source ?? null,
    plannedCrew: crewSize
  };
  return {
    name,
    type: "vehicle",
    img: ICONS.player,
    system: {
      details: { level: { value: level }, description: `<p>${esc(tr(frame.description))}</p>` },
      attributes: { hp: { value: row.hp, max: row.hp }, ac: { value: row.ac }, hardness: 0 },
      saves: { fortitude: { value: row.fort } },
      _migration: schemaStamp()
    },
    prototypeToken: { name, actorLink: true, disposition: 1, texture: { src: ICONS.player } },
    flags: { [MODULE_ID]: { starship: flag }, core: { sheetClass: `${MODULE_ID}.StarshipSheet` } }
  };
}
export { STATION_NAME, SIZE };
