import { MODULE_ID, FLAGS } from "../constants.mjs";
/** Stealth DC of a starship hazard: stored flag DC, else 10 + the hazard's Stealth modifier; null = no stealth. */
export function hazardStealthDC(actor) {
  const flagDC = Number(actor?.flags?.[MODULE_ID]?.[FLAGS.HAZARD]?.stealthDC);
  if (Number.isFinite(flagDC) && flagDC > 0) return flagDC;
  const mod = actor?.system?.attributes?.stealth?.value;
  return mod == null || mod === "" || !Number.isFinite(Number(mod)) ? null : 10 + Number(mod);
}
