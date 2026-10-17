from paths import INPUT, WORK
import re, json

L = open(str(INPUT / "aon.txt"), encoding="utf-8").read().split("\n")
end_h = next(i for i, l in enumerate(L) if i > 5300 and re.match(r"^Hazard -?\d+$", l))
ships = []
fams = {}
COST = {"[one-action]": 1, "[two-actions]": 2, "[three-actions]": 3, "[reaction]": "reaction", "[free-action]": "free"}
for i, l in enumerate(L):
    if re.match(r"^Creature -?\d+$", l) and L[i + 1] != "" and not L[i - 1].startswith("Creature"):
        name = L[i - 1]
        lvl = int(l.split()[1])
        j = i + 1
        tags = []
        while not L[j].startswith("Source"):
            tags.append(L[j])
            j += 1
        page = int(re.search(r"pg\. (\d+)", L[j]).group(1))
        body = []
        k = j + 1
        while (
            k < len(L)
            and not (k + 1 < len(L) and L[k + 1] in ("Creature Family",))
            and not re.match(r"^Creature -?\d+$", L[k + 1] if k + 1 < len(L) else "")
        ):
            if L[k].strip():
                body.append(L[k])
            k += 1
        ships.append(dict(name=name, level=lvl, size=tags[0].lower(), traits=[t.lower() for t in tags[1:]], page=page, body=body))
    if l == "Creature Family":
        fname = L[i - 1]
        k = i + 1
        common = []
        members = []
        while k < len(L) and not (L[k] == "Creature Family" or re.match(r"^Creature -?\d+$", L[k])):
            m = re.match(r"^\((.+?)\) (.+?) (\[[a-z-]+\])\s*(?:\((.*?)\))?\s*(.*)$", L[k])
            if not m and common and re.match(r"^(Critical Success|Success|Failure|Critical Failure) ", L[k]):
                common[-1]["text"] += " " + L[k]
            if m:
                common.append(
                    dict(
                        station=m.group(1),
                        name=m.group(2),
                        cost=COST[m.group(3)],
                        traits=[t.strip() for t in (m.group(4) or "").split(",") if t.strip()],
                        text=m.group(5),
                    )
                )
            if L[k] == "Members":
                members = re.findall(r"([^,]+?) \(Creature -?\d+\)", L[k + 1])
                members = [x.strip() for x in members]
            k += 1
        if fname not in fams or common:
            fams[fname] = dict(name=fname, common=common, members=members)
# dedupe ships
seen = {}
out = []
for s in ships:
    if s["name"] in seen:
        continue
    seen[s["name"]] = 1
    out.append(s)
print(len(out), len(fams))
json.dump(dict(ships=out, families=fams), open(str(WORK / "aon_ships.json"), "w", encoding="utf-8"), indent=1)
for f in fams.values():
    print(f["name"], len(f["common"]), len(f["members"]))

# Feed the PDF parser from the current station/action names, not a private development file.
names = set()
for ship in out:
    for line in ship["body"]:
        match = re.match(r"^(.+?) \[(?:one-action|two-actions|three-actions|reaction|free-action)\]", line)
        if match:
            names.add(match.group(1))
json.dump(sorted(names), open(WORK / "aon_names.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
