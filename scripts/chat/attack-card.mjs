/**
 * Attack declaration → target selection → resolution.
 * split into attack-card/model.mjs (pure rules), view.mjs (pure HTML), render.mjs (Foundry i18n binding),
 * service.mjs (GM flow) and client.mjs (buttons, Sensor Map, socket). This file keeps the old import path.
 */
export { CARD_FLAG, ATTACK_BUILTINS, isCardAttack, mayResolveCard, publicLabel } from "./attack-card/model.mjs";
export { declareAttack, resolveAttackCard, rollAttackCardDamage, applyAttackCardDamage } from "./attack-card/service.mjs";
export { renderAttackCard, renderDiag } from "./attack-card/render.mjs";
export { cardMapChoice, beginCardTargeting, registerAttackCards, setMapChoice } from "./attack-card/client.mjs";
