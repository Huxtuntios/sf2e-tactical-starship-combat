/** Validate client-proposed, per-roll modifiers; approval is obtained separately by the active GM. */
export function validateManualModifiers(input) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 6) throw new Error("Invalid manual modifiers");
  return input.map((m, i) => {
    if (!m || typeof m !== "object" || typeof m.name !== "string" || typeof m.source !== "string")
      throw new Error("Invalid manual modifier");
    const name = m.name.trim(),
      source = m.source.trim(),
      value = m.value;
    if (
      !name ||
      name.length > 80 ||
      source.length > 80 ||
      !Number.isInteger(value) ||
      value === 0 ||
      Math.abs(value) > 100 ||
      !["status", "circumstance", "item", "untyped"].includes(m.type) ||
      !["attack", "damage", "both"].includes(m.scope)
    )
      throw new Error("Invalid manual modifier");
    return { name, source, value, type: m.type, scope: m.scope, slug: `tsc-manual-${i}` };
  });
}
export function manualModifiersFor(modifiers, scope) {
  return (modifiers ?? [])
    .filter((m) => m.scope === scope || m.scope === "both")
    .map((m) => ({
      slug: m.slug,
      label: m.source ? `${m.name} (${m.source})` : m.name,
      type: m.type,
      value: m.value
    }));
}
