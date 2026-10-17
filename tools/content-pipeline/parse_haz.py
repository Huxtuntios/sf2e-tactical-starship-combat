from paths import INPUT, ROOT, WORK
import re, json

raw = open(str(WORK / "haz_stream.txt"), encoding="utf-8").read()
B = []
page = None
for chunk in raw.split("\n@@B"):
    keep = []
    for l in chunk.strip("\n").split("\n"):
        if l.startswith("@@PAGE"):
            page = int(l.split()[1])
            continue
        if l.startswith("@@COL"):
            continue
        if l.strip():
            keep.append(l)
    if keep:
        B.append(dict(page=page, text="\n".join(keep)))
old = json.load(open(str(ROOT / "data" / "hazards" / "hazards.json"), encoding="utf-8"))["hazards"]
names = {h["name"].upper(): h for h in old}
G = {"Ȱɵ": 1, "ʚʖ": 2, "̂ˬ": 3, "Ǻȓ": "reaction", "Ȳ˓": "free"}
GR = "(?:" + "|".join(map(re.escape, G)) + ")"
KEY = re.compile(
    r"^(Stealth|Description|Disable|AC \d|HP \d|Hardness|Routine|Reset|Critical Success|Success|Failure|Critical Failure|Melee|Ranged|Asteroid|Mine|Immunities|Weaknesses|Resistances)\b"
)
st = [i for i, b in enumerate(B) if b["text"].startswith("Stealth")]
used = set()
out = []


def norm(t):
    return re.sub(r"\s+", " ", t).upper().strip()


for n, i in enumerate(st):
    nxt = st[n + 1] if n + 1 < len(st) else len(B)
    name = None
    for j in list(range(i - 1, max(-1, i - 9), -1)) + list(range(i + 1, min(len(B), i + 4))):
        t = norm(B[j]["text"])
        if t in names and t not in used:
            name = t
            break
    if not name:
        print("NO NAME at", B[i]["page"], B[i]["text"][:60])
        continue
    used.add(name)
    lvl = None
    traits = None
    for j in range(max(0, i - 6), min(len(B), i + 3)):
        m = re.match(r"^HAZARD (-?\d+)$", B[j]["text"])
        if m and lvl is None and abs(j - i) <= 3:
            lvl = int(m.group(1))
    txt = [B[i]["text"]]
    for j in range(i + 1, nxt):
        t = B[j]["text"]
        if norm(t) in names or re.match(r"^HAZARD -?\d+$", t) or t == "Tech CORE":
            continue
        if t.upper() == t:
            continue
        if KEY.match(t) or re.search(GR, t.split("\n")[0]) or t[:1].islower():
            txt.append(t)
    out.append(dict(name=name, page=B[i]["page"], level=lvl, text="\n".join(txt)))
print(len(out), "missing", set(names) - used)
json.dump(out, open(str(WORK / "haz_blocks.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

# ---- AoN hazards
L = open(str(INPUT / "haz_aon.txt"), encoding="utf-8").read().split("\n")
aon = {}
for i, l in enumerate(L):
    if re.match(r"^Hazard -?\d+$", l) and L[i - 1] and not L[i - 1].startswith("Hazard"):
        nm = L[i - 1]
        j = i + 1
        tr = []
        while not L[j].startswith("Source"):
            if L[j] and L[j] not in tr:
                tr.append(L[j])
            j += 1
        page = int(re.search(r"pg\. (\d+)", L[j]).group(1))
        body = []
        k = j + 1
        while k < len(L) and not (k + 1 < len(L) and re.match(r"^Hazard -?\d+$", L[k + 1])):
            if L[k].strip():
                body.append(L[k])
            k += 1
        aon[nm] = dict(name=nm, level=int(l.split()[1]), traits=[t.lower() for t in tr], page=page, body=body)
print("aon hazards", len(aon))


def desc_of(text):
    m = re.search(r"Description (.{0,50})", text.replace("\n", " "))
    return m.group(1) if m else ""


for h in out:
    d = desc_of(h["text"])[:40]
    hit = [a for a in aon.values() if d and any(d in x for x in a["body"])]
    h["aon"] = hit[0]["name"] if hit else None
# rename pdf segments matched to AoN names
for h in out:
    if h["aon"] and h["aon"].upper() != h["name"]:
        print("RENAME", h["name"], "->", h["aon"].upper())
        h["name"] = h["aon"].upper()
from collections import Counter

c = Counter(h["name"] for h in out)
print("dups", [k for k, v in c.items() if v > 1])
print("nomatch", [h["name"] for h in out if not h["aon"]])
json.dump(out, open(str(WORK / "haz_blocks.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
json.dump(aon, open(str(WORK / "haz_aon.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
