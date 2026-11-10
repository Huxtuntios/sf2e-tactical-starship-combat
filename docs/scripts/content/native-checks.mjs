/** SF2e сам добавляет видимый КС; в подписи ссылки оставляем только название проверки. */
export function normalizeNativeChecks(html) {
  const token = String.raw`@Check\[[^\]]+\](?:\{[^}]*\})?`;
  const normalize = (text) => {
    let previous;
    do {
      previous = text;
      text = text.replace(new RegExp(String.raw`\(\s*(${token})\s*\)`, "g"), "$1");
    } while (text !== previous);
    return text.replace(/@Check\[([^\]]+)\]\{([^}]*)\}/g, (match, params, label) => {
      const dc = params
        .split("|")
        .find((part) => /^dc:-?\d+$/.test(part))
        ?.slice(3);
      if (dc === undefined) return match;
      const clean = label.replace(new RegExp(String.raw`^(?:DC|КС)\s*${dc}(?:\s+|$)`, "i"), "");
      return `@Check[${params}]${clean ? `{${clean}}` : ""}`;
    });
  };
  // Не изменяем HTML-атрибуты, в которых может храниться исходный текст.
  return String(html ?? "")
    .split(/(<[^>]*>)/g)
    .map((part, index) => (index % 2 ? part : normalize(part)))
    .join("");
}
