"""Applique la carte FR→clé aux fichiers `.ts` qui sont des hooks React.

Un hook peut appeler `useT()` ; un module ordinaire non — d'où le filtre sur
`export function use…`. Les tables de libellés au niveau module restent à convertir
à la main en tables de clés.
"""

import json
import os
import pathlib
import re
import sys

MAP = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
I18N = pathlib.Path("frontend/src/v2/i18n")
ROOT = pathlib.Path("frontend/src/v2")


def is_hook(src: str) -> bool:
    return re.search(r"^export (default )?function use[A-Z]", src, re.M) is not None


touched = []
for p in sorted(ROOT.rglob("*.ts")):
    if p.name.endswith(".test.ts") or "i18n" in p.parts:
        continue
    src = before = p.read_text(encoding="utf-8")
    if not is_hook(src):
        continue
    for fr, key in MAP.items():
        src = src.replace("'" + fr + "'", "t('" + key + "')")
    if src == before:
        continue
    rel = os.path.relpath(I18N, p.parent).replace("\\", "/")
    if not rel.startswith("."):
        rel = "./" + rel
    if "useT" not in src:
        ends = [m.end() for m in re.finditer(r"^import .*?;$", src, re.M)]
        src = src[: max(ends)] + "\nimport { useT } from '" + rel + "';" + src[max(ends) :]
    lines = src.split("\n")
    starts = [i for i, l in enumerate(lines) if re.match(r"^(export )?(default )?function use[A-Z]", l)]
    out, ins = list(lines), 0
    for idx, st in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
        body = "\n".join(lines[st:end])
        if "t('" not in body or "const t = useT();" in body:
            continue
        for i in range(st, end):
            if re.search(r"\)\s*\{\s*$|\}\)\s*\{\s*$", lines[i]):
                out.insert(i + 1 + ins, "  const t = useT();")
                ins += 1
                break
    p.write_text("\n".join(out), encoding="utf-8")
    touched.append(p)

print(len(touched), "hooks")
