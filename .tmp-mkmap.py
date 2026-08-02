import json, pathlib
# Carte FR→clé. Ne PAS filtrer sur la présence littérale dans les sources : le code mêle
# apostrophe droite et typographique, et ce filtre écartait justement les clés déjà
# traduites qu'il fallait substituer. L'ancrage (texte JSX, littéral, attribut) suffit.
fr = json.loads(pathlib.Path("frontend/src/v2/i18n/messages/fr.json").read_text(encoding="utf-8"))
out = {}
for key, val in fr.items():
    if not isinstance(val, str) or len(val) < 4 or "{" in val or "|" in val:
        continue
    out[val] = key
ordered = {k: out[k] for k in sorted(out, key=len, reverse=True)}
pathlib.Path(".tmp-frmap.json").write_text(json.dumps(ordered, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(ordered))
