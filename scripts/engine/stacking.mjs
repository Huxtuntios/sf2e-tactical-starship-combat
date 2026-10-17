/**
 * PF2e-style modifier stacking: bonuses and penalties of the same type don't stack (highest bonus, worst penalty);
 * untyped modifiers stack. Returns total and the list of modifiers that were applied.
 * @param {{slug?:string,label?:string,type:string,value:number}[]} mods
 */
export function stackModifiers(mods) {
  const applied = [];
  const best = new Map(),
    worst = new Map();
  let untyped = 0;
  for (const m of mods) {
    if (!m || !Number.isFinite(m.value) || m.value === 0) continue;
    if (m.type === "untyped") {
      untyped += m.value;
      applied.push(m);
      continue;
    }
    if (m.value > 0) {
      if (!best.has(m.type) || best.get(m.type).value < m.value) best.set(m.type, m);
    } else if (!worst.has(m.type) || worst.get(m.type).value > m.value) worst.set(m.type, m);
  }
  let total = untyped;
  for (const m of [...best.values(), ...worst.values()]) {
    total += m.value;
    applied.push(m);
  }
  return { total, applied };
}
