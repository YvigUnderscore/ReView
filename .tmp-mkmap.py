import json, pathlib
# Carte FR→clé : la valeur française d'une clé devient le littéral à remplacer, si elle
# est encore présente en dur quelque part sous v2 (.tsx ET .ts).
fr = json.loads(pathlib.Path("frontend/src/v2/i18n/messages/fr.json").read_text(encoding="utf-8"))
files = [p for p in pathlib.Path("frontend/src/v2").rglob("*.tsx") if not p.name.endswith(".test.tsx")]
files += [p for p in pathlib.Path("frontend/src/v2").rglob("*.ts") if not p.name.endswith(".test.ts") and "i18n" not in p.parts]
src = "\n".join(p.read_text(encoding="utf-8") for p in files)
out = {}
for key, val in fr.items():
    if not isinstance(val, str) or len(val) < 3 or "{" in val or "|" in val:
        continue
    if val in src:
        out[val] = key
ordered = {k: out[k] for k in sorted(out, key=len, reverse=True)}
pathlib.Path(".tmp-frmap.json").write_text(json.dumps(ordered, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(ordered))
