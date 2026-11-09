# 0.16.1-dev.9 — experimental, test worlds only

This is not a complete Drone Console implementation. It extends dev.8 without replacing earlier archives or migrating existing data. No separate drone actor, combatant or initiative is created. Action and reaction expenditure remains manual.

## Mine resolution aid

On the ship's station sheet, GM selects **Prepare mine resolution**, chooses fire or piercing, and selects the reaction checkbox only after verifying the specified entry/exit trigger. A GM-only chat message supplies native `@Damage` and basic Reflex `@Check` links; the GM makes the rolls for affected ships, adjudicates degrees of success and applies damage by existing means. Once completed, use **Mark detonated**. Posting links does not consume the mine, roll dice, select targets, apply damage, or spend actions. The GM can also remove a mine without detonation using the existing control. Repeated button presses intentionally create additional chat messages; resolve a mine once. The mine remains armed during manual resolution, so coordinate concurrent GMs and do not use this as an atomic transaction.

The tool checks a unique armed mine associated with the original operator, an operational console with a currently deployed Pyrotechnics Drone, the active combat and sensor range, and a valid operator level and actual class DC. It rechecks after the dialog. It refuses known modified mines instead of dropping their modifiers. It does not verify the reaction trigger, enumerate or check affected targets, integrate modifiers, or apply saves and damage. GM must verify these; no automatic trigger on map movement. The format and functionality of the native links in chat are **not live-tested** in Foundry 14/SF2e 1.7.

## Moving a mine

GM may use **Move mine** after explicitly confirming the operator has Mobile Exocortex. The server checks the console, mine ownership, active combat, currently deployed Pyrotechnics Drone, current sensor range, destination and origin. A change of exactly one zone is persisted through the existing GM ship queue; repeat deliveries with the same operation ID are no-ops even after a later move. A stale origin is rejected. No-ops do not produce a history record or write. Up to 512 operation IDs per mine are retained; at the limit further moves are refused rather than silently forgetting retry protection. This is a GM tool, not a fully integrated player station action: feature eligibility and action costs are adjudicated manually. The move is deliberately not offered as Undo; manual corrections must be adjudicated by the GM. Map and ship are separate documents, so state can change across document boundaries; real simultaneous-GM and failover behavior is unverified.

## Evidence

The detailed user-supplied summary supports mine damage, scaling, damage type, basic Reflex, prerequisites and trigger; it is not an official transcript. Indexed AoN builder excerpts independently support the one-action/reaction choices, sensor range, movement trigger and scaling, and one-action Move Starship Mine with Mobile Exocortex and movement by one zone. The supplied AoN pages themselves returned HTTP 403, so no full-text verification is claimed. Local project catalogue is evidence of the shipped data, not independent verification. The complete evidence matrix and unresolved rule conflicts remain in `drone-rules-matrix.md`.

## Still incomplete / required validation

- Base Drone Block remains restricted to module single-target ship-weapon Strikes against player ships and lacks the Drone Shield Protocol interaction; attacker, combat and chat writes are not one transaction. Do not treat it as verified across GM/player clients.
- Detonation does not automatically resolve saves, targets, damage or state; Modify Starship Mine and automatic mine effects, Repair Drone and Scramble Drone actions and all three upgrade effects remain unimplemented. Precise upgrade interactions and some action details require the full official text; do not substitute invented mechanics. Existing protocol is still handled manually.
- The complete no-op/chat audit, hull and GM Override verification, log privacy, Undo, socket races/failover and Sensor Map profiling in Foundry are not complete. As the user observed, very large images (e.g. 8100 × 11700) may cause stalls; this observation is not a performance profile.
- Perform live tests of every new button and system link, class DC values, range, repeated requests, permissions, multi-GM races, save/reload and history in Foundry VTT 14.370 with SF2e 1.7.0 before use outside a test world. Automated mocks and offline browser fixtures do not prove live compatibility.
