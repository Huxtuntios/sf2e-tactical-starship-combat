# Rules decisions and disputed points

## 0.17.1-dev.13 — Drone Block and adjacent rules

**[TC, printed p.179]** Drone Block requires at least one deployed drone, grants resistance against the triggering Strike equal to half the operator's level, and separately says that the used drone is retrieved and can't be deployed again for 10 minutes. The effect is not conditional on resistance being positive: at level 1 the resistance is 0, but the drone still returns and enters the 10-minute restriction. The module applies the resistance only to the exact damage card/Strike approved by the GM and uses the existing starship damage pipeline.
**[AoN]** [Drone Block](https://2e.aonsrd.com/actions/585-drone-block).

**[TC, printed p.184]** Drone Shield Protocol is a separate upgrade: it permits up to two Drone Blocks per drone before retrieval, with the first destroying its shield, and grants Fetch and Fix; Fetch and Fix immediately retrieves and repairs the drone, with a two-round redeployment restriction if its shield was destroyed. The attack-card reaction now exposes a GM-confirmed manual-only path for a console with this upgrade. It applies no base retrieval/cooldown and does not invent shield, use-count or Fetch and Fix state; a strike-specific receipt prevents replay, while the GM manually applies resistance and tracks the upgrade's effects.

**[TC, printed p.193]** Intercept Munitions says it cannot be used with that drone until you “Retrieve Drone to retrieve this scramble drone.” Drone Block says the drone is retrieved, but the text does not specify whether this automatic return counts as the named Retrieve Drone action. The module therefore does not clear `tscInterceptUsed` on Drone Block; only the explicit Retrieve transition clears it. A GM warning appears when the selected Scramble Drone has recorded Intercept use. This is conservative module behavior, not a definitive rules interpretation.
**[AoN]** [Intercept Munitions](https://2e.aonsrd.com/actions/576-intercept-munitions).

**[TC, printed pp.192–193]** Pyrotechnics Drone mines are described as shielded starship mines deployed in the starship's zone; Deploy Starship Mine creates a mine there, and the drone's actions are available while it is deployed. The cited text does not say whether returning the drone removes deployed mines or whether stored mines inside the drone persist through return/redeployment. TSC does not alter either mine records or stock on Drone Block and disables drone-dependent operations while the drone is returned; the GM is warned to inspect/review before redeploying or using it. This preserves current data and is not a rules ruling.
**[AoN]** [Pyrotechnics Drone](https://2e.aonsrd.com/tactical-starship-combat/drones/1-pyrotechnics-drone) · [Deploy Starship Mine](https://2e.aonsrd.com/actions/569-deploy-starship-mine).

## 0.17.1-dev.11 — Install Mine

Tech Core p. 184 modifies up to four mines _inside_ an undeployed drone; Deploy Starship Mine on p. 193 is a distinct action. A map mine is not created by Install Mine, and personal mechanic mods are not mapped to deployed starship Smart/Targeting mods. The helper is a manual plan only; its saved labels and mod text are not effects or proof of inventory, prerequisites or validity. GM must verify effects and their duration.

## 0.17.1-dev.10

Tech Core p. 184 describes Install Mine as Modify on up to four starship mines in an undeployed pyrotechnics drone, as if they were the mechanic’s own Mine Exocortex mines. Tech Core pp. 36–37 describe personal mods and expiry; they are not interchangeable with starship Smart/Targeting Mine results. The current module has no authoritative onboard mine inventory or reliable personal mod list. The new helper records GM-verified labels as notes only; it does not grant, activate, transfer or expire effects. A note is not proof that an effect is valid. No costs are tracked.

## Pet cabin ending and Toolbelt (0.17.1-dev.9)

**[TC]** The pet cabin effect ends on the rule's ending conditions; no action economy is added. **[MOD]** Observed time, helm, zero HP, Actor deletion and upgrade removal mark the session ended permanently on the active GM, but native quickened and unobservable events require GM handling. **[MOD safety]** Better Chat changes message identities or roll content, so transformed damage cards are refused for ships until GM review; this is an implementation safeguard, not a game rule.

## Drone aids (0.17.1-dev.8)

**[TC]** Tech Core printed pages 184–185 and 192–193 are the rules source, with the user confirming the printed wording where their paraphrase differed; Drone Block uses half the operator's level. **[MOD]** Mine assistance uses basic-save results and the existing module damage engine only after GM confirmation; a map is not proof of complete targets. Harry effects are module-only, not native conditions. Shield Protocol and Fetch use GM-confirmed records and a conservative combat anchor, not a simulation of Strike resistance. Pet quickened and its restricted use are manual. Install Mine personal-mod rules are not substituted for starship mine mods. No action/reaction expenditure or counters are implemented. These choices are incomplete tooling, not a change to the tabletop rules.

## Smart Mine GM aid (0.17.1-dev.6)

**[TC]** A Smart Mine can exclude one ship in its zone from its detonation. **[MOD]** The helper permits zero or one explicit exclusion, only if the existing modification timing is valid; it lists ships from the current sensor map, not the entire world. The GM verifies missing targets and resolves all saves, damage, exclusion and detonation manually. No character action or reaction expenditure is tracked.

## Drone safety (0.17.1-dev.2)

**[MOD]** To avoid choosing arbitrary old or conflicting records, deployment is refused when console capacity is unknown, exceeded or assignments are ambiguous; retrieval is allowed even if capacity is exceeded. Duplicate IDs are rejected, not repaired automatically. This is a conservative implementation guard, not a claim that Tech Core contains this specific restriction. Action and reaction costs remain tracked at the table.

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
- **Hack Battle Station / Hack Munition** — in the printed rules text the critical-failure line ("your starship takes −1 circumstance
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

## 0.17.1-dev.3: evidence and safety

Indexed [AoN builder](https://2e.aonsrd.com/tactical-starship-combat/builder) excerpts corroborate Repair Hull base DC and dice, with higher Crafting DC tiers, but the full source text and real SF2e API were not available for validation. No drone effect was inferred or newly automated. The user explicitly excluded action/reaction spending; this stage adds no accounting or action-availability gate. To avoid unsafe rollback of consequences, HP/SP history entries cannot be undone, including legacy entries whose provenance cannot be established.

## 0.17.1-dev.4: Tech Core and Repair Hull

Tech Core, printed p. 193, describes Repair Hull as two actions, base DC 15, critical success 2d6, success 1d6, critical failure 1d6 piercing, and expert/master/legendary DC 20/30/40 with +10/+30/+50 to healing. Display the cost but do not track or spend actions. The additional 1-hour/1-day extension in the user's paraphrase is not present in the printed p. 193 passage; it is not implemented.

Printed p. 179 states Drone Block resistance is half **your** level (operator). The user's paraphrase says ship level. Existing operator-level behavior remains pending clarification; do not silently substitute one for the other. No rule is inferred for unimplemented integrations.

## 0.17.1-dev.5: mine helper and Drone Block confirmation

**[TC]** Printed Tech Core p. 193 grants Smart Mine (exclude one starship) or Targeting Mine (Intelligence modifier, minimum 1), until the end of the operator's next turn. **[MOD]** GM confirms the class feature; this helper supports only the current operator's turn, one unambiguous mine and one active mod at a time. A changed combatant order or missing anchor is an error, not an invented expiry. The resulting detonation remains manual and has no automatic target exclusion or damage. Mine Exocortex on printed p. 37 uses different personal-scale mods; Install Mine is not implemented by this helper.

**[TC]** Printed p. 179 bases Drone Block on half the operator's level. The user confirmed this wording; this resolves the earlier paraphrase conflict. Existing code and behavior were preserved, with a test where ship and operator levels differ. No action or reaction expenditure is tracked.

## 0.17.1-dev.7: осторожные помощники для мин и Scramble

**[TC]** Предоставленный Tech Core, печатные стр. 184 и 193: для Pyrotechnics выбор fire/piercing, basic Reflex против class DC, Smart исключает один корабль, Targeting добавляет Intelligence минимум 1; Harry Sensors использует больший class/spell DC, Will и зависящие от степени условия; Intercept Munitions даёт –2 circumstance к вызывающей атаке и восстанавливается после Retrieve Drone. Текст Tech Core имеет приоритет над пересказом, когда они расходятся.

**[MOD]** Помощник мины делает общий типизированный бросок и отдельные спасброски только для представленных на карте кораблей и выводит сырой basic-урон до защит. Карта может быть неполной. Применение урона, определение реакции и закрытие мины — вручную. Harry лишь показывает результат, без создания или истечения состояний. `class-spell` проверен по исходникам SF2e 1.6.0, не на действующем сервере; если надёжного DC нет, ведущий вводит его вручную. Intercept — отметка подтверждённого вручную штрафа, а не изменение законченного или будущего Strike. Никакая стоимость действий не учитывается.

**[MOD]** Операции чат/бросок/Actor не объединены в транзакцию. Прогресс-карточка не является гарантией единичного выполнения; ручное восстановление требует проверки мира. Shield Protocol, Fetch and Fix, Install Mine и Onboard Pet не реализованы в этом этапе, поскольку пока не подтверждена безопасная интеграция с состояниями, временем и системными API.
