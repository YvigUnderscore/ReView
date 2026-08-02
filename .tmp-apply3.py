"""Application FR→clé tolérante à l'apostrophe et aux espaces.

Le code source mêle apostrophe droite (') et typographique (’) ; les catalogues ont été
normalisés sur la typographique. Une comparaison littérale laissait donc passer une bonne
part des chaînes déjà traduites. On compare ici sur une forme normalisée.
"""

import json
import os
import pathlib
import re
import sys

MAP = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
ROOT = pathlib.Path("frontend/src/v2")
I18N = ROOT / "i18n"
ATTRS = "placeholder|title|label|hint|description|aria-label|confirmLabel|action|ariaLabel"


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("’", "'").replace(" ", " ")).strip()


# Clé normalisée → clé de message, la chaîne la plus longue d'abord.
NORMAP = {norm(fr): key for fr, key in MAP.items()}
ORDER = sorted(NORMAP, key=len, reverse=True)


def variants(fr: str):
    """Toutes les écritures d'apostrophe possibles pour un même texte."""
    seen = {fr, fr.replace("'", "’"), fr.replace("’", "'")}
    return sorted(seen, key=len, reverse=True)


def apply(path: pathlib.Path) -> bool:
    s = before = path.read_text(encoding="utf-8")
    for fr in ORDER:
        call = "t('" + NORMAP[fr] + "')"
        for v in variants(fr):
            e = re.escape(v)
            s = re.sub(r">(\s*)" + e + r"(\s*)<", lambda m: ">" + m.group(1) + "{" + call + "}" + m.group(2) + "<", s)
            s = re.sub(r"\b(" + ATTRS + r')="' + e + r'"', r"\1={" + call + "}", s)
            if "'" not in v:
                s = s.replace("'" + v + "'", call)
            s = s.replace('"' + v + '"', call)
    if s == before:
        return False
    path.write_text(s, encoding="utf-8")
    return True


def hooks(path: pathlib.Path) -> None:
    src = path.read_text(encoding="utf-8")
    if "t('" not in src:
        return
    rel = os.path.relpath(I18N, path.parent).replace("\\", "/")
    if not rel.startswith("."):
        rel = "./" + rel
    if "useT" not in src and "from '" + rel + "'" not in src:
        ends = [m.end() for m in re.finditer(r"^import .*?;$", src, re.M)]
        if not ends:
            return
        src = src[: max(ends)] + "\nimport { useT } from '" + rel + "';" + src[max(ends) :]
    lines = src.split("\n")
    starts = [i for i, l in enumerate(lines) if re.match(r"^(export default |export )?function [A-Z]", l)]
    out, ins = list(lines), 0
    for idx, st in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
        body = "\n".join(lines[st:end])
        if "t('" not in body or "const t = useT();" in body or "const tr = useT();" in body:
            continue
        for i in range(st, end):
            if re.search(r"\)\s*\{\s*$", lines[i]) or lines[i].rstrip().endswith("}) {"):
                out.insert(i + 1 + ins, "  const t = useT();")
                ins += 1
                break
    path.write_text("\n".join(out), encoding="utf-8")


touched = [p for p in sorted(ROOT.rglob("*.tsx")) if not p.name.endswith(".test.tsx") and apply(p)]
for p in touched:
    hooks(p)
print(len(touched), "fichiers")
