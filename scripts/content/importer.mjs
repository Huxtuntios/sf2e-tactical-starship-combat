import { MODULE_ID } from "../constants.mjs";
import { Content } from "./loader.mjs";
import { buildShipActorData, buildHazardActorData, buildPlayerShipData } from "./ship-docs.mjs";
import { T } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";
import { ct } from "./content-i18n.mjs";
import { traitLabel, damageText } from "../utils/labels.mjs";
import { planStarshipUpdate, planHazardUpdate, stripLevelSuffix } from "./ship-update.mjs";
import { ICONS } from "./ship-docs.mjs";

/** Actor documents are written in the importing GM's language (rules data in flags stays English). */
export function docI18nOptions() {
  return {
    levelShort: game.i18n.has("SF2eTSC.ui.levelShort") ? T("SF2eTSC.ui.levelShort") : "Lv",
    tr: ct,
    trait: traitLabel,
    damage: damageText,
    cost: (c) => (game.i18n.has(`SF2eTSC.edit.cost.${c}`) ? T(`SF2eTSC.edit.cost.${c}`) : c),
    label: (k, data) => (game.i18n.has(`SF2eTSC.docs.${k}`) ? game.i18n.format(`SF2eTSC.docs.${k}`, data) : null)
  };
}

/** Content Importer: structured JSON -> Foundry documents (also used by the compendium-less "import to world" path). */
const traitList = () => Object.keys(CONFIG.PF2E?.creatureTraits ?? {});
const folderFor = async (name, type = "Actor") => {
  let f = game.folders.find((x) => x.type === type && x.name === name && x.flags?.[MODULE_ID]);
  if (!f) f = await Folder.create({ name, type, flags: { [MODULE_ID]: { auto: true } } });
  return f;
};

export const Importer = {
  async createEnemyShip(contentId, { folder = null, world = true } = {}) {
    const ship = Content.ships.find((s) => s.id === contentId);
    if (!ship) throw new Error(T("SF2eTSC.errors.unknownContent", { id: contentId }));
    const data = buildShipActorData(ship, { allowedTraits: traitList(), i18n: docI18nOptions(), levelInName: true });
    if (folder) data.folder = folder.id;
    return world ? Actor.create(data) : data;
  },
  async createHazard(contentId, { folder = null } = {}) {
    const hz = Content.hazards.find((h) => h.id === contentId);
    if (!hz) throw new Error(T("SF2eTSC.errors.unknownContent", { id: contentId }));
    const data = buildHazardActorData(hz, { i18n: docI18nOptions(), levelInName: true });
    if (folder) data.folder = folder.id;
    return Actor.create(data);
  },
  async createPlayerShip({ name, frameId, level }) {
    const frame = Content.frames.get(frameId);
    if (!frame) throw new Error(T("SF2eTSC.errors.unknownContent", { id: frameId }));
    return Actor.create(buildPlayerShipData({ name, frame, level, i18n: docI18nOptions() }));
  },
  /** Import everything (or a subset) into the world, organized in folders by faction. Existing imports are skipped. */
  async importAll({ ships = true, hazards = true } = {}) {
    const existing = new Set(game.actors.map((a) => a.flags?.[MODULE_ID]?.content?.id).filter(Boolean));
    let n = 0;
    if (ships) {
      const root = await folderFor(T("SF2eTSC.ui.starships"));
      const docs = [];
      for (const s of Content.ships) {
        if (existing.has(s.id)) continue;
        const sub = await (async () => {
          let f = game.folders.find((x) => x.type === "Actor" && x.name === ct(s.faction) && x.folder?.id === root.id);
          if (!f) f = await Folder.create({ name: ct(s.faction), type: "Actor", folder: root.id });
          return f;
        })();
        const d = buildShipActorData(s, { allowedTraits: traitList(), i18n: docI18nOptions(), levelInName: true });
        d.folder = sub.id;
        docs.push(d);
      }
      if (docs.length) {
        await Actor.createDocuments(docs);
        n += docs.length;
      }
    }
    if (hazards) {
      const root = await folderFor(T("SF2eTSC.ui.starshipHazards"));
      const docs = Content.hazards
        .filter((h) => !existing.has(h.id))
        .map((h) => ({ ...buildHazardActorData(h, { i18n: docI18nOptions(), levelInName: true }), folder: root.id }));
      if (docs.length) {
        await Actor.createDocuments(docs);
        n += docs.length;
      }
    }
    log.info(`imported ${n} documents`);
    return n;
  },
  /** Content entry an imported actor came from (content flag, starship sourceId, then name without level). */
  contentFor(actor) {
    const f = actor.flags?.[MODULE_ID] ?? {};
    const id = f.content?.id ?? f.starship?.sourceId ?? null;
    const isHazard = f.content?.kind === "hazard" || (!f.starship && actor.type === "hazard");
    const list = isHazard ? Content.hazards : Content.ships;
    let entry = id ? list.find((x) => x.id === id) : null;
    if (!entry) {
      const base = stripLevelSuffix(actor.name).toLowerCase();
      entry = list.find((x) => x.name.toLowerCase() === base || ct(x.name).toLowerCase() === base) ?? null;
    }
    return entry ? { entry, kind: isHazard ? "hazard" : "starship" } : null;
  },
  /** GM: refresh an imported NPC starship or hazard from the module content, keeping crew, damage and map position. */
  async updateFromContent(actor) {
    if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const found = this.contentFor(actor);
    if (!found) throw new Error(T("SF2eTSC.update.notFound", { name: actor.name }));
    const f = actor.flags?.[MODULE_ID] ?? {};
    if (found.kind === "starship") {
      if (f.starship?.role === "player") throw new Error(T("SF2eTSC.update.playerShip"));
      const fresh = buildShipActorData(found.entry, { allowedTraits: traitList(), i18n: docI18nOptions(), levelInName: true });
      const snap = {
        name: actor.name,
        img: actor.img,
        hp: actor.system.attributes.hp,
        flag: f.starship,
        tokenName: actor.prototypeToken?.name
      };
      await actor.update(
        planStarshipUpdate(snap, fresh, {
          moduleId: MODULE_ID,
          contentNames: [found.entry.name, ct(found.entry.name)],
          defaultImg: ICONS.npc
        })
      );
    } else {
      const fresh = buildHazardActorData(found.entry, { i18n: docI18nOptions(), levelInName: true });
      await actor.update(
        planHazardUpdate({ name: actor.name, hp: actor.system.attributes?.hp, flags: f }, fresh, {
          moduleId: MODULE_ID,
          contentNames: [found.entry.name, ct(found.entry.name)]
        })
      );
      // abilities/strikes live in embedded items; replace the module-generated ones (user-added items stay).
      const old = actor.items.filter((i) => i.flags?.[MODULE_ID]?.hazardItem).map((i) => i.id);
      if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
      if (fresh.items?.length) await actor.createEmbeddedDocuments("Item", fresh.items);
    }
    return { name: actor.name, kind: found.kind };
  },
  /** GM: update every imported NPC starship and hazard in the world. Returns {updated, skipped}. */
  async updateAllFromContent() {
    let updated = 0,
      skipped = 0;
    for (const a of game.actors) {
      const f = a.flags?.[MODULE_ID];
      if (!f?.content && !f?.starship) continue;
      if (f.starship?.role === "player" || !this.contentFor(a)) {
        skipped++;
        continue;
      }
      try {
        await this.updateFromContent(a);
        updated++;
      } catch (err) {
        skipped++;
        log.warn(`update ${a.name}: ${err.message}`);
      }
    }
    return { updated, skipped };
  },
  exportShipJSON(actor) {
    return JSON.stringify(
      {
        module: MODULE_ID,
        kind: "starship",
        name: actor.name,
        starship: actor.flags?.[MODULE_ID]?.starship,
        hp: actor.system.attributes.hp
      },
      null,
      2
    );
  },
  async importShipJSON(text, actor) {
    const d = JSON.parse(text);
    if (d.module !== MODULE_ID || !d.starship) throw new Error(T("SF2eTSC.errors.badImport"));
    const { migrate } = await import("../engine/migration.mjs");
    const starship = migrate(d.starship).data;
    await actor.update({
      [`flags.${MODULE_ID}.starship`]: starship,
      "system.attributes.hp.value": d.hp?.value ?? actor.system.attributes.hp.value,
      "system.attributes.hp.max": d.hp?.max ?? actor.system.attributes.hp.max
    });
  }
};
