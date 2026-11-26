export function selectUiFixtures(allFixtures, filter) {
  if (filter == null || filter === "") return allFixtures;
  const requested = filter
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (!requested.length) throw new Error("TSC_UI_FOLDER must contain at least one fixture name");
  const known = new Set(allFixtures.map(([, folder]) => folder));
  const unknown = requested.find((name) => !known.has(name));
  if (unknown) throw new Error(`Unknown TSC_UI_FOLDER fixture: ${unknown}`);
  const selected = new Set(requested);
  return allFixtures.filter(([, folder]) => selected.has(folder));
}
