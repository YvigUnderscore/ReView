"""Substitution FR→clé tolérante aux retours à la ligne de Prettier.

Le texte JSX long est reformaté sur plusieurs lignes : la chaîne du catalogue ne s'y
retrouve plus telle quelle. Chaque espace devient donc `\\s+` dans le motif, et
l'apostrophe accepte ses deux écritures. Les modules `.ts` qui ne sont pas des hooks
reçoivent le `t` de module (il lit la langue courante à l'appel).
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


def pattern(fr: str) -> str:
    parts = [re.escape(w).replace("'", "['’]").replace("’", "['’]") for w in fr.split(" ")]
    return r"\s+".join(parts)


ORDER = sorted(MAP, key=len, reverse=True)


def apply(path: pathlib.Path) -> bool:
    s = before = path.read_text(encoding="utf-8")
    for fr in ORDER:
        call = "t('" + MAP[fr] + "')"
        pat = pattern(fr)
        s = re.sub(r">(\s*)" + pat + r"(\s*)<", lambda m: ">" + m.group(1) + "{" + call + "}" + m.group(2) + "<", s)
        s = re.sub(r"\b(" + ATTRS + r')="' + pat + r'"', r"\1={" + call + "}", s)
        s = re.sub(r"'" + pat + r"'", call, s)
        s = re.sub(r'"' + pat + r'"(?!\s*[/>])', call, s)
    if s == before:
        return False
    path.write_text(s, encoding="utf-8")
    return True


def wire(path: pathlib.Path) -> None:
    """Branche `useT` (composant/hook) ou le `t` de module (helper pur)."""
    src = path.read_text(encoding="utf-8")
    if "t('" not in src or re.search(r"\b(useT|from '.*i18n')", src):
        pass
    rel = os.path.relpath(I18N, path.parent).replace("\\", "/")
    if not rel.startswith("."):
        rel = "./" + rel
    is_component = path.suffix == ".tsx" or re.search(r"^export (default )?function use[A-Z]", src, re.M)
    if is_component:
        if "useT" not in src:
            ends = [m.end() for m in re.finditer(r"^import .*?;$", src, re.M)]
            if not ends:
                return
            src = src[: max(ends)] + "\nimport { useT } from '" + rel + "';" + src[max(ends) :]
        lines = src.split("\n")
        starts = [i for i, l in enumerate(lines) if re.match(r"^(export default |export )?function [A-Za-z]", l)]
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
        src = "\n".join(out)
    elif "t(" in src and not re.search(r"import \{[^}]*\bt\b[^}]*\} from '.*i18n'", src):
        ends = [m.end() for m in re.finditer(r"^import .*?;$", src, re.M)]
        anchor = max(ends) if ends else 0
        src = src[:anchor] + "\nimport { t } from '" + rel + "';" + src[anchor:]
    path.write_text(src, encoding="utf-8")


touched = []
for p in sorted(list(ROOT.rglob("*.tsx")) + list(ROOT.rglob("*.ts"))):
    if p.name.endswith((".test.ts", ".test.tsx")) or "i18n" in p.parts:
        continue
    if apply(p):
        touched.append(p)
for p in touched:
    wire(p)
print(len(touched), "fichiers")
