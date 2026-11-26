export function nextStationName({ type, name }, stations = []) {
  const base = String(name ?? type ?? "");
  const sameTypeCount = stations.filter((station) => station.type === type).length;
  const usedNames = new Set(stations.map((station) => String(station.name ?? "").toLowerCase()));
  if (sameTypeCount === 0 && !usedNames.has(base.toLowerCase())) return base;
  let suffix = Math.max(2, sameTypeCount + 1);
  while (usedNames.has(`${base} ${suffix}`.toLowerCase())) suffix++;
  return `${base} ${suffix}`;
}
