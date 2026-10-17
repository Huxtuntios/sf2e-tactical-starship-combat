from paths import WORK
import re, json

raw = open(WORK / "ships_stream.txt", encoding="utf-8").read()
# split into blocks keeping markers
items = []
page = None
col = None
for chunk in raw.split("\n@@B"):
    lines = chunk.strip("\n").split("\n")
    keep = []
    for l in lines:
        if l.startswith("@@PAGE"):
            page = int(l.split()[1])
            continue
        if l.startswith("@@COL"):
            col = int(l.split()[1])
            continue
        if l.strip():
            keep.append(l)
    if keep:
        items.append({"page": page, "col": col, "text": "\n".join(keep)})
json.dump(items, open(WORK / "blocks.json", "w", encoding="utf-8"))
for i, b in enumerate(items):
    if b["text"].startswith("Perception"):
        nxt = items[i + 1] if i + 1 < len(items) else None
        print(
            i,
            b["page"],
            b["col"],
            "| LAST:",
            b["text"].split("\n")[-1][:60],
            "|| NEXT:",
            (nxt["page"], nxt["col"], nxt["text"].split("\n")[0][:50]) if nxt else None,
        )
