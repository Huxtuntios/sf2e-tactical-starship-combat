import re, subprocess, sys, html, tempfile
from pathlib import Path

if len(sys.argv) != 5:
    raise SystemExit("Usage: python extract_stream.py PDF FIRST LAST OUT")
P = sys.argv[1]
first, last, out = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
NAV = set("INTRODUCTION TECH ANCESTRIES".split())
res = []
with tempfile.TemporaryDirectory() as tmp:
    for p in range(first, last + 1):
        subprocess.run(["pdftotext", "-bbox-layout", "-f", str(p), "-l", str(p), P, str(Path(tmp) / "page.html")], check=True)
        s = open(str(Path(tmp) / "page.html"), encoding="utf8").read()
        blocks = []
        for m in re.finditer(r'<block xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</block>', s, re.S):
            x0, y0, x1, y1 = map(float, m.groups()[:4])
            lines = []
            for lm in re.finditer(r"<line[^>]*>(.*?)</line>", m.group(5), re.S):
                ws = [html.unescape(w) for w in re.findall(r">([^<]+)</word>", lm.group(1))]
                lines.append(" ".join(ws))
            txt = "\n".join(lines)
            if y0 > 740:
                continue  # page numbers / footer
            if x0 > 545 or x1 < 75:
                continue  # nav sidebar
            if x1 - x0 < 10:
                continue
            col = 0 if x0 < 305 else 1
            blocks.append((col, y0, x0, txt))
        blocks.sort()
        res.append(f"\n@@PAGE {p-1}\n")
        lastcol = None
        for col, y0, x0, txt in blocks:
            if col != lastcol:
                res.append(f"@@COL {col}")
                lastcol = col
            res.append(txt)
            res.append("@@B")
open(out, "w", encoding="utf-8").write("\n".join(res))
