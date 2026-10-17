import { MODULE_ID } from "../constants.mjs";
import { log } from "../utils/logging.mjs";
import { readStarship } from "../starship/starship-state.mjs";
import { moduleSetting } from "../utils/foundry.mjs";

/**
 * Initiative integration. The native Combat Tracker is never replaced:
 *  - player starships get NO combatant (they act through the crew's own turns) ...
 *  - ... except while compromised: the ship then enters initiative directly before the turn in which it was reduced
 *    to 0 HP and wins ties (rules: Tech Core, Compromised) so its hull integrity check happens first.
 *  - enemy ships (npc actors) and complex hazards are ordinary combatants that roll native initiative.
 */
const SYSTEM = "sf2e";

function priorityFlag(combat, initiative) {
  // lower number acts first on ties (system convention); beat the lowest existing priority at that count
  const same = combat.combatants.filter((c) => c.initiative === initiative);
  const existing = same.map((c) => c.flags?.[SYSTEM]?.overridePriority?.[initiative] ?? c.actor?.initiative?.tiebreakPriority ?? 3);
  return Math.min(3, ...existing) - 1;
}

export const Initiative = {
  compromisedEntries(combat, shipUuid = null) {
    return combat.combatants.filter(
      (c) => c.flags?.[MODULE_ID]?.compromisedEntry && (!shipUuid || c.flags[MODULE_ID].shipUuid === shipUuid)
    );
  },

  /** Insert the compromised ship directly before the current turn. */
  async enterCompromised(combat, shipActor) {
    if (!combat || !game.user.isGM) return null;
    if (this.compromisedEntries(combat, shipActor.uuid).length) return null;
    const current = combat.combatant;
    const initiative = current?.initiative ?? 0;
    const priority = priorityFlag(combat, initiative);
    let doc;
    try {
      [doc] = await combat.createEmbeddedDocuments("Combatant", [
        {
          actorId: shipActor.id,
          sceneId: combat.scene?.id ?? null,
          initiative,
          hidden: false,
          flags: {
            [MODULE_ID]: { compromisedEntry: true, shipUuid: shipActor.uuid },
            [SYSTEM]: { overridePriority: { [initiative]: priority } }
          }
        }
      ]);
    } catch (err) {
      log.error("could not add the compromised ship to initiative", err);
      await ChatMessage.create({
        content: `<p><strong>${shipActor.name}</strong>: ${game.i18n.localize("SF2eTSC.errors.compromisedManual")}</p>`,
        whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id)
      });
      return null;
    }
    // Inserting a combatant that sorts before the current one shifts turn indices; keep the current combatant
    // active (the compromised ship acts first from the next round on). SF2e does the same in setMultipleInitiatives.
    if (current) {
      const idx = combat.turns.findIndex((c) => c.id === current.id);
      if (idx >= 0 && idx !== combat.turn) await combat.update({ turn: idx });
    }
    log.info(`${shipActor.name} entered initiative (compromised) at ${initiative}`);
    return doc;
  },

  async leaveCompromised(combat, shipActor) {
    const ids = this.compromisedEntries(combat, shipActor.uuid).map((c) => c.id);
    if (ids.length) await combat.deleteEmbeddedDocuments("Combatant", ids);
  },

  /** Optional (default off): a regular combatant for a player ship, before or after the crew. */
  async addPlayerShipCombatant(combat, shipActor, mode = moduleSetting("playerShipInitiative")) {
    if (mode === "disabled") return null;
    const pcs = combat.combatants.filter((c) => c.actor?.type === "character" && c.initiative != null);
    const values = pcs.map((c) => c.initiative);
    const init =
      mode === "beforeCrew"
        ? values.length
          ? Math.max(...values) + 0.5
          : 20
        : mode === "afterCrew"
          ? values.length
            ? Math.min(...values) - 0.5
            : 0
          : null;
    const [doc] = await combat.createEmbeddedDocuments("Combatant", [
      { actorId: shipActor.id, initiative: init, flags: { [MODULE_ID]: { playerShip: true, shipUuid: shipActor.uuid } } }
    ]);
    return doc;
  },

  /** Combatants that represent a starship / hazard (for tracker decoration). */
  kindOf(combatant) {
    const actor = combatant.actor;
    if (combatant.flags?.[MODULE_ID]?.compromisedEntry) return "compromised";
    if (actor?.flags?.[MODULE_ID]?.starship?.isStarship) return "ship";
    if (actor?.flags?.[MODULE_ID]?.starshipHazard?.isStarshipHazard) return "hazard";
    return null;
  },
  roleOf: (actor) => readStarship(actor).role
};
