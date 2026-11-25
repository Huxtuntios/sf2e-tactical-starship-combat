import { DEGREE_KEYS, MODULE_ID } from "../constants.mjs";
import { ct } from "../content/content-i18n.mjs";
import { T } from "../utils/foundry.mjs";
import { CARD_DATA_FLAG, actionResultFlag, renderStoredCard, withToolbeltTargets } from "./card.mjs";

async function post({ actor = null, content = "", whisperGM = false, flags = {}, cardData = null, targetUUIDs = [] }) {
  const moduleFlags = { card: true, ...flags };
  if (cardData) moduleFlags[CARD_DATA_FLAG] = cardData;
  const data = {
    content: content || renderStoredCard({ flags: { [MODULE_ID]: moduleFlags } }),
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    flags: { [MODULE_ID]: moduleFlags }
  };
  if (whisperGM) data.whisper = ChatMessage.getWhisperRecipients("GM").map((user) => user.id);
  withToolbeltTargets(data, targetUUIDs);
  return ChatMessage.create(data);
}

export async function postSimpleCard({ actor, title, body, whisperGM = false }) {
  return post({
    actor,
    whisperGM,
    cardData: { kind: "simple", initiator: actor?.name ?? "", title, bodyHtml: body }
  });
}

function degreeFromLabel(degreeLabel) {
  const label = String(degreeLabel ?? "").trim();
  if (!label) return null;
  const degree = DEGREE_KEYS.findIndex((key) => T(`SF2eTSC.degree.${key}`) === label);
  return degree < 0 ? null : degree;
}

export async function postActionCard({
  actor,
  action,
  crewName,
  stationName,
  degreeLabel,
  degree = degreeFromLabel(degreeLabel),
  result = null,
  lines = [],
  reports = [],
  manual = [],
  targetUUIDs = [],
  whisperGM = false
}) {
  const rolledDegree = Number.isInteger(degree) && DEGREE_KEYS[degree] ? degree : null;
  return post({
    actor,
    whisperGM,
    targetUUIDs,
    flags: {
      actionResultText: actionResultFlag({ degreeLabel, degree: rolledDegree, outcomes: action?.outcomes, result, lines, reports, manual })
    },
    cardData: {
      kind: "action",
      initiator: actor?.name ?? "",
      action: { id: action?.id ?? "", name: action?.name ?? "", outcomes: action?.outcomes ?? null },
      crewName,
      stationName,
      degreeLabel,
      degree: rolledDegree,
      result: result ?? null,
      lines,
      reports,
      manual,
      targetUUIDs: [...new Set((Array.isArray(targetUUIDs) ? targetUUIDs : []).filter((uuid) => typeof uuid === "string" && uuid))]
    }
  });
}

export async function postDamageCard({
  actor,
  source,
  result,
  attackLine = null,
  undoRef = null,
  targetUUIDs = [],
  damageType = null,
  parts = null
}) {
  return post({
    actor,
    targetUUIDs,
    flags: { damage: result },
    cardData: {
      kind: "damage",
      initiator: actor?.name ?? "",
      source,
      result,
      attackLine,
      undoRef,
      targetUUIDs,
      damageType,
      parts
    }
  });
}

export async function postHazardCard({ hazard, zone, effectText, title }) {
  return post({
    cardData: { kind: "hazard", hazardName: hazard?.name ?? "", zone, title, effectText: ct(effectText) }
  });
}

export async function postIntegrityCard({ actor, dc, degreeLabel, delta, newValue, outcomeText }) {
  return post({
    actor,
    cardData: { kind: "integrity", initiator: actor?.name ?? "", dc, degreeLabel, delta, newValue, outcomeText }
  });
}

export { CARD_DATA_FLAG };
