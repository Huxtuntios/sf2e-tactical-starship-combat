# Combat state (`combat.flags.sf2e-tactical-starship-combat.tsc`)

```json
{
  "dataVersion": 1,
  "enabled": true,
  "zones": 12,
  "orientation": "horizontal",
  "objects": [
    {
      "key": "<actor uuid>",
      "type": "starship|hazard|asteroid|...",
      "name": "",
      "zone": 5,
      "span": 1,
      "heading": "right",
      "hidden": false,
      "alwaysVisible": false,
      "stealthDC": null,
      "designation": "Contact Alpha",
      "detection": { "party": "observed", "<observer ship uuid>": "identified" }
    }
  ],
  "zoneInfo": { "5": { "cover": false, "concealment": false, "special": "", "publicNotes": "", "gmNotes": "" } },
  "budget": { "<combatantId>": { "spent": 1, "reactionUsed": false } },
  "knowledge": { "<model key>": { "model": true, "stations": ["gunnery-1"] } },
  "hazardState": {},
  "contactCounter": 0,
  "log": [{ "t": 0, "round": 1, "text": "", "type": "damage", "data": {} }]
}
```

Source of truth is the Combat document; windows re-render from document hooks only. Writes happen on the active GM client.
The compromised initiative entry is an ordinary combatant carrying `flags.<module>.compromisedEntry = true` (+ `flags.sf2e.overridePriority` to win ties).
