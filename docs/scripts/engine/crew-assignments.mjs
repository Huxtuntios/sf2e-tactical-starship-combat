/**
 * Crew ↔ battle station consistency (pure, no Foundry globals).
 *
 * Source of truth: `station.helmedBy` (actor UUID). `crew[].stationId` is a derived mirror kept for the action pool
 * and older readers. Rules enforced:
 *  - crew entries are unique per actorUuid (first entry wins);
 *  - a station may only be helmed by an actor that is in the crew list (stale occupants are cleared);
 *  - an actor helms at most one station (first station in list order wins, later duplicates are cleared);
 *  - crew.stationId always equals the id of the station the actor helms, or null.
 * Returns the repaired data plus a list of human-readable repair codes (for logs / tests).
 */
export function normalizeCrewAssignments(data) {
  const repairs = [];
  const seen = new Set();
  const crew = [];
  for (const c of Array.isArray(data.crew) ? data.crew : []) {
    if (!c || typeof c.actorUuid !== "string" || !c.actorUuid) {
      repairs.push("crew:invalid-entry");
      continue;
    }
    if (seen.has(c.actorUuid)) {
      repairs.push(`crew:duplicate:${c.actorUuid}`);
      continue;
    }
    seen.add(c.actorUuid);
    crew.push(c);
  }
  const helming = new Map();
  for (const st of Array.isArray(data.stations) ? data.stations : []) {
    if (!st.helmedBy) {
      st.helmedBy = null;
      continue;
    }
    if (!seen.has(st.helmedBy)) {
      repairs.push(`station:stale:${st.id}`);
      st.helmedBy = null;
      st.autoHelmed = false;
      continue;
    }
    if (helming.has(st.helmedBy)) {
      repairs.push(`station:duplicate:${st.id}`);
      st.helmedBy = null;
      st.autoHelmed = false;
      continue;
    }
    helming.set(st.helmedBy, st.id);
  }
  for (const c of crew) {
    const want = helming.get(c.actorUuid) ?? null;
    if ((c.stationId ?? null) !== want) {
      repairs.push(`crew:station:${c.actorUuid}`);
      c.stationId = want;
    }
  }
  data.crew = crew;
  return { data, repairs };
}

/** Pure helper: move an actor to a station (or release with stationId=null), keeping both sides consistent. */
export function assignStation(data, actorUuid, stationId) {
  for (const st of data.stations)
    if (st.helmedBy === actorUuid) {
      st.helmedBy = null;
      st.autoHelmed = false;
    }
  if (stationId) {
    const st = data.stations.find((s) => s.id === stationId);
    if (st) st.helmedBy = actorUuid;
  }
  return normalizeCrewAssignments(data).data;
}

/** Pure helper: free a station (whoever helms it). */
export function releaseStationIn(data, stationId) {
  const st = data.stations.find((s) => s.id === stationId);
  if (st) {
    st.helmedBy = null;
    st.autoHelmed = false;
  }
  return normalizeCrewAssignments(data).data;
}

/** Crew members helming a station (they "occupy" a post) vs free crew (aboard, no post). */
export function partitionCrew(data) {
  const stationed = [],
    free = [];
  for (const c of data.crew ?? []) (c.stationId ? stationed : free).push(c);
  return { stationed, free };
}
