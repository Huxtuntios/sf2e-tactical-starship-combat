# Rules decisions and disputed points

Legend: **[TC]** = Tech Core rule as printed · **[SF2e]** = how the SF2e 1.6.0 system behaves · **[MOD]** = module
simplification/interpretation (configurable where noted).

## Turn structure and initiative

- **[TC]** The player starship has no turn; PCs act with their own 3 actions + reaction on their own turns. Enemy starships
  and complex hazards roll initiative. **[MOD]** Default; optional setting adds a player-ship combatant before/after the crew.
- **[TC]** A compromised player starship enters initiative _directly before the turn in which it was reduced to 0 HP_ and
  attempts its hull integrity check first on ties. **[SF2e]** Ties are ordered by `flags.sf2e.overridePriority`; the module
  uses it. **[MOD 0.2.0]** After inserting the combatant the module re-selects the _current_ combatant (as SF2e does in
  `setMultipleInitiatives`), and per-turn processing is keyed by _round + combatant_, so the index shift no longer resets the
  current PC's action budget or expires effects early.

## Action economy, MAP, frequency

- **[TC]** Strikes from a gunnery station have the attack trait → **[MOD 0.6.0]** the multiple attack penalty is _chosen by the
  attacker_ (1st / 2nd / 3rd+ buttons on the attack card and the sheet): −5/−10, agile −4/−8, with the attacker's own MAP rule
  elements. The module never counts attacks, actions or reactions (players track them); there is no setting for it.
- **[MOD 0.10.0]** _Rule enforcement_ (world setting, default **Warn only**): a broken station rule — not helming the station, grade,
  malfunction, repair lock, free hand, requirements, frequency, range, detection — is shown as a ⚠ warning on the button and
  on the chat card and **nothing is blocked**. _Strict_ restores the refusals (the GM can still override). Permissions (who may
  act for which ship) and “no starship combat is running” are never softened.
- **[TC]** A station action's frequency belongs to the **battle station** that grants it. **[MOD 0.2.0]** Uses are
  recorded under `<stationId>:<actionId>` (two gunnery stations each get their own "once per round"); NPC abilities and
  actions without a station are tracked per ship.

- **[SF2e] [MOD 0.4.0]** MAP is per _creature_ (the crew member who makes the attack, or the NPC ship), counted over its own turn
  from attacks with the attack trait executed through the module (and native SF2e rolls with readable chat flags); −5/−10,
  agile −4/−8; off-turn reactions use the current count. The penalty shown in the attack card is the one applied at roll time.
- **[MOD 0.4.0]** Attack cards: declaration spends nothing; actions, frequency and MAP are consumed only when the attack resolves,
  after re-validating the turn, range, line of sensors and target detection (warnings in warn mode, refusals in strict mode). A target that is hidden/undetected for the
  attacker's side is not offered to players.
- **[MOD 0.4.0]** Crew in initiative: every crew member of a participating player ship (except observers, or only stationed crew,
  per setting) is a combatant with their own initiative, consistent with "PCs act on their own turns".

## Scanners / gunnery details

- **Target Lock [TC]** success: off-guard to the _next Strike from your starship_ within 1 round; failure: off-guard to
  _your starship_ for 1 round; critical failure: 2 rounds and no cover against your starship. **[MOD 0.2.0]** implemented as
  effects restricted to the source ship; the success effect is consumed by the next Strike. Cover denial is a manual note.
  (0.1.0 made the target off-guard to everyone.)
- **Lock On [TC]** "−1 status to AC against _your_ Strikes, −1 circumstance to Reflex against _your_ Area/Auto-Fire" —
  restricted to the source ship in 0.2.0.
- **Hack Battle Station / Hack Munition** — in the PDF the critical-failure line ("your starship takes −1 circumstance
  penalty to Will saves for 1 round") flows into the next column next to Hack Battle Station; by layout and wording it is
  part of **Hack Munition** (reaction). 0.2.0 moved it. If your printing differs, edit `station-actions.json`.
- **Clear a Path [TC]** grants an ally a reaction Strike or a bonus to the _next_ Strike. **[MOD]** modelled as an AC
  penalty on the target until your next turn + a manual note (approximation).

## NPC starships

- **[TC]** NPC strikes list a _range increment_. **[MOD]** maximum range = 6 increments with −2 per increment beyond the
  first (PF2e range-increment rule). Melee strikes reach only the same zone. Fallback when no range is printed:
  same-name player weapon (p.192 table), else sensor range.
- **[TC]** NPC station actions can't be used while their station malfunctions; shared actions (*) are blocked if _any_
  involved station malfunctions. **[MOD 0.2.0]** enforced for statblock actions and NPC Strikes.
- **[TC]** Gunnery can target beyond sensor range (weapon range applies).
- NPC Strikes are automated (attack vs AC, off-guard/heading, MAP, damage through shields/hull). Other statblock abilities
  are manual cards. NPC action definitions are rebuilt **on the GM client** from the ship's own data — clients can no longer
  submit arbitrary "inline" action definitions.

## Damage

- **[TC]** Shields absorb first (unless bypassing), then Hull; resistances/weaknesses/immunities; hardness for objects;
  compromised at 0 HP; losing compromised → wrecked +1; gaining compromised while wrecked adds wrecked; nonlethal → inoperable.
  Engines unchanged from 0.1.0 (verified).
- **[MOD]** Damage applied through the _native_ SF2e damage button to a starship actor bypasses Shield Points (SP live in
  module flags). Use the module's damage dialog / Strikes for starships.

## Areas

- **[TC]** cone = origin zone + N zones along heading; burst N from a border zone, burst 0 = single zone; line N zones.
  Auto-Fire cone size and unspecified area sizes are not fixed by the text → GM settings (default: half the weapon range).
