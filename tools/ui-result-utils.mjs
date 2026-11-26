export function fixtureReady(result) {
  return result?.passed !== false;
}

export function failedUiChecks(result) {
  const failed = (result?.checks ?? []).filter((check) => !check.pass).map((check) => check.name);
  const measurements = (result?.measurements ?? []).flatMap((measurement) =>
    measurement.checks.filter((check) => !check.pass).map((check) => `${measurement.width}: ${check.name}`)
  );
  return [...failed, ...measurements];
}
