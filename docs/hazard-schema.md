# Hazard schema

Content (`data/hazards/hazards.json`): `{id,name,level,complexity:simple|complex,isComplex,traits[],stealthDC,description,disable,ac,fort,ref,will,hardness,hp,bt,immunities,weaknesses,actions[{name,cost,text}],routine{cost,text},reset,source,needsReview}`.
Only fields that exist for a given hazard are present. Hazards are `hazard` actors flagged `flags.<module>.starshipHazard.isStarshipHazard`; **complex hazards roll initiative natively through Stealth** and are combatants; simple hazards never are.
Per-combat state: `tsc.hazardState[uuid] = {disabled, mode: disable|destroy|temporary|permanent, disabledAt{round,time}, placement: sensor|ship|both}`.
Reset text is parsed into `immediate | rounds | seconds | never | custom` (custom ⇒ GM re-enables manually).
