import { moduleActive } from "../utils/foundry.mjs";
export const AZTEC_ID = "pf2e-aztecs-siege";
export const aztecsActive = () => moduleActive(AZTEC_ID);
/** Aztec's Engines of War marks siege vehicles with flags.pf2e-aztecs-siege.isSiegeWeapon: those stay ordinary vehicles. */
export function isAztecVehicle(actor) {
  return !!actor?.flags?.[AZTEC_ID]?.isSiegeWeapon;
}
export function canConvertToStarship(actor) {
  return !isAztecVehicle(actor);
}
