# Action schema (`data/actions/station-actions.json`)

```jsonc
{ "id": "juke", "slug": "juke", "name": "Juke", "station": "pilot|generator|gunnery|scanners|magic-conduit|drone-console|any|npc",
  "minGrade": "tactical", "cost": 1 | [1,2] | "reaction" | "free", "traits": ["concentrate","manipulate","station"],
  "requirements": [ {"type":"notOffKilter"} ],           // see scripts/actions/requirements.mjs
  "frequency": {"per":"round|turn|10min|hour|day","uses":1},
  "targeting": {"type":"self|starship|station|area|none","range":"sensor|weapon|<zones>","allowSelf":false},
  "check": {"kind":"skill|targetSave|perception|none","skills":["piloting"],"dc":{"type":"targetPerception|targetReflex|targetWill|targetFortitude|fixed|levelBased|manualReflexDC","value":15}},
  "outcomes": {"criticalSuccess":[Effect], "success":[Effect], "failure":[Effect], "criticalFailure":[Effect]},   // keyed by the *check's* degree (target's degree for targetSave)
  "effects": [Effect],                                    // used when there is no check
  "builtin": "strike|area-fire|auto-fire|spell-attack|seek|npc-strike",
  "text": "...", "source": {"book":"Starfinder Tech Core","page":182} }
```

Effect types: `moveAlongHeading`, `reverseHeading`, `clearOffKilter`, `setOffKilter`, `applyEffect`, `restoreShields`, `restoreHull`, `damage`, `malfunction`,
`clearMalfunction`, `repairLockout`, `identify`, `manual` (anything else becomes a _manual_ line for the GM — never a crash).
Dice specs: `{count|"rank"|"missiles", faces, bonus, scaling:{from,step}}` or `{flat:"level"|"fortify"}`.
GMs can add custom actions/weapons/stations without JavaScript through the `customContent` world setting (same schema).
