# 0.17.0 — experimental, test worlds only

The requested 0.17.0 number is used for this **unpublished test build**, based on 0.16.1-dev.10. It is not a claim that all previous tasks are complete or that a release is verified. Back up the world. The existing dev.10 archives are unchanged. There was no Git commit, push or GitHub release. The build script generates GitHub release download addresses in the packaged manifest; they will not work until the owner publishes a release. Install the ZIP manually for testing.

## Visual controls

The GM palette edits combat-scoped arrows: none, text, emoji or a File Picker image; arrow size, gap, position and opacity. Missing image falls back to text. Individual existing map objects have rotation, independent X/Y flips, and artwork base direction. Controls edit the form; Save applies a normalized absolute patch. Rotation is normalized to 0–359°. Auto Mirror combines a derived horizontal flip and the manual horizontal flip using XOR; changing headings never accumulates flips. The underlying heading remains the existing left/right game heading. For artwork facing up/down no automatic guess is made. Background orientation is visual only, not a transformation of zones, objects, or game coordinates. Drones and mines are not currently separate Sensor Map objects and therefore have no individual controls here.

Settings and per-object transforms are stored in the combat flag; older state uses defaults without destructive migration. Unknown existing fields survive patches. The active GM handles map requests and validates permissions; different map updates on that GM are serialized per combat. This queue is separate from other document-write queues; multiple GMs, failover and cross-document changes are not atomic and remain unverified. Duplicate absolute patches do not issue a second update when state is already identical. No data were intentionally migrated.

## Performance

The user reported freezing with a large 8100 × 11700 background; reduce dimensions. The existing background style assignment guard was retained. The zone partial still contains and can replace the background element; the cause, gain and live performance are **not confirmed**. The offline Chromium fixture is not a real Foundry profile. Repeated map redraws and real interaction on constrained hardware require profiling before any performance claim.

## Existing incomplete work

- Drone Block is limited to supported module-resolved single-target ship-weapon Strikes against player ships; Shield Protocol is not automated. Transactions across combat, attacker, and chat are not atomic. Full Pyrotechnics, Repair, Scramble, Drone Shield Protocol, Mine Deployment Shell and Pet Drone Shell remain incomplete. Mine resolution links and move/mark/remove are GM assistance, not automatic saves and damage. Action/reaction spending stays manual.
- Full chat/no-op audit, every description's interactive content, full damage-type inheritance and universal station-damage modifiers are not complete. Previous work-in-progress notes spell out boundaries.
- GM Override and standard frame equipment, GM journal privacy, sockets, Undo, actions and reload recovery are not confirmed in a real multi-client Foundry 14.370/SF2e 1.7.0 world. Mock tests cannot verify those or performance. No new claims about official AoN rule verification are made here.

## Live manual test plan (not performed)

1. Back up a copy of a world. Install manually, start an encounter with GM and at least two player clients. Repeat after reopening the world.
2. Test all four arrow modes, valid/missing custom files, size, spacing, position and opacity in both themes. Check identified and unidentified contacts, permissions and privacy.
3. Set distinct objects to 45°, flip X, flip Y, reset only flipping, rotate, resize and drag/select; verify no coordinates, hitbox, heading or other object change. Test left/right base directions, both courses, auto mirror on/off and manual flip combinations. Check up/down base direction remains unchanged.
4. Rotate/flip the background; verify zones and game objects stay fixed. Test reasonable images and measure CPU/GPU/memory and latency in Foundry with a large background; do not assume the cause or fix.
5. Concurrently edit separate appearance/object fields, attempt unauthorized player writes, duplicate requests, disconnect and change active GM. Check state after reload and detect races with movement, attacks and other combat updates. The mock queue is not proof of server behavior.
6. Recheck prior dev.10 test plans: GM Override and frames, history privacy/Undo, no-ops, native attack and separate damage in all chat modes, drone and mine limitations, station boost and modifiers.
