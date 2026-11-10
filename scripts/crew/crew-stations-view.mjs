import { getTsc } from "../combat/tsc-state.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";
import { can } from "./permissions.mjs";
import { canClaimStation } from "./crew-service.mjs";

/** View model for the current character's station choices on publicly listed combat ships. */
export function crewStationsView(combat, character, user = game.user) {
  const refs = new Set(
    getTsc(combat)
      .objects.filter((object) => object.type === "starship")
      .map((object) => object.actorUuid ?? object.key)
  );
  const ships = [...(game.actors?.contents ?? [])]
    .filter((ship) => refs.has(ship.uuid) && isStarship(ship) && can(user, ship, "viewShip"))
    .map((ship) => {
      const data = readStarship(ship);
      const station = data.stations.find((item) => item.helmedBy === character.uuid) ?? null;
      return {
        uuid: ship.uuid,
        name: ship.name,
        actorUuid: character.uuid,
        currentStation: station ? { id: station.id, name: station.name } : null,
        freeStations: data.stations
          .filter((item) => !item.helmedBy)
          .map(({ id, name, malfunctioning }) => ({ id, name, malfunctioning: !!malfunctioning })),
        canClaim: canClaimStation(user, ship, character)
      };
    })
    .filter((ship) => ship.canClaim || ship.currentStation)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const ship of ships) ship.claimDisabled = !ship.canClaim || !ship.freeStations.length;
  return { actorName: character.name, actorUuid: character.uuid, ships, empty: ships.length === 0 };
}
