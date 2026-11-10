/** Station options for one crew member: who occupies each station (null = free), and the member's own one. */
export function stationOptions(data, actorUuid) {
  return (data?.stations ?? []).map((s) => {
    const occ = s.helmedBy ? (data.crew ?? []).find((c) => c.actorUuid === s.helmedBy) : null;
    const mine = !!s.helmedBy && s.helmedBy === actorUuid;
    return {
      id: s.id,
      name: s.name,
      malf: !!s.malfunctioning,
      mine,
      occupied: !!s.helmedBy && !mine,
      occupantName: s.helmedBy && !mine ? (occ?.name ?? "?") : null
    };
  });
}
