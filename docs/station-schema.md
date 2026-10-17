# Battle station schema

**Content** (`data/stations/stations.json`): `{id,name,icon,passive,source,advancement[]}`; each advancement row
`{grade,level,upgrades,<bonus fields>}` with bonus fields per station: `helmedAC`/`helmedReflex` (pilot), `helmedFortitude` (generator),
`damageDice`/`tracking` (gunnery), `helmedWill`/`sensorIncrease` (scanners), `helmedWill` (magic conduit), `drones` (drone console).
Grades: commercial, tactical, advanced, superior, elite, ultimate, paragon. Level thresholds — gunnery & drone console: 1/2/4/10/12/16/19; others: 1/2/5/8/11/14/18.

**Installed station** (in `starship.stations[]`):
`{id,type,name,grade,helmedBy(actorUuid|null),malfunctioning,malfunctionImmuneUntil,malfunctionUntilTurnOf,repairLockedUntilTurnOf,location{sceneId,col,row},upgrades[],actions[],weaponId,autoHelmed}`.
`location` stores grid _cells_, not pixels, so it survives scene padding/grid-size edits.
Passive helmed benefits (AC/Reflex/Fortitude/Will item bonuses, sensor range) apply while helmed **even when malfunctioning**.
