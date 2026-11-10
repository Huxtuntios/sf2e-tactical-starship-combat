from paths import OUTPUT, ROOT, WORK
from pathlib import Path
import json, re, glob, collections

A = json.load(open(str(WORK / "aon_ships.json"), encoding="utf-8"))
P = json.load(open(str(WORK / "pdf_ships.json"), encoding="utf-8"))
OUT = str(OUTPUT / "starships") + "/"
SEED = str(ROOT / "data" / "starships") + "/"
old = {}
files = collections.OrderedDict()
for f in sorted(glob.glob(SEED + "*.json")):
    j = json.load(open(f, encoding="utf-8"))
    files[Path(f).name] = j["faction"]
    for s in j["ships"]:
        old[s["name"].lower()] = (Path(f).name, j["faction"], s["id"])


def aon_stats(body):
    t = "\n".join(body)
    r = {}
    m = re.search(r"Perception \+(\d+)", t)
    r["perception"] = int(m.group(1)) if m else None
    m = re.search(r"Sensor Range (\d+)", t)
    r["sensorRange"] = int(m.group(1)) if m else None
    for k, p in (
        ("ac", r"^AC (\d+)"),
        ("fort", r"^Fort \+(\d+)"),
        ("ref", r"^Ref \+(\d+)"),
        ("will", r"^Will \+(\d+)"),
        ("hp", r"^HP (\d+)"),
        ("speed", r"^Speed (\d+)"),
    ):
        m = re.search(p, t, re.M)
        r[k] = int(m.group(1)) if m else None
    m = re.search(r"SP (\d+)", t)
    r["sp"] = int(m.group(1)) if m else 0
    m = re.search(r"fortify (\d+)", t)
    r["fortify"] = int(m.group(1)) if m else 0
    m = re.search(r"^Battle Stations (.*)$", t, re.M)
    r["stationsText"] = m.group(1) if m else ""
    r["strikes"] = []
    for m in re.finditer(r"^(Ranged|Melee) \[[a-z-]+\] (.+?) \+(\d+), (.*)$", t, re.M):
        x = (m.group(2), int(m.group(3)), m.group(4))
        if x not in r["strikes"]:
            r["strikes"].append(x)
    r["actions"] = {}
    COST = {"one-action": 1, "two-actions": 2, "three-actions": 3, "reaction": "reaction", "free-action": "free"}
    for l in body:
        m = re.match(r"^([A-Z][^\[]{1,50}?) \[([a-z-]+)\]\s*(?:\(([^)]*)\))?\s*(.*)$", l)
        if m and not l.startswith(("Ranged", "Melee")):
            r["actions"][m.group(1).lower()] = dict(
                name=m.group(1),
                cost=COST.get(m.group(2)),
                traits=[x.strip() for x in (m.group(3) or "").split(",") if x.strip()],
                text=m.group(4),
            )
    return r


STYPE = {
    "pilot's console": "pilot",
    "pilot’s console": "pilot",
    "generator": "generator",
    "gunnery": "gunnery",
    "scanners": "scanners",
    "scanner": "scanners",
    "magic conduit": "magic-conduit",
    "drone console": "drone-console",
}


def stations(text):
    out = []
    for m in re.finditer(r"([a-zA-Z’\' ]+?)\s*\(([^()]*)\)", text):
        lab = m.group(1).strip(" ,").lower()
        acts = []
        for a in m.group(2).split(","):
            a = a.strip()
            if not a:
                continue
            acts.append(
                dict(name=a.strip("* ").replace("  ", " "), unique=a[0].isupper() and a.strip("* ") not in GENERIC, shared=a.endswith("*"))
            )
        base = re.sub(r" [ab]$", "", lab)
        typ = STYPE.get(lab) or STYPE.get(base) or ("pilot" if base == "pilot console" else "custom")
        st = dict(type=typ, actions=acts)
        if typ == "custom" or base != lab:
            st["label"] = lab.title()
        out.append(st)
    return out


GENERIC = {
    "Stick to Cover",
    "Boost Thrusters",
    "Change Heading",
    "Fortify Shield Points",
    "Fortify Shields",
    "Seek Starships",
    "Repair Self",
    "Engaged Strike",
    "Tractor Beam",
    "Area Fire",
    "Auto-Fire",
}


def slug(s):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


used = set()
ships = []
report = []
aon_by_name = {s["name"]: s for s in A["ships"]}
fam_of = {}
for f in A["families"].values():
    for m in f["members"]:
        fam_of.setdefault(m, f["name"])
for a in A["ships"]:
    st = aon_stats(a["body"])
    cand = (
        [i for i, p in enumerate(P) if i not in used and p.get("perception") == st["perception"] and p.get("hp") == st["hp"]]
        or [i for i, p in enumerate(P) if i not in used and p.get("perception") == st["perception"] and p.get("ac") == st["ac"]]
        or [i for i, p in enumerate(P) if i not in used and p.get("perception") == st["perception"] and abs(p["page"] - a["page"]) <= 1]
    )
    issues = []
    if not cand:
        issues.append("no PDF statblock matched")
        p = {}
    else:
        if len(cand) > 1:
            cand.sort(key=lambda i: abs(P[i]["page"] - a["page"]))
        p = P[cand[0]]
        used.add(cand[0])

    def pick(k):
        pv = p.get(k)
        av = st.get(k)
        if pv is not None and av is not None and pv != av:
            issues.append(f"{k}: PDF {pv} vs AoN {av} (PDF used)")
        return pv if pv is not None else av

    f, fac, oid = old[a["name"].lower()]
    s = dict(id=oid, name=a["name"], level=a["level"], size=a["size"], rarity="common", traits=[t for t in a["traits"]])
    for r in ("rare", "uncommon", "unique"):
        if r in s["traits"]:
            s["rarity"] = r
            s["traits"].remove(r)
    s["faction"] = fac
    s["family"] = fam_of.get(a["name"])
    for k in ("perception", "sensorRange"):
        s[k] = pick(k)
    s["speed"] = pick("speed")
    if s["speed"] is None:
        issues.append("no Speed in statblock (immobile or omitted); module default by size applies")
    s["skills"] = p.get("skills", {})
    s["abilities"] = p.get("abilities", {})
    for k in ("ac", "fort", "ref", "will", "hp"):
        s[k] = pick(k)
    s["sp"] = pick("sp") or 0
    s["fortify"] = pick("fortify") or 0
    for k in ("immunities", "resistances", "weaknesses", "hpNote", "speedNote", "saveNote"):
        if p.get(k):
            s[k] = p[k]
    stext = p.get("stationsText") or st["stationsText"]
    s["stations"] = stations(stext)
    # strikes
    strikes = p.get("strikes", [])
    if not strikes and st["strikes"]:
        strikes = [dict(name=n, kind="ranged", attack=at, traits=[], damage=d) for n, at, d in st["strikes"]]
        issues.append("strikes from AoN (no traits/range)")
    for x in strikes:
        if x["kind"] == "ranged" and not any("range" in t for t in x["traits"]):
            issues.append(f"strike {x['name']}: no range increment in statblock")
    s["strikes"] = strikes
    s["_aon"] = st["strikes"]
    acts = []
    for x in p.get("actions", []):
        acts.append(dict(name=x["name"], cost=x["cost"], traits=x["traits"], text=re.sub(r"\s+", " ", x["text"]).strip()))
    stn_all = {x["name"].lower(): x["name"] for sx in stations(p.get("stationsText") or st["stationsText"]) for x in sx["actions"]}
    for x in acts:
        if x["name"] == "Auto Fire":
            x["name"] = "Auto-Fire"
        if x["name"] in ("Area Fire", "Auto-Fire"):
            norm = lambda z: re.sub(r"\s*×\d+$", "", z).rstrip("s")
            wm = re.match(r"^([a-z][\w’\' -]*?)\s*\(", x["text"])
            wn = next((v for k, v in stn_all.items() if wm and norm(k) == norm(wm.group(1).lower())), None)
            if wn:
                x["mode"] = slug(x["name"])
                x["weapon"] = wm.group(1)
                x["name"] = wn
                x["text"] = x["text"][len(wm.group(1)) :].strip()
    names = {x["name"].lower() for x in acts}
    for k, x in st["actions"].items():
        if x["name"] in ("Area Fire", "Auto-Fire"):
            wn = x["text"].split(",")[0].strip().lower()
            nz = lambda z: re.sub(r"\s*×\d+$", "", z).rstrip("s")
            if any(y.get("mode") and nz(y["name"].lower()) == nz(wn) for y in acts):
                continue
            tgt = next((v for kk, v in stn_all.items() if nz(kk) == nz(wn)), None)
            if tgt and tgt.lower() not in names:
                acts.append(dict(x, name=tgt, mode=slug(x["name"]), weapon=wn, source="aon"))
                names.add(tgt.lower())
            continue
        if k not in names:
            acts.append(dict(x, source="aon"))
            names.add(k)
    # family common actions referenced
    fam = A["families"].get(s["family"] or "") or A["families"].get(fac) or {}
    if not fam.get("common") and A["families"].get(fac):
        fam = A["families"][fac]
    for c in fam.get("common", []):
        hit = [x for x in acts if x["name"].lower() == c["name"].lower()]
        if hit:
            for h in hit:
                h["familyText"] = c["text"]
                if not h["traits"]:
                    h["traits"] = c["traits"]
                if h["cost"] is None:
                    h["cost"] = c["cost"]
    for c in fam.get("common", []):
        if c["name"].lower() in stn_all and c["name"].lower() not in {x["name"].lower() for x in acts}:
            acts.append(dict(name=c["name"], cost=c["cost"], traits=c["traits"], text=c["text"], source="family"))
    s["actions"] = acts
    # station action coverage
    stnames = {x["name"].lower() for sx in s["stations"] for x in sx["actions"]}
    strn = {x["name"].lower() for x in strikes}
    for n in stnames:
        if n not in names and n not in strn and n.title() not in GENERIC and n not in {g.lower() for g in GENERIC}:
            issues.append(f'station action "{n}" has no text (weapon/area entry?)')
    s["source"] = dict(book="Starfinder Tech Core", page=a["page"])
    s["needsReview"] = bool([i for i in issues if not i.startswith("station action")])
    s["review"] = issues
    ships.append((f, s))
    report.append((s["name"], issues))


# relocate actions that were captured by a neighbouring statblock
def stn(s):
    return {x["name"].lower() for sx in s["stations"] for x in sx["actions"]} | {x["name"].lower() for x in s["strikes"]}


for _, s in ships:
    have = {x["name"].lower() for x in s["actions"] if x.get("source") != "family"}
    for n in stn(s) - have:
        for _, o in ships:
            if o is s:
                continue
            for x in list(o["actions"]):
                dup = [y for y in o["actions"] if y["name"].lower() == n]
                if x["name"] == "Area Fire" and re.sub(r"s$", "", x["text"].lower()).startswith(re.sub(r"\s*×\d+$", "", n).rstrip("s")):
                    x = dict(x, mode="area-fire", name=n, weapon=n)
                    o["actions"].remove(next(y for y in o["actions"] if y["name"] == "Area Fire" and y["text"] == x["text"]))
                    s["actions"].append(dict(x, relocated=True))
                    have.add(n)
                    print("RELOC area", n, o["name"], "->", s["name"])
                    break
                if x["name"].lower() == n and (n not in stn(o) or (len(dup) > 1 and x["text"].startswith("As "))):
                    o["actions"].remove(x)
                    fam_v = [y for y in s["actions"] if y["name"].lower() == n]
                    for y in fam_v:
                        s["actions"].remove(y)
                    s["actions"].append(dict(x, relocated=True, familyText=fam_v[0]["text"]) if fam_v else dict(x, relocated=True))
                    have.add(n)
                    s["review"] = [i for i in s["review"] if f'"{n}"' not in i]
                    print("RELOC", n, o["name"], "->", s["name"])
                    break
            if n in have:
                break
for _, s in ships:
    if any(i.startswith("strikes from AoN") for i in s["review"]):
        new = []
        for n, at, d in s["_aon"]:
            got = None
            for _, o in ships:
                if o is s:
                    continue
                for x in o["strikes"]:
                    if x["name"] == n and x["attack"] == at and (x["name"], x["attack"]) not in {(a, b) for a, b, _ in o["_aon"]}:
                        got = x
                        o["strikes"].remove(x)
                        break
                if got:
                    break
            new.append(got or dict(name=n, kind="ranged", attack=at, traits=[], damage=d))
            if got:
                print("STRIKE RELOC", n, "->", s["name"])
        s["strikes"] = new
        if (
            all(x.get("traits") or x["kind"] == "melee" for x in new)
            and len(new) == len(s["_aon"])
            and all("range" in " ".join(x["traits"]) for x in new if x["kind"] == "ranged")
        ):
            s["review"] = [i for i in s["review"] if not i.startswith(("strikes from AoN", "strike "))]
for _, s in ships:
    # strikes that AoN doesn't know for this ship = probably stolen from neighbour
    for x in s["strikes"]:
        if s["_aon"] and (x["name"], x["attack"]) not in {(a, b) for a, b, _ in s["_aon"]}:
            s["review"].append(f"strike {x['name']} +{x['attack']} not in AoN")
    have = (
        {x["name"].lower() for x in s["actions"]}
        | {x["name"].lower() for x in s["strikes"]}
        | {x.get("weapon", "").lower() for x in s["actions"]}
    )
    s["review"] = [i for i in s["review"] if not (i.startswith("station action") and re.search(r'"(.*)"', i).group(1) in have)]
    s["needsReview"] = bool([i for i in s["review"] if not i.startswith("station action")])
    del s["_aon"]
for _, s in ships:
    for x in list(s["actions"]):
        if x["name"] in ("Area Fire", "Auto-Fire") and not x.get("mode"):
            w = x["text"].split("(")[0].split(",")[0].strip().lower()
            if any(
                y.get("mode") and y.get("weapon", "").lower().rstrip("s") == w.rstrip("s")
                for _, o in ships
                if o is not s
                for y in o["actions"]
            ):
                s["actions"].remove(x)
                print("DROP dup area", s["name"], w)
            else:
                s["review"].append(f"unmapped {x['name']} entry: {x['text'][:60]}")
                s["needsReview"] = True
shiplist = [s for _, s in ships]
for s in shiplist:
    seen = {}
    for x in list(s["actions"]):
        k = x["name"].lower()
        if k in seen:
            # second copy: give it to another ship listing that action whose copy is AoN-only/missing
            for o in shiplist:
                if o is s:
                    continue
                ok = [y for y in o["actions"] if y["name"].lower() == k]
                if (k in stn(o) or k == "engaged strike" and any(st["kind"] == "melee" for st in o["strikes"])) and (
                    not ok or all(y.get("source") in ("aon", "family") for y in ok)
                ):
                    if k == "engaged strike" and not any(z["name"].lower() in x["text"].lower() for z in o["strikes"]):
                        continue
                    for y in ok:
                        o["actions"].remove(y)
                    s["actions"].remove(x)
                    o["actions"].append(dict(x, relocated=True))
                    print("DUP RELOC", k, s["name"], "->", o["name"])
                    break
            else:
                print("DUP KEEP", s["name"], k)
        seen[k] = 1
# resolve "As X" references
byname = {s["name"].lower(): s for _, s in ships}
for _, s in ships:
    for x in s["actions"]:
        m = re.match(r"^As (?:the )?([A-Z][\w’\' -]+?)(?:,|\.)(.*)$", x["text"])
        if m and m.group(1).lower() in byname:
            ref = next((y for y in byname[m.group(1).lower()]["actions"] if y["name"].lower() == x["name"].lower()), None)
            if ref:
                x["text"] = f"{x['text']} — [{m.group(1)}: {ref['text']}]"
                x["traits"] = x["traits"] or ref["traits"]
CMAP = {1: "one-action", 2: "two-actions", 3: "three-actions", "reaction": "reaction", "free": "free-action", None: "passive"}
for _, s in ships:
    for x in s["actions"]:
        if x.get("cost") in CMAP:
            x["cost"] = CMAP[x["cost"]]
for fn, fac in files.items():
    lst = [s for f, s in ships if f == fn]
    lst.sort(key=lambda s: (s["level"], s["name"]))
    json.dump(dict(faction=fac, ships=lst), open(OUT + fn, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
report = [(s["name"], s["review"]) for _, s in ships]
json.dump(report, open(str(WORK / "ship_report.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(len(ships), "unused pdf", [P[i]["page"] for i in range(len(P)) if i not in used])
c = collections.Counter(i.split(":")[0] if ":" in i else i for _, iss in report for i in iss)
print(c.most_common(30))
