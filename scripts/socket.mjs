import { SOCKET_EVENT } from "./constants.mjs";
import { log } from "./utils/logging.mjs";
import { isActiveGM, activeGM } from "./utils/foundry.mjs";

/**
 * Authoritative request/response over Foundry's native socket (no socketlib).
 * Players send intents; the active GM validates, updates documents and answers. Documents broadcast the new state.
 *
 * Security model (0.4.0): the identity of the sender is NEVER taken from the message body. Foundry's server appends
 * the id of the user whose socket emitted the message as an extra argument of the `game.socket.on` callback
 * (the sf2e system relies on the same behaviour). Messages without a server-provided sender are rejected.
 * Responses and one-way events are only accepted from a GM sender.
 */
const handlers = new Map();
const pending = new Map();
const TIMEOUT_MS = 15000;

export function registerHandler(type, fn) {
  handlers.set(type, fn);
}
/** Resolve the authenticated sender. Body fields (`msg.userId`) are ignored on purpose. */
export function senderOf(senderId, users = globalThis.game?.users) {
  if (typeof senderId !== "string" || !senderId) return null;
  return users?.get?.(senderId) ?? null;
}

/**
 * Pure-ish dispatcher used by the socket listener (exported for regression tests).
 * @param {object} msg       message body as sent by the emitting client
 * @param {string} senderId  user id appended by the Foundry server
 * @param {object} env       { users, selfId, isActiveGM, emit, clientEvents }
 */
export async function dispatchSocketMessage(msg, senderId, env) {
  if (!msg || typeof msg !== "object") return;
  const sender = senderOf(senderId, env.users);
  if (msg.kind === "request") {
    if (!env.isActiveGM) return;
    if (!sender) {
      log.warn(`request ${msg.type} dropped: sender could not be authenticated`);
      if (msg.requestId && typeof msg.userId === "string")
        env.emit({ kind: "response", requestId: msg.requestId, to: msg.userId, ok: false, error: "Unauthenticated request" });
      return;
    }
    if (msg.userId && msg.userId !== sender.id)
      log.warn(`request ${msg.type}: claimed user ${msg.userId} ≠ real sender ${sender.id}; claim ignored`);
    const fn = handlers.get(msg.type);
    let res;
    if (!fn) res = { ok: false, error: `Unknown request type ${msg.type}` };
    else {
      try {
        res = { ok: true, result: await fn({ userId: sender.id, user: sender, payload: msg.payload ?? {}, remote: true }) };
      } catch (err) {
        log.warn(`request ${msg.type} rejected`, err);
        res = { ok: false, error: err.message };
      }
    }
    env.emit({ kind: "response", requestId: msg.requestId, to: sender.id, ...res });
  } else if (msg.kind === "response") {
    if (msg.to !== env.selfId) return;
    if (!sender?.isGM) {
      log.warn("response ignored: not sent by a GM");
      return;
    }
    const p = pending.get(msg.requestId);
    if (p) {
      pending.delete(msg.requestId);
      clearTimeout(p.timer);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
    }
  } else if (msg.kind === "event") {
    if (!sender?.isGM) {
      log.warn(`event ${msg.type} ignored: not sent by a GM`);
      return;
    }
    const fn = env.clientEvents.get(msg.type);
    if (fn && (!msg.to || msg.to === env.selfId)) fn(msg.payload);
  }
}

export function initSocket() {
  game.socket.on(SOCKET_EVENT, async (msg, senderId) => {
    try {
      await dispatchSocketMessage(msg, senderId, {
        users: game.users,
        selfId: game.user.id,
        isActiveGM: isActiveGM(),
        clientEvents,
        emit: (m) => game.socket.emit(SOCKET_EVENT, m)
      });
    } catch (err) {
      log.error("socket handler error", err);
    }
  });
}

/** Send an intent to the GM (executes locally when this client is the active GM). */
export async function request(type, payload = {}) {
  if (isActiveGM()) {
    const fn = handlers.get(type);
    if (!fn) throw new Error(`Unknown request type ${type}`);
    return fn({ userId: game.user.id, user: game.user, payload, remote: false });
  }
  if (!activeGM()) throw new Error(game.i18n.localize("SF2eTSC.errors.noGM"));
  const requestId = foundry.utils.randomID(12);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(game.i18n.localize("SF2eTSC.errors.timeout")));
    }, TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    // userId is informational only; the GM uses the server-provided sender id.
    game.socket.emit(SOCKET_EVENT, { kind: "request", requestId, type, payload, userId: game.user.id });
  });
}

/** Test hook: register a pending request id (used by regression tests only). */
export function _trackPending(requestId, resolve, reject) {
  pending.set(requestId, { resolve, reject, timer: null });
}

/** One-way events pushed from the GM to clients (e.g. reaction prompts). */
const clientEvents = new Map();
export function onClientEvent(type, fn) {
  clientEvents.set(type, fn);
}
export function emitClientEvent(type, payload, to = null) {
  if (!game.user.isGM) throw new Error("emitClientEvent is GM-only");
  game.socket.emit(SOCKET_EVENT, { kind: "event", type, payload, to });
  if (!to || to === game.user.id) clientEvents.get(type)?.(payload);
}
