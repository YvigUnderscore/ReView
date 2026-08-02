"""Détecteur de chaînes françaises résiduelles — version qui ne triche pas.

Le précédent n'examinait que du texte JSX tenant sur une ligne, sans accolade : tous les
paragraphes coupés par Prettier lui échappaient. Celui-ci retire d'abord les commentaires,
puis relève **tout** texte JSX (multi-ligne compris) et **tout** littéral de chaîne, avant
de garder ce qui ressemble à du français.
"""

import pathlib
import re
import sys
import collections

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "frontend/src/v2")

# Accents typiques, ou mots-outils français qui n'existent pas tels quels en anglais.
FR = re.compile(
    r"[éèêëàâçùûôîïœÉÈÊÀÇÔÎÛ]"
    r"|[dlnsjcmt]['’](?=[a-zA-ZàâéèêîôûA-Z])"
    r"|\b(le|la|les|un|une|des|du|au|aux|et|ou|pour|avec|sans|dans|sur|par|qui|que|quoi"
    r"|ce|cette|ces|vos|votre|vous|nos|notre|aucun|aucune|tous|toutes|plus|est|sont|sera"
    r"|seront|depuis|vers|hors|ligne|niveau|leur|leurs|puis|ici|elles|ils|son|ses|si|mais"
    r"|comme|entre|chaque|tout|toute|peut|peuvent|doit|doivent|fait|faire|voir|selon|actives|actifs|active|nouveau|nouvelle|nouveaux|nouvelles|dernier|dernière|derniers|dernières|premier|première|ajouter|créer|créez|supprimer|modifier|enregistrer|afficher|masquer|partages|réglages|statistiques|calendrier|bonjour|tâches|tâche|lun|mar|mer|jeu|ven|sam|dim|activer|désactiver|choisir|choisissez|sélectionner|rechercher|fermer|ouvrir|copier|coller|déconnecter|appareil|utilisé|utilisée|utilisés|illimité|défaut|aperçu|invité|jamais)\b",
    re.I,
)

# Ce qui ressemble à du français mais n'en est pas : identifiants, chemins, formats.
SKIP = re.compile(r"^(https?:|/|\.|#|[A-Z_]+$|[a-z]+([A-Z][a-z]*)+$)|^\s*$")


def strip_comments(src: str) -> str:
    src = re.sub(r"/\*[\s\S]*?\*/", " ", src)
    return re.sub(r"(^|\s)//[^\n]*", " ", src)


def candidates(src: str):
    # Texte JSX, multi-ligne compris : entre `>` et `<`, sans accolade ni balise.
    for m in re.finditer(r">([^<>{}]+)<", src):
        yield " ".join(m.group(1).split())
    # Littéraux de chaîne, y compris les gabarits sans interpolation.
    for m in re.finditer(r"'((?:[^'\\\n]|\\.)+)'|\"((?:[^\"\\\n]|\\.)+)\"|`([^`${}]+)`", src):
        yield " ".join((m.group(1) or m.group(2) or m.group(3)).split())


by_file = collections.defaultdict(list)
for p in sorted(ROOT.rglob("*.tsx")) + sorted(ROOT.rglob("*.ts")):
    if p.name.endswith((".test.ts", ".test.tsx")) or "/i18n/" in p.as_posix():
        continue
    src = strip_comments(p.read_text(encoding="utf-8"))
    for text in candidates(src):
        if len(text) < 3 or SKIP.match(text) or not FR.search(text):
            continue
        if text not in by_file[p]:
            by_file[p].append(text)

total = sum(len(v) for v in by_file.values())
mode = sys.argv[2] if len(sys.argv) > 2 else "list"
if mode == "count":
    for p, items in sorted(by_file.items(), key=lambda kv: -len(kv[1]))[:25]:
        print(f"{len(items):4}  {p.relative_to(ROOT)}")
else:
    for p, items in sorted(by_file.items()):
        print("#####", p.relative_to(ROOT).as_posix())
        for it in items:
            print("   ", it)
print("TOTAL", total)
