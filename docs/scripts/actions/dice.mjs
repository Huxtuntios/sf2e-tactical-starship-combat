import { scaledDiceCount } from "../engine/advancement.mjs";

/** Evaluate a data-driven dice spec: { count|"rank"|"missiles", faces, bonus, scaling:{from,step}, flat, bonusFromCheck }. */
export function buildFormula(spec, ctx) {
  if (spec.flat) {
    const v = spec.flat === "level" ? ctx.level : spec.flat === "fortify" ? (ctx.data.fortify ?? 0) : Number(spec.flat) || 0;
    return String(v);
  }
  const rank = ctx.options.rank ?? 1;
  const actions = ctx.options.actions ?? 1;
  const missiles = actions * (1 + Math.floor((rank - 1) / 2));
  let count = spec.count === "rank" ? rank : spec.count === "missiles" ? missiles : (spec.count ?? 1);
  if (spec.scaling) count = scaledDiceCount({ base: count, from: spec.scaling.from, step: spec.scaling.step }, ctx.level);
  let bonus = spec.bonus ?? 0;
  if (typeof bonus === "string") bonus = bonus === "missiles" ? String(missiles) : bonus.replace(/rank/g, String(rank));
  if (spec.bonusFromCheck && ctx.checkBonus) bonus = `${bonus}+${ctx.checkBonus}`;
  return `${count}d${spec.faces}${bonus ? `+${bonus}` : ""}`;
}

/** Roll and announce a dice spec. Returns the numeric total. */
export async function rollSpec(spec, ctx, flavor) {
  const formula = buildFormula(spec, ctx);
  if (/^\d+$/.test(formula)) return { total: Number(formula), formula };
  const roll = await new Roll(formula).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: ctx.ship }), flavor });
  return { total: roll.total, formula, roll };
}

/** Basic save multiplier by degree (0 crit success, 1 failure=full...). Index = degree of success of the TARGET. */
export function basicSaveMultiplier(degree) {
  return [2, 1, 0.5, 0][degree] ?? 1;
}
