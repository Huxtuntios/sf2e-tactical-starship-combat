from paths import WORK
import re, json

B = json.load(open(str(WORK / "blocks.json"), encoding="utf-8"))
G = {"Ȱɵ": 1, "ʚʖ": 2, "̂ˬ": 3, "Ǻȓ": "reaction", "Ȳ˓": "free"}
GR = "(?:" + "|".join(map(re.escape, G)) + ")"
KEY = re.compile(r"^(Perception \+|Skills |Battle Stations\b|Str [+–-]|AC \d|HP \d|Speed \d|Ranged |Melee )")


def is_heading(t):
    f = t.split("\n")
    return t.startswith("Tech CORE") or (len(f) == 1 and (t.upper() == t or len(t) < 40 and not re.search(GR, t)))


def is_cont(t):
    if is_heading(t):
        return False
    if t.startswith("Perception"):
        return False
    if re.search(GR, t) or KEY.match(t):
        return True
    if re.search(r"(Effect |Frequency |Trigger |DC \d+|\d+d\d+)", t):
        return True
    return False


idx = [i for i, x in enumerate(B) if x["text"].startswith("Perception")]
blocks = []
orphans = []
FORCE = {496: 510}
for n, i in enumerate(idx):
    txt = [B[i]["text"]]
    used = [i]
    lim = idx[n + 1] if n + 1 < len(idx) else len(B)
    for j in range(i + 1, lim):
        t = B[j]["text"]
        if j in FORCE:
            continue
        if is_cont(t):
            mk = KEY.match(t)
            if mk and re.search(r"(^|\n)" + re.escape(mk.group(1)), "\n".join(txt)):
                orphans.append((j, t, mk.group(1)))
                continue
            # stop if this looks like family sidebar "(gunnery) X" or page-ref lists
            txt.append(t)
            used.append(j)
            if not (re.search(GR, t) or KEY.match(t)):
                print("WEAK", B[i]["page"], j, t[:90].replace(chr(10), " | "))
    blocks.append(dict(i=i, page=B[i]["page"], text="\n".join(txt), used=used))
for j, tg in FORCE.items():
    next(b for b in blocks if b["i"] == tg)["text"] += "\n" + B[j]["text"]
for j, t, k in orphans:
    cand = [b for b in blocks if b["i"] > j and not re.search(r"(^|\n)" + re.escape(k), b["text"])] or [
        b for b in blocks[::-1] if b["i"] < j and not re.search(r"(^|\n)" + re.escape(k), b["text"])
    ]
    print("ORPHAN", j, k, "->", cand[0]["page"] if cand else None, cand[0]["text"][:40] if cand else "")
    if cand:
        cand[0]["text"] += "\n" + t


def joinlines(lines):
    out = ""
    for l in lines:
        if not out:
            out = l
            continue
        if out.endswith("-") and not out.endswith(" -"):
            out += l
        else:
            out += " " + l
    return out


ANAMES = json.load(open(str(WORK / "aon_names.json"), encoding="utf-8"))


def station_names(st):
    out = []
    for grp in re.findall(r"\(([^()]*)\)", st or ""):
        out += [x.strip(" *") for x in grp.split(",") if x.strip(" *")]
    return out


PASS2 = re.compile(r"^([A-Z][a-z’'-]+(?: (?:of|the|and|[A-Z][a-z’'-]+)){1,3}) (?:While|The|Thanks|When|Each|Whenever|It|This) ")
PASSIVE = re.compile(r"^([A-Z][a-z’'-]+(?: [A-Z][a-z’'-]+){0,3}) (?:\([a-z, ]+\) |As |See page)")


def parse(b):
    lines = b["text"].split("\n")
    st = re.search(r"Battle Stations(.*?)(?:\nStr [+–-])", b["text"], re.S)
    sn = station_names(st.group(1).replace("\n", " ") if st else "")
    known = sorted(
        (set(ANAMES) - {"Area Fire", "Auto-Fire", "Engaged Strike"})
        | set(n for n in sn if n[:1].isupper())
        | set(" ".join(w[:1].upper() + w[1:] for w in n.split()) for n in sn if n[:1].islower()),
        key=len,
        reverse=True,
    )

    def starts_known(l):
        return any(l.startswith(n + " ") or l == n for n in known)

    # group into entries: new entry at KEY lines or "Name GLYPH" lines
    ent = []
    PASS2 = re.compile(r"^([A-Z][a-z’'-]+(?: (?:of|the|and|[A-Z][a-z’'-]+)){1,3}) (?:While|The|Thanks|When|Each|Whenever|It|This) ")
    for l in lines:
        if ent and PASS2.match(l) and ent[-1][-1].rstrip().endswith((".", ")")):
            ent.append([l])
            continue
        if (
            KEY.match(l)
            or re.match(r"^[A-Z][^.;:]{0,60}? " + GR, l)
            or starts_known(l)
            or PASSIVE.match(l)
            or re.match(r"^(Critical Success|Success|Failure|Critical Failure) ", l)
        ):
            ent.append([l])
        elif ent:
            ent[-1].append(l)
    E = [joinlines(e) for e in ent]
    s = dict(page=b["page"], strikes=[], actions=[], raw=b["text"])
    for e in E:
        m = re.match(r"^Perception \+(\d+)(.*?); Sensor Range (\d+) zones?", e)
        if m:
            s["perception"] = int(m.group(1))
            s["sensorRange"] = int(m.group(3))
            continue
        if e.startswith("Skills"):
            s["skills"] = {k.strip().lower(): int(v.replace("–", "-")) for k, v in re.findall(r"([A-Za-z ]+?) ([+–-]\d+)", e[6:])}
            continue
        if e.startswith("Battle Stations"):
            s["stationsText"] = e[15:].strip()
            continue
        if e.startswith("Str "):
            s["abilities"] = {k.lower(): int(v.replace("–", "-")) for k, v in re.findall(r"(Str|Dex|Con|Int|Wis|Cha) ([+–-]\d+)", e)}
            continue
        m = re.match(r"^AC (\d+)(.*?); Fort(?:itude)? ?\+(\d+),? Ref(?:lex)? ?\+(\d+),? Will ?\+(\d+)(.*)", e)
        if m:
            s.update(ac=int(m.group(1)), fort=int(m.group(3)), ref=int(m.group(4)), will=int(m.group(5)))
            s["saveNote"] = m.group(6).strip(" ;,")
            continue
        if re.match(r"^HP \d", e):
            m = re.match(r"^HP (\d+)", e)
            s["hp"] = int(m.group(1))
            m = re.search(r"SP (\d+)(?: \(fortify (\d+)\))?", e)
            if m:
                s["sp"] = int(m.group(1))
                s["fortify"] = int(m.group(2)) if m.group(2) else 0
            for k in ("Immunities", "Resistances", "Weaknesses"):
                m = re.search(k + r" (.*?)(?=; (?:Immunities|Resistances|Weaknesses)|$)", e)
                if m:
                    s[k.lower()] = m.group(1).strip()
            m = re.match(r"^HP \d+,? ([^;]*?)(?=;|$)", e)
            if m and m.group(1) and not m.group(1).startswith("SP"):
                s["hpNote"] = m.group(1).strip()
            continue
        m = re.match(r"^Speed (\d+) zones?(.*)", e)
        if m:
            s["speed"] = int(m.group(1))
            s["speedNote"] = m.group(2).strip(" ;,")
            continue
        m = re.match(r"^(Ranged|Melee) (?:" + GR + r" )?(.+?) \+(\d+)(?: \((.*?)\))?,? Damage (.*)$", e)
        if m:
            tr = [t.strip() for t in re.split(r",\s*(?![^()]*\))", m.group(4) or "") if t.strip()]
            s["strikes"].append(
                dict(name=m.group(2).strip(), kind=m.group(1).lower(), attack=int(m.group(3)), traits=tr, damage=m.group(5).strip())
            )
            continue
        m = re.match(r"^(Critical Success|Success|Failure|Critical Failure) ", e)
        if m and s["actions"]:
            s["actions"][-1]["text"] += " " + e
            continue
        m = re.match(r"^([A-Z][^.;:]{0,60}?) (" + GR + r")\s*(?:\(([^)]*)\))?\s*(.*)$", e)
        if m:
            s["actions"].append(
                dict(
                    name=m.group(1).strip(),
                    cost=G[m.group(2)],
                    traits=[t.strip() for t in (m.group(3) or "").split(",") if t.strip()],
                    text=m.group(4).strip(),
                )
            )
            continue
        m = re.match(r"^([A-Z][\w’'-]*(?: [A-Za-z][\w’'-]*){0,4}?)\s*(?:\(([a-z, ]+)\))?\s+(As .*|See .*|[A-Z(].*)$", e)
        nm = next((n for n in known if e.startswith(n + " ") or e == n), None)
        if (
            nm
            and s["actions"]
            and (
                e[len(nm) :].strip()[:1].islower() or e[len(nm) :].strip().startswith("(see") or any(a["name"] == nm for a in s["actions"])
            )
        ):
            s["actions"][-1]["text"] += " " + e
            continue
        if nm:
            rest = e[len(nm) :].strip()
            tm = re.match(r"^\(([^)]*)\)\s*(.*)$", rest)
            s["actions"].append(
                dict(name=nm, cost=None, traits=[t.strip() for t in tm.group(1).split(",")] if tm else [], text=tm.group(2) if tm else rest)
            )
            continue
        m = PASSIVE.match(e) or PASS2.match(e)
        if m and s["actions"] and e[len(m.group(1)) :].strip().startswith("(see"):
            s["actions"][-1]["text"] += " " + e
            continue
        if m:
            rest = e[len(m.group(1)) :].strip()
            tm = re.match(r"^\(([^)]*)\)\s*(.*)$", rest)
            s["actions"].append(
                dict(
                    name=m.group(1),
                    cost=None,
                    traits=[t.strip() for t in tm.group(1).split(",")] if tm else [],
                    text=tm.group(2) if tm else rest,
                )
            )
            continue
        s.setdefault("unparsed", []).append(e)
    return s


res = [parse(b) for b in blocks]
usedall = set(j for b in blocks for j in b["used"]) | set(FORCE) | set(j for j, _, _ in orphans)
lo = []
for j, x in enumerate(B):
    t = x["text"]
    if j in usedall or t.startswith("Perception") or is_heading(t):
        continue
    if re.search(GR, t) or KEY.match(t) or re.match(r"^[A-Z][\w’\' -]{3,40} (The|Thanks|This|When|Each) ", t):
        lo.append(dict(i=j, page=x["page"], text=t))
json.dump(lo, open(str(WORK / "pdf_loose.json"), "w", encoding="utf-8"), indent=1)
print("loose", len(lo))
[print("  ", l["i"], l["page"], l["text"][:80].replace(chr(10), " | ")) for l in lo]
json.dump(res, open(str(WORK / "pdf_ships.json"), "w", encoding="utf-8"), indent=1)
print(len(res))
for r in res:
    miss = [k for k in ("perception", "ac", "hp", "speed", "stationsText", "abilities") if k not in r]
    if miss or r.get("unparsed"):
        print(r["page"], r.get("perception"), r.get("hp"), miss, [u[:70] for u in r.get("unparsed", [])])
