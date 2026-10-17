from paths import OUTPUT, ROOT, WORK
import re, json

P = json.load(open(str(WORK / "haz_blocks.json"), encoding="utf-8"))
A = json.load(open(str(WORK / "haz_aon.json"), encoding="utf-8"))
old = {
    h["name"].upper().replace("’", "'"): h
    for h in json.load(open(str(ROOT / "data" / "hazards" / "hazards.json"), encoding="utf-8"))["hazards"]
}
G = {"Ȱɵ": "one-action", "ʚʖ": "two-actions", "̂ˬ": "three-actions", "Ǻȓ": "reaction", "Ȳ˓": "free-action"}
GR = "(?:" + "|".join(map(re.escape, G)) + ")"
AC = {
    "[one-action]": "one-action",
    "[two-actions]": "two-actions",
    "[three-actions]": "three-actions",
    "[reaction]": "reaction",
    "[free-action]": "free-action",
}
KEY = re.compile(
    r"^(Stealth|Description|Disable|Complexity|(?:\w+ ){0,2}AC \d+|(?:\w+ ){0,2}Hardness|(?:\w+ ){0,2}HP \d+|Special|Routine|Reset|Critical Success|Success|Failure|Critical Failure|Melee|Ranged|Immunities|Weaknesses|Resistances|Fort|Ref|Will)\b"
)


def join(lines):
    out = ""
    for l in lines:
        out = l if not out else (out + l if out.endswith("-") and not out.endswith(" -") else out + " " + l)
    return out


def pdf_entries(text):
    ent = []
    lines = text.split("\n")
    # drop misplaced text before Description (if Description exists later)
    if any(l.startswith("Description") for l in lines):
        k = next(i for i, l in enumerate(lines) if l.startswith("Description"))
        lines = [lines[0]] + lines[k:]
    for l in lines:
        if re.match(r"^(Upgraded Boarding Pod|Scaling Summoning Hazards)$", l):
            break
        if (
            KEY.match(l)
            or re.match(r"^[A-Z][^.;:]{0,50}? " + GR, l)
            or re.match(r"^[A-Z][a-z’'-]+(?: [A-Z][a-z’'-]+){1,3} (?:All|The|A|This|Each) ", l)
            and ent
            and ent[-1][-1].rstrip().endswith((".", ")"))
        ):
            ent.append([l])
        elif ent:
            ent[-1].append(l)
    return [join(e) for e in ent]


def build(name, entries, level, traits, page, src):
    h = dict(id=re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", name.lower().replace("’", "").replace("'", ""))), name=name, level=level)
    rarity = "common"
    for r in ("rare", "uncommon", "unique"):
        if r in traits:
            rarity = r
            traits = [t for t in traits if t != r]
    cx = "complex" in traits
    traits = [t for t in traits if t != "complex"]
    h.update(
        complexity="complex" if cx else "simple",
        isComplex=cx,
        rarity=rarity,
        source=dict(book="Starfinder Tech Core", page=page),
        traits=traits,
        actions=[],
        textSource=src,
    )
    passives = []
    for e in entries:
        if e.startswith("Complexity"):
            cxv = "complex" in e.lower().replace("complexity", "")
            h["complexity"] = "complex" if cxv else "simple"
            h["isComplex"] = cxv
            continue
        if e.startswith("Special "):
            h["special"] = e[8:].strip()
            continue
        m = re.match(r"^Stealth (?:DC (\d+)|\+(\d+))\s*(?:\((\w+)\))?(.*)$", e)
        if m:
            if m.group(1):
                h["stealthDC"] = int(m.group(1))
            else:
                h["stealthBonus"] = int(m.group(2))
            if m.group(3):
                h["stealthRank"] = m.group(3)
            if m.group(4).strip(" ,"):
                h["stealthNote"] = m.group(4).strip(" ,")
            continue
        if e.startswith("Description"):
            h["description"] = e[12:].strip()
            continue
        if e.startswith("Disable"):
            h["disable"] = e[8:].strip()
            continue
        m = re.match(r"^(?:(\w+(?: \w+)?) )?AC (\d+)[,;]? ?(?:Fort \+(\d+))?[,;]? ?(?:Ref \+(\d+))?[,;]? ?(?:Will \+(\d+))?", e)
        if m and not e.startswith(("Description",)):
            if m.group(1):
                h["objectName"] = m.group(1)
            h["ac"] = int(m.group(2))
            for k, g in (("fort", 3), ("ref", 4), ("will", 5)):
                if m.group(g):
                    h[k] = int(m.group(g))
            continue
        m = re.match(r"^(Fort|Ref|Will) \+(\d+)", e)
        if m:
            h[{"Fort": "fort", "Ref": "ref", "Will": "will"}[m.group(1)]] = int(m.group(2))
            continue
        if re.match(r"^(?:\w+ ){0,2}(Hardness|HP) \d", e):
            m = re.search(r"Hardness (\d+)", e)
            if m:
                h["hardness"] = int(m.group(1))
            m = re.search(r"HP (\d+)(?: each)?(?: \(BT (\d+)\))?", e)
            if m:
                h["hp"] = int(m.group(1))
                h["bt"] = int(m.group(2)) if m.group(2) else None
            if " each" in e:
                h["hpNote"] = "each object"
            for k in ("Immunities", "Weaknesses", "Resistances"):
                m = re.search(k + r" (.*?)(?=; (?:Immunities|Weaknesses|Resistances)|$)", e)
                if m:
                    h[k.lower()] = m.group(1).strip(" ;")
            continue
        m = re.match(r"^(Immunities|Weaknesses|Resistances) (.*)$", e)
        if m:
            h[m.group(1).lower()] = m.group(2)
            continue
        m = re.match(r"^Routine \(([^)]*)\)\s*(.*)$", e)
        if m:
            h["routine"] = dict(cost=m.group(1), text=m.group(2))
            continue
        if e.startswith("Reset"):
            h["reset"] = e[6:].strip()
            continue
        m = re.match(r"^(Melee|Ranged) (?:" + GR + r" |\[[a-z-]+\] )?(.+?) \+(\d+)(?: \(([^)]*)\))?,? (?:Damage )?(.*)$", e)
        if m:
            h.setdefault("strikes", []).append(
                dict(
                    name=m.group(2),
                    kind=m.group(1).lower(),
                    attack=int(m.group(3)),
                    traits=[t.strip() for t in (m.group(4) or "").split(",") if t.strip()],
                    damage=m.group(5).strip(),
                )
            )
            continue
        if e.startswith("Damage ") and h.get("strikes"):
            h["strikes"][-1]["damage"] += " " + e[7:]
            continue
        if re.match(r"^(Critical Success|Success|Failure|Critical Failure) ", e):
            tgt = h["actions"][-1] if h["actions"] else None
            if tgt:
                tgt["text"] += " " + e
            continue
        m = re.match(r"^([A-Z][^.;:\[]{0,50}?) (" + GR + r"|\[[a-z-]+\])\s*(?:\(([^)]*)\))?\s*(.*)$", e)
        if m:
            cost = G.get(m.group(2)) or AC.get(m.group(2))
            h["actions"].append(
                dict(
                    name=m.group(1).strip(),
                    cost=cost,
                    traits=[t.strip() for t in (m.group(3) or "").split(",") if t.strip()],
                    text=m.group(4).strip(),
                )
            )
            continue
        m = re.match(r"^([A-Z][\w’' -]{2,40}?) \(([a-z, ]+)\) (?=[A-Z])", e)
        if m:
            h["actions"].append(
                dict(name=m.group(1), cost="passive", traits=[t.strip() for t in m.group(2).split(",")], text=e[m.end() :].strip())
            )
            continue
        m = re.match(r"^([A-Z][\w’' -]{2,40}?) (?=All|The|A |This|Each|Creatures|Any|On a)", e)
        if m:
            h["actions"].append(dict(name=m.group(1), cost="passive", traits=[], text=e[len(m.group(1)) :].strip()))
            continue
        if "description" not in h and not h["actions"]:
            h["description"] = e
            continue
        h.setdefault("unparsed", []).append(e)
    if h.get("routine") and not h["isComplex"]:
        h["isComplex"] = True
        h["complexity"] = "complex"
    return h


out = []
report = {}
for p in P:
    an = p["aon"]
    if an:
        a = A[an]
        body = a["body"]
        # AoN body: description is first non-key line
        ent = []
        first = True
        for l in body:
            if l in ("Upgraded Boarding Pod", "Scaling Summoning Hazards"):
                break
            if first and not KEY.match(l) and not re.search(r"\[[a-z-]+\]", l):
                ent.append("Description " + l)
                first = False
                continue
            first = False if KEY.match(l) else first
            ent.append(l)
        h = build(an.replace("'", "’"), ent, a["level"], a["traits"], a["page"], "aon+pdf")
        # cross-check with PDF
        hp = build(an, pdf_entries(p["text"]), a["level"], a["traits"], p["page"], "pdf")
        iss = []
        for k in ("stealthDC", "stealthBonus", "ac", "fort", "ref", "will", "hardness", "hp", "bt"):
            if h.get(k) != hp.get(k):
                iss.append(f"{k}: AoN {h.get(k)} vs PDF {hp.get(k)}")
        # prefer PDF numbers when present
        for k in ("stealthDC", "stealthBonus", "ac", "fort", "ref", "will", "hardness", "hp", "bt"):
            if hp.get(k) is not None:
                h[k] = hp[k]
        if not h.get("routine") and hp.get("routine"):
            h["routine"] = hp["routine"]
        if not h.get("reset") and hp.get("reset"):
            h["reset"] = hp["reset"]
        an_names = {x["name"] for x in h["actions"]}
        for x in hp["actions"]:
            if x["name"] not in an_names:
                h["actions"].append(dict(x, source="pdf"))
                iss.append(f'action {x["name"]} only in PDF')
        if not h.get("strikes") and hp.get("strikes"):
            h["strikes"] = hp["strikes"]
    else:
        o = old[p["name"].replace("’", "'")]
        lvl = o["level"]
        if p["level"] is not None and p["level"] != lvl:
            pass
        tr = o["traits"]
        h = build(o["name"], pdf_entries(p["text"]), lvl, (["complex"] if o["isComplex"] else []) + tr, p["page"], "pdf")
        iss = ["not on AoN dump: parsed from PDF only, traits/level from 0.1.0 data"]
    h["needsReview"] = bool(h.get("unparsed")) or any(not i.startswith("not on AoN") and not i.startswith("action ") for i in iss)
    h["review"] = iss + [f"unparsed: {u[:80]}" for u in h.pop("unparsed", [])]
    out.append(h)
out.sort(key=lambda h: (h["level"], h["name"]))
json.dump(dict(hazards=out), open(str(OUTPUT / "hazards.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
for h in out:
    print(
        h["name"],
        h["level"],
        h["complexity"],
        "S",
        h.get("stealthDC") or ("+%s" % h.get("stealthBonus")),
        "AC",
        h.get("ac"),
        "HP",
        h.get("hp"),
        "acts",
        [(a["name"], a["cost"]) for a in h["actions"]],
        "R" if h.get("routine") else "",
        h["review"],
    )
