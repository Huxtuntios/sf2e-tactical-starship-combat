import { linkContextDCs } from "../../rolls/context-dc.mjs";
/**
 * "Installed Upgrades" on every battle station card (player and NPC sheets) and the ship-level section
 * (escape pods, unassigned / orphaned records). View building only; writes go through Ship.stationUpgrade.
 * Stored records carry stable catalog ids (ref + variant); every label below is localized at render time.
 */
import { Content, upgradeCatalog } from "../../content/loader.mjs";
import {
  stationUpgradeStatus,
  stationOptions,
  shipLevelOptions,
  resolveUpgrade,
  upgradesOf,
  compatibleWith,
  ESCAPE_POD_SETS
} from "../../engine/upgrades.mjs";
import { upgradeDescriptionHTML } from "../../content/upgrade-docs.mjs";
import { checkLinksHTML } from "../../content/inline-checks.mjs";
import { ct } from "../../content/content-i18n.mjs";
import { traitLabel, stationTypeLabel } from "../../utils/labels.mjs";
import { T } from "../../utils/foundry.mjs";

/** Assign target meaning "ship level" (escape pods). */
export const SHIP_TARGET = "__ship";
const L = (k, d) => T(`SF2eTSC.upgrades.${k}`, d);
const className = (c) => (game.i18n.has(`SF2eTSC.classes.${c}`) ? T(`SF2eTSC.classes.${c}`) : c);
const docOpts = { tr: ct, L, render: checkLinksHTML, traitLabel, stationLabel: stationTypeLabel, classLabel: className };
export const upgradeDetailsHTML = (entry, context = {}) =>
  upgradeDescriptionHTML(entry, { ...docOpts, render: (text) => checkLinksHTML(linkContextDCs(text, context)) });

/** Text matched by the selector's search box: localized + English name, level, usage. */
const searchText = (e) => [ct(e.name), e.name, ct(e.usage), e.level].join(" ").toLowerCase();
const optionView = (e, override = false) => ({ key: e.key, name: ct(e.name), level: e.level, search: searchText(e), override });

function itemView(sheet, rec, entry, issues, overridden, station, { isGM = false, canEdit = false } = {}) {
  const warnings = issues
    .map((code) =>
      code === "incompatible"
        ? L("warn.incompatible", { usage: entry ? ct(entry.usage) : "—" })
        : code === "capacity"
          ? null
          : code === "level"
            ? L("warn.level", { level: entry?.level ?? "?" })
            : code === "unknown"
              ? L("warn.unknown", { ref: rec.ref ?? rec.id })
              : null
    )
    .filter(Boolean)
    .map((text) => ({ text }));
  return {
    id: rec.id,
    catalogKey: entry?.key ?? "",
    name: entry ? ct(entry.name) : rec.name || rec.ref || rec.id,
    level: entry?.level ?? rec.level ?? "—",
    usage: entry ? ct(entry.usage) : "",
    warnings,
    overCapacity: issues.includes("capacity"),
    overridden: !!rec.override,
    overrideActive: overridden,
    open: !!sheet?._openUpgrades?.has(rec.id),
    html: entry
      ? upgradeDetailsHTML(entry, { crew: station?.helmedBy ? fromUuidSync(station.helmedBy) : null, ship: sheet?.document })
      : "",
    stationName: station ? ct(station.name) : "",
    isGM,
    canEdit
  };
}

/** Per-station section. `canEdit` = GM or editEquipment permission. */
export function stationUpgradeView(sheet, data, st, { isGM = false, canEdit = false } = {}) {
  const entries = upgradeCatalog();
  const status = stationUpgradeStatus(data, st, { entries, stationDef: Content.stations.get(st.type) ?? null });
  const opts = canEdit ? stationOptions(entries, st, { isGM }) : { compatible: [], override: [] };
  const full = status.used >= status.capacity;
  return {
    stationId: st.id,
    capacity: status.capacity,
    used: status.used,
    over: status.over,
    overText: status.over ? L("warn.over", { used: status.used, capacity: status.capacity }) : "",
    capacityLabel: L("capacity", { used: status.used, capacity: status.capacity }),
    items: status.installed.map((x) => itemView(sheet, x.record, x.entry, x.issues, x.overridden, st, { isGM, canEdit })),
    canEdit,
    isGM,
    canInstall: canEdit && (isGM || (!full && opts.compatible.length > 0)),
    full,
    fullText:
      full && canEdit && !isGM
        ? status.capacity
          ? L("errors.capacity", { used: status.used, capacity: status.capacity })
          : L("noSlots")
        : "",
    compatible: opts.compatible.map((e) => optionView(e)),
    override: opts.override.map((e) => optionView(e, true)),
    noCompatible: canEdit && !opts.compatible.length ? L("noCompatible") : ""
  };
}

/** Ship-level section: escape pods (slot "escape-pods") and records without a valid station. */
export function shipUpgradeView(sheet, data, { isGM = false, canEdit = false } = {}) {
  const entries = upgradeCatalog();
  const ids = new Set(data.stations.map((s) => s.id));
  const shipLevel = upgradesOf(data, null);
  const pods = [],
    unassigned = [];
  for (const rec of [...shipLevel, ...(data.upgrades ?? []).filter((u) => u?.stationId && !ids.has(u.stationId))]) {
    const entry = resolveUpgrade(entries, rec.ref, rec.variant ?? null);
    const isPod = entry?.slot === "escape-pods" && !rec.stationId;
    const issues = entry ? [] : ["unknown"];
    const v = itemView(sheet, rec, entry, issues, false, null, { isGM, canEdit });
    if (isPod) pods.push(v);
    else {
      const targets = data.stations
        .map((s) => ({ id: s.id, name: `${ct(s.name)} (${stationTypeLabel(s.type)})`, override: !entry || !compatibleWith(entry, s) }))
        .filter((t) => isGM || !t.override);
      if (entry?.slot === "escape-pods") targets.unshift({ id: SHIP_TARGET, name: L("escapePods"), override: false });
      unassigned.push({ ...v, targets });
    }
  }
  const podOptions = canEdit ? shipLevelOptions(entries).map((e) => optionView(e)) : [];
  return {
    pods,
    unassigned,
    podOptions,
    canEdit,
    isGM,
    podsFull: pods.length >= ESCAPE_POD_SETS,
    canInstallPod: canEdit && (isGM || pods.length < ESCAPE_POD_SETS),
    stationIds: [...ids]
  };
}

/** Station card partial (both sheets). */
export const STATION_UPGRADES_PARTIAL = `<section class="tsc-upgrades" data-upgrade-section="{{stationId}}">
  <h5 class="tsc-upgrades-head"><i class="fa-solid fa-microchip" aria-hidden="true"></i> {{localize "SF2eTSC.upgrades.title"}} <span class="tsc-pill {{#if over}}bad{{/if}}" data-tooltip="{{localize 'SF2eTSC.upgrades.capacityTitle'}}">{{capacityLabel}}</span></h5>
  {{#if overText}}<p class="tsc-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {{overText}}</p>{{/if}}
  <ul class="tsc-upgrade-list">{{#each items}}{{> tscUpgradeItem}}{{else}}<li class="tsc-dim">{{localize "SF2eTSC.upgrades.none"}}</li>{{/each}}</ul>
  {{#if canEdit}}<div class="tsc-upgrade-picker">
    <input type="search" data-upgrade-filter="{{stationId}}" placeholder="{{localize 'SF2eTSC.upgrades.search'}}" aria-label="{{localize 'SF2eTSC.upgrades.search'}}">
    <select data-upgrade-select="{{stationId}}" aria-label="{{localize 'SF2eTSC.upgrades.choose'}}"><option value="">{{localize "SF2eTSC.upgrades.choose"}}</option>
      {{#if compatible.length}}<optgroup label="{{localize 'SF2eTSC.upgrades.compatibleGroup'}}">{{#each compatible}}<option value="{{key}}" data-search="{{search}}">{{name}} ({{localize "SF2eTSC.upgrades.level"}} {{level}})</option>{{/each}}</optgroup>{{/if}}
      {{#if override.length}}<optgroup label="{{localize 'SF2eTSC.upgrades.overrideGroup'}}">{{#each override}}<option value="{{key}}" data-search="{{search}}" data-override="1">{{name}} ({{localize "SF2eTSC.upgrades.level"}} {{level}})</option>{{/each}}</optgroup>{{/if}}
    </select>
    <button type="button" data-action="addStationUpgrade" data-station-id="{{stationId}}" {{#unless canInstall}}disabled{{/unless}}><i class="fa-solid fa-plus"></i> {{localize "SF2eTSC.upgrades.install"}}</button>
  </div>
  {{#if fullText}}<p class="tsc-dim">{{fullText}}</p>{{/if}}{{#if noCompatible}}<p class="tsc-dim">{{noCompatible}}</p>{{/if}}{{/if}}
</section>`;

/** One installed upgrade: name, level, warnings, expandable rules (open state survives re-renders). */
export const UPGRADE_ITEM_PARTIAL = `<li class="tsc-upgrade {{#if warnings.length}}has-warning{{/if}} {{#if overCapacity}}over{{/if}}">
  <details data-upgrade-details="{{id}}" {{#if open}}open{{/if}}>
    <summary><strong>{{name}}</strong> <span class="tsc-dim">{{localize "SF2eTSC.upgrades.level"}} {{level}}</span>
      {{#if overridden}}<span class="tsc-pill" data-tooltip="{{localize 'SF2eTSC.upgrades.overridden'}}"><i class="fa-solid fa-user-shield" aria-hidden="true"></i> {{localize "SF2eTSC.upgrades.override"}}</span>{{/if}}
      {{#if overCapacity}}<span class="tsc-pill bad">{{localize "SF2eTSC.upgrades.warn.capacityShort"}}</span>{{/if}}
      {{#each warnings}}<span class="tsc-warn-inline" title="{{text}}"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {{text}}</span>{{/each}}
    </summary>
    <div class="tsc-upgrade-body">{{#if html}}{{{html}}}{{else}}<p class="tsc-dim">—</p>{{/if}}</div>
  </details>
  {{#if catalogKey}}<button type="button" data-action="openUpgrade" data-key="{{catalogKey}}" aria-label="{{localize 'SF2eTSC.upgrades.openCompendium'}}" title="{{localize 'SF2eTSC.upgrades.openCompendium'}}"><i class="fa-solid fa-book-open"></i></button>{{/if}}
  {{#if isGM}}<button type="button" data-action="toggleUpgradeOverride" data-id="{{id}}" data-value="{{overridden}}" data-tooltip="{{localize 'SF2eTSC.upgrades.override'}}" aria-label="{{localize 'SF2eTSC.upgrades.override'}}" class="{{#if overridden}}active{{/if}}"><i class="fa-solid fa-user-shield"></i></button>{{/if}}
  {{#if canEdit}}<button type="button" class="danger" data-action="removeStationUpgrade" data-id="{{id}}" aria-label="{{localize 'SF2eTSC.upgrades.remove'}}" data-tooltip="{{localize 'SF2eTSC.upgrades.remove'}}"><i class="fa-solid fa-trash"></i></button>{{/if}}
</li>`;

/** Ship-level partial (escape pods + unassigned records). */
export const SHIP_UPGRADES_PARTIAL = `<section class="tsc-upgrades tsc-ship-upgrades" data-upgrade-section="ship">
  <h5 class="tsc-upgrades-head"><i class="fa-solid fa-life-ring" aria-hidden="true"></i> {{localize "SF2eTSC.upgrades.escapePods"}} <span class="tsc-pill">{{pods.length}} / 1</span></h5>
  <p class="tsc-hint">{{localize "SF2eTSC.upgrades.escapePodsHint"}}</p>
  <ul class="tsc-upgrade-list">{{#each pods}}{{> tscUpgradeItem}}{{else}}<li class="tsc-dim">{{localize "SF2eTSC.upgrades.none"}}</li>{{/each}}</ul>
  {{#if canEdit}}<div class="tsc-upgrade-picker">
    <select data-upgrade-select="ship" aria-label="{{localize 'SF2eTSC.upgrades.choose'}}"><option value="">{{localize "SF2eTSC.upgrades.choose"}}</option>{{#each podOptions}}<option value="{{key}}" data-search="{{search}}">{{name}} ({{localize "SF2eTSC.upgrades.level"}} {{level}})</option>{{/each}}</select>
    <button type="button" data-action="addStationUpgrade" data-station-id="" {{#unless canInstallPod}}disabled{{/unless}}><i class="fa-solid fa-plus"></i> {{localize "SF2eTSC.upgrades.install"}}</button>
  </div>{{/if}}
  {{#if unassigned.length}}<h5 class="tsc-upgrades-head"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {{localize "SF2eTSC.upgrades.unassigned"}}</h5>
  <p class="tsc-hint">{{localize "SF2eTSC.upgrades.unassignedHint"}}</p>
  <ul class="tsc-upgrade-list">{{#each unassigned}}{{> tscUpgradeItem}}
    {{#if ../canEdit}}<li class="tsc-upgrade-assign"><select data-upgrade-assign="{{id}}" aria-label="{{localize 'SF2eTSC.upgrades.assignTo'}}"><option value="">{{localize "SF2eTSC.upgrades.assignTo"}}</option>{{#each targets}}<option value="{{id}}" {{#if override}}data-override="1"{{/if}}>{{name}}{{#if override}} ⚠{{/if}}</option>{{/each}}</select>
      <button type="button" data-action="assignUpgrade" data-id="{{id}}"><i class="fa-solid fa-right-to-bracket"></i> {{localize "SF2eTSC.upgrades.assign"}}</button></li>{{/if}}{{/each}}</ul>{{/if}}
</section>`;

export function registerUpgradePartials(H = globalThis.Handlebars) {
  H?.registerPartial?.("tscUpgradeItem", UPGRADE_ITEM_PARTIAL);
  H?.registerPartial?.("tscStationUpgrades", STATION_UPGRADES_PARTIAL);
  H?.registerPartial?.("tscShipUpgrades", SHIP_UPGRADES_PARTIAL);
}
