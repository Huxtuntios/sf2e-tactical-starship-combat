import { ct } from "../content/content-i18n.mjs";
import { Content } from "../content/loader.mjs";
import { MODULE_ID } from "../constants.mjs";
import { T } from "../utils/foundry.mjs";
import { damageTypeLabel, zonesText } from "../utils/labels.mjs";

/** Категория Item.system.category и ранг персонажа — разные данные; не выводим одно из другого. */
export function weaponSummary(w = {}) {
  const missing = T("SF2eTSC.weaponInfo.notSpecified");
  const ref = w.weaponRef ?? w.flags?.[MODULE_ID]?.packWeapon?.weaponRef ?? w.id;
  const catalog = Content.weapons.get(ref) ?? {};
  const pick = (key) => w[key] ?? catalog[key];
  const sourceType = pick("damageType");
  const type = Array.isArray(sourceType)
    ? sourceType.filter((v) => typeof v === "string" && v)
    : [sourceType].filter((v) => typeof v === "string" && v);
  const explicitRank = pick("requiredProficiency");
  const hasRank = ["untrained", "trained", "expert", "master", "legendary"].includes(explicitRank);
  const rank = hasRank ? T(`SF2eTSC.weaponInfo.ranks.${explicitRank}`) : missing;
  const categoryValue = w.category ?? w.system?.category ?? catalog.category;
  const hasCategory = ["simple", "martial", "advanced"].includes(categoryValue);
  const category = hasCategory ? T(`SF2eTSC.weaponInfo.categories.${categoryValue}`) : missing;
  const die = pick("die"),
    weaponRange = pick("range"),
    itemLevel = pick("itemLevel");
  const damage = typeof die === "string" && die.trim() ? die : missing;
  const damageTypes = type.length ? type.map(damageTypeLabel).join(" / ") : missing;
  const range = Number.isFinite(weaponRange) ? zonesText(`${weaponRange} zones`) : missing;
  const level = Number.isInteger(itemLevel) ? String(itemLevel) : missing;
  const details = [];
  if (hasRank) details.push(`${T("SF2eTSC.weaponInfo.requiredProficiency")}: ${rank}`);
  if (hasCategory) details.push(`${T("SF2eTSC.weaponInfo.category")}: ${category}`);
  const proficiencyText = details.length ? details.join("; ") : `${T("SF2eTSC.weaponInfo.requiredProficiency")}: ${missing}`;
  const displayName = typeof w.name === "string" ? w.name : typeof catalog.name === "string" ? catalog.name : "";
  return {
    id: w.id,
    name: ct(displayName),
    damage,
    damageTypes,
    rank,
    hasRank,
    category,
    hasCategory,
    proficiencyText,
    range,
    level,
    option: `${ct(displayName)} — ${T("SF2eTSC.weaponInfo.damage")}: ${damage}; ${T("SF2eTSC.weaponInfo.damageType")}: ${damageTypes}; ${proficiencyText}; ${T("SF2eTSC.ui.range")}: ${range}; ${T("SF2eTSC.weaponInfo.level")}: ${level}`
  };
}
