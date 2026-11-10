import { isStarship } from "./starship-state.mjs";
import { shipStatistic } from "./stats.mjs";

const registered = new WeakSet();

/**
 * Inline-проверки SF2e и Toolbelt запрашивают getStatistic, а не адаптер листа.
 * У vehicle система готовит только Fortitude. Узкая обёртка дополняет API только
 * помеченных кораблей; исходный метод и неизвестные характеристики сохраняются.
 * Статистика вычисляется при запросе, поэтому не устаревает после смены экипажа.
 */
export function registerStarshipStatistics(actorClasses = globalThis.CONFIG?.PF2E?.Actor?.documentClasses) {
  let count = 0;
  for (const type of ["vehicle", "npc"]) {
    const prototype = actorClasses?.[type]?.prototype;
    if (!prototype || registered.has(prototype) || typeof prototype.getStatistic !== "function") continue;
    const original = prototype.getStatistic;
    Object.defineProperty(prototype, "getStatistic", {
      configurable: true,
      writable: true,
      value: function (slug, ...args) {
        if (isStarship(this)) {
          const statistic = shipStatistic(this, slug);
          if (statistic) return statistic;
        }
        return original.call(this, slug, ...args);
      }
    });
    registered.add(prototype);
    count++;
  }
  return count;
}
