# Data audit (0.2.0)

## Why the content was rebuilt

The 0.1.0 starship/hazard JSON was extracted from an interleaved two-column text dump. Spot checks showed systematic
defects, e.g. _Atech Gold Spacer Truck_ had no strikes and carried action text from _Ringworks Sentinel_; _Raider Rustbringer_
listed a station action called "zero hydro the hearts of its allies…"; NPC strikes had **no traits**, so the
`range increment` the engine needs for range checks was missing on every ship; hazard descriptions mixed neighbouring columns
(e.g. _Wailing Rings_), several stealth values were wrong (_Extinct Astral Behemoth_ 29 → 23, _Orbital Mine_ 26 → 18) and
every hazard was marked complex/simple only by guess.

## Method (see `tools/content-pipeline/`)

- **Primary source: the Tech Core PDF**, read with bounding boxes so columns are not interleaved.
- **Cross-check: an Archives of Nethys dump** (cleaner layout, but incomplete: strike traits/ranges omitted, many station actions
  missing — e.g. _Klokworx Nexus_ lacks Deploy Drone, Laser Barrage, Nexus Formation/Swarm, Ultimate Shock Cannon — and
  a few numbers differ).
- Every number taken from the PDF; AoN only fills gaps. Each disagreement is stored in the ship's `review` array.

## Results

|                             | 0.1.0                                      | 0.2.0                                                                                                             |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Starships                   | 74 (16 `needsReview`, many silently wrong) | 74, all with Perception, sensors, skills, attributes, AC/saves, HP, SP/fortify, speed, stations, strikes, actions |
| Strikes with traits / range | 0                                          | 97 strikes, every ranged one has its range trait                                                                  |
| Station actions with text   | partial                                    | 232 statblock actions/abilities (231 PDF, 1 AoN-only), 25 recovered from neighbouring statblocks                  |
| Custom stations             | merged into wrong types                    | 30 kept as custom stations with their book label (Hangar Bay, Motor Organelle, …)                                 |
| Hazards                     | 32 (23 `needsReview`)                      | 32; 23 AoN+PDF, 9 PDF-only (not in the AoN dump)                                                                  |

### Recorded source disagreements

- **Sovereign Dominator** — Shield Points: PDF **32** (fortify 16) vs AoN 132. PDF used (132 SP would be ~4× the level-8 norm).
- No other numeric disagreements between PDF and AoN for ships; hazards: none after parsing (AoN lacks AC/saves for some
  object hazards, PDF values used).
- **Unstable Munition** — the level heading is not adjacent to the statblock in the PDF layout; level **17** (from AC 37,
  HP 110, Stealth +28, matching the level-17 row of the hazard tables). _Unholy Vortex_ is 19.
- **UC Gardenship / UC Arkship, Sword-class / Harpoon-class, Jinsul Breacher / Carrier, Inheritorworks Shieldcraft /
  Cathedralship, Jolly Roger / Starsplitter, Converted Dreadnought / Hivebound Behemoth, Alghollthu Warshell / Biotech
  Sporehall** — statblocks share columns in the book; abilities were re-assigned by matching the ship's Battle Stations list.

### Remaining caveats

- Ability prose is the book text joined across line breaks; occasional hyphenation artefacts ("all- Archive") may remain.
- NPC abilities other than Strikes are **manual** action cards (statblock text, cost, traits, frequency); the GM applies the
  effect. Area Fire / Auto-Fire statblock entries keep their DC and damage in the card text.
- Family features ("Living Starship", "See page 208") are references, not automated.
