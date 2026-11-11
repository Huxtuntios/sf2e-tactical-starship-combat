/** One display image per retained background layer; no world writes or global image cache. */
export const MAP_BACKGROUND_LIMIT = 4096;
export const MAP_BACKGROUND_TIMEOUT = 15000;
const layers = new WeakMap();
const cssSource = (src) => (src ? `url(${JSON.stringify(src)})` : "none");
const revisionSource = (source, revision) => {
  if (!revision) return source;
  const [path, fragment] = source.split("#", 2);
  return `${path}${path.includes("?") ? "&" : "?"}tsc-map-revision=${encodeURIComponent(revision)}${fragment ? `#${fragment}` : ""}`;
};

function release(state) {
  state.cancel?.();
  state.cancel = null;
  if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  state.blobUrl = null;
}

function loadImage(state, source) {
  return new Promise((resolve) => {
    const image = new Image();
    let timer;
    const finish = (ok) => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      state.cancel = null;
      if (ok) resolve(image);
      else {
        image.src = "";
        resolve(null);
      }
    };
    state.cancel = () => finish(false);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    timer = setTimeout(() => finish(false), MAP_BACKGROUND_TIMEOUT);
    image.src = source;
    if (image.complete && image.naturalWidth) finish(true);
  });
}

function encode(canvas, state) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (blob) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      state.cancel = null;
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), MAP_BACKGROUND_TIMEOUT);
    state.cancel = () => finish(null);
    try {
      canvas.toBlob(finish, "image/png"); // lossless encoding, never a data URL
    } catch (error) {
      clearTimeout(timer);
      state.cancel = null;
      reject(error);
    }
  });
}

async function prepare(layer, state) {
  const current = () => layers.get(layer) === state;
  const loadSource = revisionSource(state.source, state.revision);
  const image = await loadImage(state, loadSource);
  if (!image) {
    if (current()) {
      layer.dataset.backgroundState = "error";
      layer.dataset.backgroundWarning = "load-failed-or-timeout";
    }
    return;
  }
  let canvas;
  let display = loadSource;
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  state.originalWidth = width;
  state.originalHeight = height;
  let warning = "";
  try {
    if (!current()) return;
    if (Math.max(width, height) > MAP_BACKGROUND_LIMIT) {
      const ratio = MAP_BACKGROUND_LIMIT / Math.max(width, height);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas-unavailable");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, width, height);
      image.src = ""; // release the original decoded image after drawing
      const blob = await encode(canvas, state);
      if (!current()) return;
      if (!blob) throw new Error("encode-failed-or-timeout");
      state.blobUrl = URL.createObjectURL(blob);
      display = state.blobUrl;
    }
  } catch {
    // Tainted cross-origin canvas or unavailable encoding: native display, with local warning metadata.
    warning = "native-fallback";
    width = state.originalWidth;
    height = state.originalHeight;
  } finally {
    image.onload = image.onerror = null;
    image.src = "";
    if (canvas) canvas.width = canvas.height = 0;
  }
  if (!current()) return;
  layer.style.backgroundImage = cssSource(display);
  layer.dataset.backgroundState = warning ? "native" : state.blobUrl ? "scaled" : "original";
  layer.dataset.backgroundWarning = warning;
  layer.dataset.backgroundWidth = String(width);
  layer.dataset.backgroundHeight = String(height);
}

/** Synchronous paint contract; asynchronous preparation is observed with backgroundReady(). */
export function paintMapBackground(layer, source = "", revision = 0) {
  const previous = layers.get(layer);
  if (previous?.source === source && previous.revision === revision) return;
  if (previous) release(previous);
  const state = { source, revision, blobUrl: null, cancel: null };
  layers.set(layer, state);
  layer.dataset ??= {};
  layer.dataset.backgroundSource = source;
  layer.dataset.backgroundWarning = "";
  layer.dataset.backgroundState = source ? "loading" : "empty";
  // A cloned previously-painted layer can retain its already-chosen display while loading.
  // Production rerenders retain the node itself, and never enter this path for an unchanged source.
  if (previous || !source) layer.style.backgroundImage = "none";
  if (source && typeof Image !== "function") {
    // Non-browser hosts cannot inspect dimensions; keep the synchronous native paint fallback.
    layer.style.backgroundImage = cssSource(revisionSource(source, revision));
    layer.dataset.backgroundState = "native";
    layer.dataset.backgroundWarning = "image-api-unavailable";
    state.ready = Promise.resolve();
  } else state.ready = source ? prepare(layer, state) : Promise.resolve();
}

export function backgroundReady(layer) {
  return layers.get(layer)?.ready ?? Promise.resolve();
}

export function releaseMapBackground(layer) {
  const state = layers.get(layer);
  layers.delete(layer); // obsolete async completions cannot repaint or create a retained blob
  if (state) release(state);
  if (layer) {
    layer.style.backgroundImage = "none";
    layer.dataset.backgroundState = "disposed";
  }
}
