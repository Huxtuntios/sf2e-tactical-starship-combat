from paths import INPUT
import re, json, sys

src = open(sys.argv[1], encoding="utf8").read().replace("\r", "")
aon = {h["_source"]["name"]: h["_source"] for h in json.load(open(str(INPUT / "aon-upgrades.json"), encoding="utf-8"))["hits"]["hits"]}
blocks = [b.strip() for b in src.split("SFS Standard") if b.strip()]
GRADES = ["Commercial", "Tactical", "Advanced", "Superior", "Elite", "Ultimate", "Paragon"]
COST = {"one-action": 1, "two-actions": 2, "three-actions": 3, "free-action": "free", "reaction": "reaction"}
STATION = {
    "installed in a pilot’s console": "pilot",
    "installed in a generator": "generator",
    "installed in a generator on a starship with a ramming prow": "generator",
    "installed in a gunnery": "gunnery",
    "installed in scanners": "scanners",
    "installed in a magic conduit": "magic-conduit",
    "installed in a drone console": "drone-console",
    "replace default escape pods": None,
}
ACT = re.compile(r"^Activate \[([a-z-]+)\] \(([^)]*)\)(.*)$")


def parse_act(line):
    m = ACT.match(line)
    cost, traits, rest = m.groups()
    parts = [p.strip() for p in rest.split("; ")]
    a = {"name": parts[0], "cost": COST[cost], "traits": [t.strip().lower() for t in traits.split(",")]}
    for p in parts[1:]:
        for k in ("Frequency", "Trigger", "Requirements", "Effect"):
            if p.startswith(k + " "):
                a[k.lower()] = p[len(k) + 1 :]
                break
        else:
            a["effect"] = (a.get("effect", "") + "; " + p).strip("; ")
    a["details"] = []
    return a


DETAIL = re.compile(
    r"^(Critical Success|Success|Critical Failure|Failure|Graviton-Attuned|Photon-Attuned|[A-Z][a-z]+ [A-Z][a-z]+ \([a-z’' ]+\)) (.*)$"
)


def split_detail(l):
    m = DETAIL.match(l)
    return {"label": m.group(1), "text": m.group(2)} if m else {"label": "", "text": l}


def body(lines):
    text, acts = [], []
    for l in lines:
        if l.startswith("Activate ["):
            acts.append(parse_act(l))
        elif acts:
            acts[-1]["details"].append(split_detail(l))
        else:
            text.append(l)
    return text, acts


out = []
ids_old = {u["name"].replace("’", "'"): u["id"] for u in json.load(open(sys.argv[2], encoding="utf-8"))["upgrades"]}
ids_old["Starship Weapon Crystal"] = "weapon-crystal"
for b in blocks:
    lines = [l.strip() for l in b.split("\n") if l.strip()]
    name = lines[0]
    lvl = lines[1]
    i = 2
    traits = []
    while not lines[i].startswith("Source"):
        traits.append(lines[i].lower())
        i += 1
    page = int(re.search(r"pg\. (\d+)", lines[i]).group(1))
    i += 1
    usage = lines[i][len("Usage ") :]
    i += 1
    # split variant sections
    rest = lines[i:]
    base_lines = []
    variants = []
    cur = None
    j = 0
    while j < len(rest):
        l = rest[j]
        m = re.match(r"^(.*) \((%s)\)$" % "|".join(GRADES), l)
        if m and m.group(1) == name and j + 2 < len(rest) and rest[j + 1].startswith("Item "):
            cur = {
                "grade": m.group(2).lower(),
                "name": l,
                "level": int(rest[j + 1].split()[1]),
                "page": int(re.search(r"pg\. (\d+)", rest[j + 2]).group(1)),
                "lines": [],
            }
            variants.append(cur)
            j += 3
            continue
        (cur["lines"] if cur else base_lines).append(l)
        j += 1
    text, acts = body(base_lines)
    a = aon[name]
    assert a["level"] == int(lvl.split()[1].rstrip("+")), name
    assert [t.lower() for t in a["trait"]] == traits, (name, a["trait"], traits)
    assert a["primary_source_raw"].endswith(f"pg. {page}"), name
    assert STATION[usage] if usage != "replace default escape pods" else True
    if not text and name == "Interplanar Pod":
        text = [re.sub(r"\s+", " ", re.sub(r"_|\[([^\]]+)\]\([^)]*\)", lambda m: m.group(1) or "", a["markdown"].split("---")[-1])).strip()]
    uid = ids_old.get(name) or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    e = {
        "id": uid,
        "name": name,
        "level": int(lvl.split()[1].rstrip("+")),
        "scales": lvl.endswith("+"),
        "station": STATION[usage],
        "slot": "escape-pods" if STATION[usage] is None else "station",
        "usage": usage[0].upper() + usage[1:],
        "traits": traits,
        "rarity": a["rarity"],
        "source": {"book": "Starfinder Tech Core", "page": page},
        "text": text,
        "activations": acts,
    }
    if variants:
        vv = []
        for v in variants:
            vt, va = body(v["lines"])
            assert v["name"] in aon and aon[v["name"]]["level"] == v["level"], v["name"]
            vv.append({"grade": v["grade"], "name": v["name"], "level": v["level"], "page": v["page"], "text": vt, "activations": va})
        e["variants"] = vv
    out.append(e)
print(len(out), sum(len(e.get("variants", [])) for e in out), file=sys.stderr)
names = set([e["name"] for e in out] + [v["name"] for e in out for v in e.get("variants", [])])
print("AoN not covered:", set(aon) - names, file=sys.stderr)
json.dump(out, open(sys.argv[3], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
