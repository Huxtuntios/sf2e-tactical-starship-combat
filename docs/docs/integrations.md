# Integrations

- **HoloDock** — optional. Field ownership: tactical module owns `hp, sp, ac, speed, sensorRange, compromised, wrecked, heading, stations, combatState`; HoloDock owns `profile, image, loadout, components, dashboard, pins`. The bridge is one-way: nothing is ever written from HoloDock data. Today only the _Open HoloDock_ button and a read-only profile accessor exist; HoloDock must expose one of `openDashboard/open/openProfile/openShip` for the button to work.
- **Aztec's Engines of War** — vehicles carrying `flags.pf2e-aztecs-siege.isSiegeWeapon` cannot be converted to starships; no HUD is added to ordinary vehicles.
- **Causodes Ship Combat** — separate actor sub-types and flags; nothing is intercepted. A permanent warning is shown to the GM when it is active (setting _Causodes conflict handling_). Do not run both engines on one ship/encounter.
