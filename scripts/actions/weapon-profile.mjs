import { parseAreaTrait } from "../engine/areas.mjs";

const PLASMA = /\bplasma\b/i;
const SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);
const traitsOf = (weapon) => (Array.isArray(weapon?.traits) ? weapon.traits.map((trait) => String(trait)) : []);
const saveDC = (value) => (Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null);

export function weaponProfileOf(weapon) {
  const fields = [weapon?.group, weapon?.type, weapon?.id, weapon?.weaponRef, weapon?.name, ...traitsOf(weapon)];
  const plasma = fields.some((field) => typeof field === "string" && PLASMA.test(field));
  const traits = traitsOf(weapon);
  const areaTrait = traits.map((trait) => parseAreaTrait(trait, null)).find(Boolean) ?? null;
  const volley = traits.map((trait) => /\bvolley\s+(\d+)?/i.exec(trait)).find(Boolean) ?? null;
  const shape = areaTrait
    ? { type: areaTrait.type, value: areaTrait.value }
    : volley
      ? { type: "volley", value: volley[1] ? Number(volley[1]) : null }
      : { type: "single", value: null };
  const explicit = weapon?.save ?? weapon?.savingThrow ?? null;
  const explicitType = String(explicit?.type ?? "").toLowerCase();
  const hasExplicitDC = explicit?.dc != null && explicit.dc !== "";
  const explicitDC = hasExplicitDC ? saveDC(Number(explicit.dc)) : null;
  let save = null;
  if (areaTrait)
    save = {
      type: "reflex",
      basic: true,
      dc: explicitDC,
      source: explicitDC == null ? "crew" : "weapon"
    };
  else if (SAVE_TYPES.has(explicitType) && (!hasExplicitDC || explicitDC != null))
    save = {
      type: explicitType,
      basic: explicit?.basic === true,
      dc: explicitDC,
      source: explicitDC == null ? "crew" : "weapon"
    };
  return { plasma, area: !!areaTrait, shape, save };
}
