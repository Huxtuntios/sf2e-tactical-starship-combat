# 0.16.1-dev.4 — incomplete experiment, test worlds only

Back up the world before testing. This is not a release and does not establish that Sensor Map, sockets, private history or Undo work correctly in a live multiplayer world.

## Drone tracker

The Stations tab of a player ship has a console inventory. An equipment editor can add one of the three catalogue drones subject to the console grade's capacity. A GM or the player who owns the currently helming character can record deployment or retrieval. These controls record state only; operator/GM must track action costs, eligibility, drone-bay provision and consequences. No drone Combatant, separate initiative, HP or AC is created. A tracked `availableAt` is interpreted as Foundry world time in seconds and deployment is refused until it expires; no automatic Drone Block generates it yet.

GM-authoritative socket handlers check sender permissions and read/modify/write in the existing actor queue. Duplicate add requests bearing the same ID and repeated same-state commands do not write or create history/chat. Legacy or malformed records are retained; ambiguous assignment requires GM review. Downgrading a console does not remove excess drones. Drone-record changes are not Undoable through the current deliberately narrow history mechanism. Raw drone-list editing is restricted to GM. Removing or repairing individual records is currently a GM raw-JSON task; preserve backups.

**Not implemented:** selecting a drone within existing station-action execution; automatic action/reaction cost; Drone Block, attack-scoped resistance and its 10-minute cooldown; drone-granted actions, mines, repairs, malfunction suppression, conditions and attack-specific reactions; all effects and duration/trigger rules for Drone Shield Protocol / Fetch and Fix, Mine Deployment Shell / Install Mine and Pet Drone Shell / Onboard Pet. Do not assume that recording deployment enables or enforces any of these effects. All remain with GM. `docs/drone-rules-matrix.md` is an evidence audit, not proof that these mechanics work. The local catalogue has item text, but full original rules were not independently verified.

## Other changes and limits

Weapon choices show damage, damage type, explicit required proficiency and item level if present. Unknown values are shown as not specified; weapon category is not a proficiency rank. Rich multi-component weapons and operator proficiency are not fully implemented. Existing installed custom weapon records may lack item level. Existing native enrichers are preserved when additional checks are rendered; generated module links have keyboard focus. Explicitly typed text uses existing native typed damage handling. Context-inherited damage types, ambiguous/multiple components, complete accessibility and all attachment-requested interactions are not fully implemented or verified in Foundry.

A user observed hangs with an 8100 × 11700 image; very large Sensor Map images may freeze. Consider reducing image dimensions. This observation does not establish a universal size limit or prove the underlying cause. No live Foundry profiling was performed for this build.

## Verification status

See the accompanying delivery report for exact test results. Node tests and local browser fixtures are not live Foundry or real multiplayer tests. New drone functionality, changes to inline links and weapon displays must be checked manually in Foundry v14 / SF2e 1.7.0, including multiple GM/player clients, repeats, concurrency, saving/restart, permissions, history and Undo. The broader chat/no-op audit is still incomplete. The three stock frames and catalogue levels were covered by the earlier automated audit, not a real-world test of every ship configuration.

## Sources

The indexed AoN builder excerpt independently confirms the three upgrade names/levels and part of Drone Shield Protocol. It does not substitute for complete original records. The supplied AoN pages returned access errors. The remaining rules matrix identifies local data, user summary and unknown details separately; do not treat the technical summary as verbatim official text.
