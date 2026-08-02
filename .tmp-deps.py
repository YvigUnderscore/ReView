"""Ajoute `t` aux tableaux de dépendances que ESLint signale, et à eux seuls.

`t` change avec la langue : un `useCallback` qui l'emploie doit en dépendre. Repérer les
tableaux à la main est une source d'erreurs (des fichiers utilisent `t` comme accumulateur
de temps) — on suit donc exactement les positions rapportées par la règle.
"""

import json
import pathlib
import re
import subprocess
import sys

FRONT = pathlib.Path("frontend")


def report():
    out = subprocess.run(
        ["npx", "eslint", ".", "--format", "json"],
        cwd=FRONT, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace",
    ).stdout
    start = out.find("[")
    return json.loads(out[start:]) if start >= 0 else []


changed = 0
for entry in report():
    hits = [
        m for m in entry["messages"]
        if m.get("ruleId") == "react-hooks/exhaustive-deps" and "missing dependency: 't'" in m["message"]
    ]
    if not hits:
        continue
    p = pathlib.Path(entry["filePath"])
    lines = p.read_text(encoding="utf-8").split("\n")
    for m in hits:
        # ESLint pointe le hook ; le tableau de deps est le premier `[...]` qui suit.
        for i in range(m["line"] - 1, min(m["line"] + 60, len(lines))):
            dm = re.match(r"^(\s*(?:\},\s*)?)\[([^\[\]]*)\](,?\s*\)?;?\s*)$", lines[i])
            if not dm:
                continue
            deps = dm.group(2).strip()
            if re.search(r"(^|,\s*)t(\s*,|$)", deps):
                break
            lines[i] = f"{dm.group(1)}[{deps + ', ' if deps else ''}t]{dm.group(3)}"
            changed += 1
            break
    p.write_text("\n".join(lines), encoding="utf-8")

print(changed, "tableaux de dépendances complétés")
sys.exit(0)
