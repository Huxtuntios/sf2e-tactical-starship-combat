# 0.17.1-dev.2 — experimental, incomplete

Based on the supplied 0.17.1-dev.1 source, not a release. Back up your world, install manually in a disposable copy, and do not use this build in a production campaign. No Git commit, push or GitHub release was made. The manifest/download URLs are not evidence of a published release.

## Scope

Deployment now refuses an unknown or exceeded console capacity and ambiguous unassigned/orphaned drone records. A drone already deployed may still be retrieved when over capacity. Duplicate station/drone IDs are rejected rather than selecting the first record for deploy/retrieve, mine placement, or Drone Block; duplicate mine IDs are rejected during a retry. This is a conservative safety policy, not an asserted Tech Core rule. No migration or deletion is performed. Selection and availability preview for Deploy/Retrieve reuse the same transition checks; the GM revalidates on execution. Action economy remains manual.

A duplicate packet following an intervening opposite operation may still act again: the deployment action has no durable request receipt. Queues are local to the active GM; failover, races across clients and independent document operations are not atomic. Unknown/legacy fields are retained. Drone Block still only handles its existing limited Strike paths and refuses the shield protocol; mine detonation and modifications, other drone actions, all three upgrades, complete chat/no-op audit, modifier coverage, history privacy, failover and real multiplayer verification are not completed by this build. Existing Sensor Map flags are not private, and secret placement remains unsafe.

## Ordered live-world checks

Use a backed-up disposable Foundry v14 world with SF2e and record exact core/system/module versions; separately test PF2e with SF2e Anachronism. Use distinct GM and player clients. Inspect the console for errors and compare state, chat and GM history after each step.

1. Import/upgrade a copy of dev.1 with existing drone records and unknown custom fields. Verify none are deleted; reload both clients.
2. With a helmed commercial Drone Console and one docked drone, confirm Deploy is enabled, consumes the correct in-world action manually, changes only that drone and emits one card/history entry. Repeated simultaneous requests should not deploy it twice. Retrieve and reload; verify both clients agree and unknown fields survive.
3. Change a console with multiple drones to a lower grade. Confirm further deployment is refused, but an already deployed drone can be retrieved. Restore a valid capacity and verify deployment works. Test unknown grade and ambiguous legacy assignments on a copied actor. Resolve issues manually only after a backup.
4. On a copied ship deliberately duplicate a drone ID and separately a station ID. Confirm actions, mine placement and supported Drone Block refuse the ambiguous record, do not write or post a card, and display a useful error. Restore the copy afterwards; do not apply this experiment to a real world.
5. Test cooldown before/at 10 minutes, station malfunction, destroyed ship, wrong operator, permission refusal, no active GM, no combat and refresh of sheet/HUD. Recheck no-op, Undo of a simple Deploy/Retrieve, conflict and repeated Undo. Undo is not a rollback of attacks or mine effects.
6. Run one supported single-target Strike with and without Drone Block, confirming selected drone, operator level, scope, damage and cooldown. Protocol, other Strike paths and NPC targets remain manual/unverified. Validate mines separately without arbitrary automatic detonation.
7. With two clients repeat simultaneous actions, reconnect, switch active GM, and test delayed packets and interleaved Deploy/Retrieve. Record any failures: mock tests cannot prove serialization across GM failover. Do not use map flags for secrets.
