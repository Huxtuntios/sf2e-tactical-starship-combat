import { request } from "../socket.mjs";
import { ICONS, LEGACY_ICONS } from "../content/ship-docs.mjs";

/** Open Foundry's FilePicker and change the actor portrait ("img") or its prototype token image ("token"). */
export function pickActorImage(actor, target = "img") {
  const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const current = target === "token" ? actor.prototypeToken?.texture?.src : actor.img;
  const fp = new FP({ type: "image", current, callback: (path) => setActorImage(actor, path, target) });
  return fp.render?.(true) ?? fp.browse?.();
}

/** Owners update directly; others go through the GM (permission checked there). */
export async function setActorImage(actor, path, target = "img") {
  if (actor.isOwner) return actor.update(imageUpdate(actor, path, target));
  return request("actorBasics", {
    actorUuid: actor.uuid,
    img: target === "img" ? path : undefined,
    tokenImg: target === "token" ? path : undefined
  });
}

/** Changing the portrait also changes the token image while the token still uses the old portrait / a default icon. */
export function imageUpdate(actor, path, target) {
  if (target === "token") return { "prototypeToken.texture.src": path };
  const tok = actor.prototypeToken?.texture?.src;
  const followToken =
    !tok || tok === actor.img || LEGACY_ICONS.includes(tok) || Object.values(ICONS).includes(tok) || tok === "icons/svg/mystery-man.svg";
  return { img: path, ...(followToken ? { "prototypeToken.texture.src": path } : {}) };
}
