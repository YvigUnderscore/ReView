# Client Python ReView : écart aux conventions

*Audit de `clients/python` (paquet `review`, CLI `review`) et de `clients/dcc` (add-on Blender, intégration Nuke). Branche `dev`.*

> Updated: 2026-10-29

## Résumé

Le client est **petit, lisible et bien pensé sur le fond** : bibliothèque standard uniquement (contrainte DCC assumée et documentée), hiérarchie d'erreurs propre, retries avec backoff + jitter, rejeu des écritures **seulement** sous `Idempotency-Key`, URLs présignées ouvertes sans `Authorization`, tests sans réseau via un *opener* injecté. Après les correctifs de cet audit : 51 tests passent (`unittest` et `pytest`), couverture de lignes **91 %**, `ruff check` propre sur `clients/`.

Les écarts restants tiennent surtout à l'**outillage et au contrat** plus qu'au code : pas de typage vérifié (17 erreurs `mypy --strict`), pas de marqueur PEP 561, docstrings non Google, aucune journalisation, version déclarée à trois endroits, pas de CI (en cours d'ajout par ailleurs), et quelques désaccords avec le comportement réel du backend (`409 IDEMPOTENCY_IN_PROGRESS` non rejoué, `429` sans `Retry-After`).

| Gravité | Nombre | Corrigés dans ce lot |
|---|---|---|
| Critique | 3 | 2 |
| Majeur | 10 | 1 |
| Mineur | 13 | 2 |

Les numéros de ligne renvoient à l'état du dépôt **après** ce lot.

## Corrigé dans ce lot

| Constat | Gravité | Correctif |
|---|---|---|
| `download` sans retry, `HTTPError`/`URLError` bruts qui fuyaient hors de la hiérarchie `ReviewError`, fichier partiel laissé sur disque en cas d'échec, destination écrasée en place (un lecteur pouvait voir une demi-plaque) | Critique | `client.py:262-350` : retry selon `RetryPolicy` (429/5xx, coupure, timeout, corps tronqué vs `Content-Length`), URL re-signée à chaque tentative, erreurs typées `ReviewApiError` / `ReviewTransportError`, écriture dans un `.<nom>.<uuid>.part` voisin puis `fsync` + `os.replace` atomique, suppression du partiel sur toute erreur. Les erreurs **disque** (`OSError` local) ne sont ni rejouées ni déguisées. 7 tests (`tests/test_client.py`, classe `AtomicDownloads`). |
| `review latest --download DIR` : `filename` fourni par le serveur joint tel quel au dossier — un nom `../../.bashrc` écrivait hors du dossier choisi | Critique | `cli.py:82-89` : `os.path.basename`, création du dossier ; test `test_download_never_writes_outside_the_chosen_folder`. |
| `http.client.IncompleteRead` / `RemoteDisconnected` (`HTTPException`, pas `OSError`) échappaient aux boucles de retry de `_send` et `upload` | Majeur | `client.py:48` : `_TRANSPORT_ERRORS` partagé par `_send`, `upload`, `download`. |
| `OSError` local dans la CLI → traceback brut | Mineur | `cli.py:158-160` : message sur stderr, code de sortie `1`. |
| Pas de configuration de lint ; 9 erreurs ruff par défaut, `assertRaises(Exception)` aveugle (`tests/test_publish.py:116`), commentaires restés en français | Mineur | `[tool.ruff]` dans `pyproject.toml` (E/W/F/I/N/B/UP/C4/SIM/PIE/T20/D Google/RUF, `py310`, 110 colonnes), `clients/dcc/ruff.toml` qui l'étend ; `[tool.pytest.ini_options]`. |

## Constats restants, par priorité

### Critique

**C1 — Le jeton peut partir vers un hôte arbitraire.** `client.py:112` : `url_for` accepte tout chemin commençant par `http` comme URL absolue, et `request` y attache `Authorization: Bearer` (`client.py:130`). Un appel `request("GET", "https://ailleurs/...")` — ou une URL renvoyée par le serveur et rejouée — envoie le jeton `rvk_` à un tiers. *Remède* : n'accepter une URL absolue que si son origine (schéma + hôte + port) est celle de `base_url`, sinon `ValueError` ; refuser `http://` hors `localhost` (ou au minimum avertir), car le jeton circule en clair.

### Majeur

**M1 — `409 IDEMPOTENCY_IN_PROGRESS` n'est pas rejoué.** Le backend répond `409` quand un rejeu arrive pendant que la première requête tourne encore (`DOCUMENTATION/api/v1-integration.md`, section *Idempotency*). C'est exactement le cas d'un timeout côté poste suivi d'un retry ; `RETRYABLE_STATUS` (`client.py:45`) ne contient pas `409`, donc la publication échoue alors que le serveur est en train de la réussir. *Remède* : rejouer `409` **si** `code == "IDEMPOTENCY_IN_PROGRESS"` et que la requête porte une clé.

**M2 — `429` sans `Retry-After` : le backoff est trop court pour le limiteur réel.** Le backend ne pose aucun `Retry-After` (`backend/src/middleware/rateLimit.ts:158-172`) et compte sur une fenêtre de 15 minutes. Le client retombe alors sur 0,5 s → 1 s → 2 s (`client.py:65-67`) : quatre tentatives brûlées en 3,5 s, puis échec. *Remède* côté client : plancher spécifique au 429 (p. ex. 30 s, plafonné par `max_sleep`) ; côté backend (hors périmètre) : émettre `Retry-After` / `RateLimit-*`. Gérer aussi la forme date HTTP de `Retry-After` (`client.py:385-390`, aujourd'hui ignorée) via `email.utils.parsedate_to_datetime`.

**M3 — Aucune journalisation.** Ni `logging.getLogger(__name__)` ni trace des retries : sur une ferme, un publish qui a dormi 30 s puis réussi est invisible, et un échec ne dit pas combien de tentatives ont eu lieu. *Remède* : `logger = logging.getLogger("review")` + `NullHandler` dans `__init__.py` (convention des bibliothèques), `debug` par requête (méthode, chemin, statut, durée, `x-request-id` renvoyé par le backend — `backend/src/middleware/httpLogger.ts:118-124`), `warning` par retry ; option `-v/--verbose` dans la CLI. Les `print` restent cantonnés à `cli._say` (`cli.py:28-39`), ce qui est correct.

**M4 — Typage non vérifié, et faux par endroits.** `mypy --strict review` : 17 erreurs, surtout `dict` / `list` nus (`errors.py:47`, `publish.py:33-37`, `client.py:175-245`). Plus gênant : `request()` est annoncé `-> dict` mais renvoie ce que donne `json.loads`, soit `None` pour un corps `null` — le test `test_an_empty_body_decodes_to_an_empty_mapping` (`tests/test_client.py:74-76`) **affirme `None`**, contredisant son nom et la docstring (`client.py:126`). `publish()` n'a pas de type de retour (`client.py:378`) et `publish_file(client: Any, …)` (`publish.py:56`) perd toute vérification. *Remède* : `JSON = dict[str, Any]`, normaliser les corps non-objet en `{}` ou lever `ReviewTransportError`, un `Protocol` `_Session` pour `publish_file`, `-> PublishResult`, puis `[tool.mypy] strict = true` en CI.

**M5 — Pas de marqueur PEP 561.** Sans `review/py.typed` (et `package-data` correspondant), les annotations sont invisibles pour les outils des studios qui importent le paquet installé.

**M6 — Réponse 2xx non-JSON = exception brute.** `json.loads(raw)` (`client.py:141`) lève `json.JSONDecodeError` quand un proxy d'entreprise renvoie une page HTML en 200 ; de même `answer["url"]` (`client.py:222`) et `["reviewers"]` lèvent `KeyError`. Ces erreurs sortent de la hiérarchie `ReviewError` que la docstring de `errors.py:1-15` promet exhaustive. *Remède* : une `ReviewProtocolError(ReviewError)` (ou réutiliser `ReviewTransportError`) pour « réponse illisible ».

**M7 — Version déclarée à trois endroits, divergents.** `pyproject.toml:10` (`1.0.0`), `review/__init__.py:35` (`1.0.0`), `USER_AGENT` (`client.py:46`, `1.0`), plus `bl_info["version"]` (`dcc/blender_review_publish.py:22`). *Remède* : source unique (`version` dynamique lue depuis `review/__init__.py`, ou `importlib.metadata.version("review-client")` avec repli), `USER_AGENT` dérivé de `__version__` + version de Python/DCC ; tenir un journal des changements du client (SemVer, puisque `/api/v1` est un contrat versionné).

**M8 — `--token` sur la ligne de commande.** `cli.py:109` : un jeton passé en argument apparaît dans `ps`, l'historique du shell et les logs de la ferme. *Remède* : garder `$REVIEW_TOKEN`, ajouter `--token-file` / lecture sur stdin, et marquer `--token` comme déconseillé dans l'aide.

**M9 — Add-on Blender bloquant.** `dcc/blender_review_publish.py:63` publie (hash SHA-256 + upload de plusieurs Go) dans `execute()`, sur le thread de l'interface : Blender gèle pendant toute la durée. *Remède* : opérateur modal + thread de travail, ou `bpy.app.timers`, avec progression ; à défaut, documenter le gel. Blender ≥ 4.2 privilégie par ailleurs le format *extension* (`blender_manifest.toml`) au `bl_info` historique (`:19`).

**M10 — Aucune vérification automatique.** Rien n'exécute les tests, ruff ou mypy (le job CI Python est en cours d'ajout par un autre lot). Le code DCC n'est ni testé ni typé : `nuke_review_publish.py` appelle `register()` **à l'import** (`:114`), ce qui interdit de l'importer pour le tester. *Remède* : job CI `ruff check clients && python -m pytest --cov=review --cov-fail-under=90` sur 3.10 → 3.13 ; garder l'enregistrement Nuke dans `menu.py` plutôt qu'à l'import ; tests DCC avec des modules `bpy`/`nuke` factices.

### Mineur

- **m1 — Docstrings non Google (PEP 257 partiel).** Les docstrings expliquent le *pourquoi* (c'est leur force) mais sans sections `Args:` / `Returns:` / `Raises:` ; `url_for`, `RetryPolicy.delay`, `build_parser`, `main` n'en ont pas. ruff applique désormais la convention Google, mais `D1` (docstrings manquantes) est ignoré en attendant : à réactiver. `download` sert de modèle.
- **m2 — Packaging PEP 621 incomplet.** `license = { text = … }` (`pyproject.toml:14`) est la forme dépréciée par PEP 639 (`license = "AGPL-3.0-or-later"` + `license-files`, setuptools ≥ 77) ; classifiers sans versions Python ni licence (`:21-25`) ; pas d'`[project.urls]` ni d'`[project.optional-dependencies] dev = ["pytest", "coverage", "ruff", "mypy"]`.
- **m3 — Promesse de compatibilité contradictoire.** `README.md:7` affirme que le paquet importe sur 3.8/3.9, `requires-python = ">=3.10"` (`pyproject.toml:13`) dit l'inverse, et rien ne le vérifie. Or Maya 2022 et Nuke 13 embarquent 3.7, Nuke 14 la 3.9. *Remède* : choisir une borne, la tester en CI, aligner `target-version` de ruff.
- **m4 — `RetryPolicy` sans validation.** `attempts=0` fait tomber `_send` sur « No attempt was made » et `upload` sur un `return None` silencieux (`client.py:352-376`). Valider dans `__post_init__` (`attempts >= 1`, délais ≥ 0).
- **m5 — `timeout or self.timeout`** (`client.py:140`) traite `0` comme « par défaut » ; utiliser `is None`.
- **m6 — Segments de chemin non échappés.** `project_settings(ref)` (`client.py:241`) et les `f"/api/v1/…/{id}"` n'appliquent pas `urllib.parse.quote(…, safe="")` : un `ref` contenant `/` ou `?` change de route.
- **m7 — Pas de pool de connexions.** Chaque appel `urllib` ouvre une connexion TCP + TLS neuve. Acceptable vu la contrainte « stdlib », mais à documenter (impact sur un `events()` en boucle).
- **m8 — Hiérarchie d'erreurs plate.** `ReviewApiError` couvre tout ; des sous-classes `ReviewAuthError` (401/403), `ReviewNotFoundError` (404), `ReviewRateLimitError` (429) permettraient `except` ciblés sans tester `status`. Exposer aussi `details` (erreurs Zod 400 sans `code`, cf. *Errors and limits*) et `request_id`. `ReviewTransportError.cause` duplique `__cause__`. Les constructeurs à mots-clés obligatoires rendent les exceptions non *picklables* (gênant avec `multiprocessing`) : implémenter `__reduce__`.
- **m9 — Surface publique.** `latest()` lève `ValueError` (`client.py:211`) hors hiérarchie — défendable (erreur de programmation) mais à documenter ; `url_for` est public sans raison ; `CHUNK` est défini deux fois (`client.py:43`, `publish.py:25`) ; seule une partie de `/api/v1` est couverte (pas de pagination, commentaires, décisions, ensure) — à expliciter dans le README.
- **m10 — Validation des bornes du contrat.** `expires_in` (60–86 400 s) et `limit` d'`events` ne sont pas vérifiés localement ; le serveur répond `400`, ce qui coûte un aller-retour.
- **m11 — CLI.** Pas de `--version`, pas de `-v`, pas de `--timeout`, `file` sans aide (`cli.py:115`), `KeyboardInterrupt` → traceback au lieu du code 130, erreur réseau et refus API partagent le code `1`. Envisager `3` pour « transport ».
- **m12 — Tests.** `unittest` est un choix justifié (doit tourner dans l'interpréteur d'un DCC) et `pytest` le collecte tel quel — garder les deux. Manquent : `Retry-After` en date HTTP, `409` d'idempotence, URL absolue étrangère (C1), réponse 2xx non JSON (M6). `test_reads_the_workstation_environment` modifie `os.environ` à la main : `unittest.mock.patch.dict` est plus sûr. `__main__.py` à 0 % de couverture.
- **m13 — `__pycache__` suivi par git.** Des `.pyc` étaient commités sous `clients/python/**/__pycache__/` ; leur retrait et l'entrée `.gitignore` sont traités par le lot CI.

## Conformité au contrat `/api/v1` du dépôt

| Convention backend | Client | État |
|---|---|---|
| Enveloppe `{ error, code }`, brancher sur `code` | `ReviewApiError.code`, message jamais interprété | Conforme |
| Erreurs Zod : `400` + `details`, sans `code` | `payload` conservé, `details` non exposé | Partiel (m8) |
| `Idempotency-Key` sur les deux appels de publish, clés distinctes | `key` / `key + "-complete"` (`publish.py:87-123`) | Conforme |
| `409 IDEMPOTENCY_IN_PROGRESS` → réessayer | Non rejoué | **Écart (M1)** |
| `Idempotency-Replayed: true` | Ignoré (aucun impact fonctionnel) | Acceptable |
| `429` : limiteur 15 min, sans `Retry-After` | Backoff 0,5 → 2 s | **Écart (M2)** |
| `x-request-id` renvoyé pour corrélation | Ni lu ni journalisé | Écart (M3) |
| Booléens de requête en chaînes `"true"`/`"false"` | `_bool()` (`client.py:70`) | Conforme |
| URLs présignées sans `Authorization` | `download`, `upload` | Conforme |
| `expiresIn` borné 60–86 400 | Non validé | Mineur (m10) |

## Plan de remédiation

| Étape | Contenu | Effort |
|---|---|---|
| 1. Sécurité (immédiat) | C1 (origine de `url_for`, refus de `http://`), M8 (`--token-file`) | ½ j |
| 2. Contrat backend | M1 (409 idempotence), M2 (plancher 429, `Retry-After` en date HTTP ; proposer `Retry-After` côté backend), M6 (`ReviewProtocolError`), m6 (échappement des segments) | 1 j |
| 3. Outillage | Job CI (ruff + pytest + couverture ≥ 90 %, matrice 3.10–3.13), `[tool.mypy] strict`, M4/M5 (`py.typed`, `Protocol`, `JSON`), m2 (PEP 639, `optional-dependencies`), m3 (borne Python unique) | 1–1½ j |
| 4. Observabilité & versionnage | M3 (`logging` + `-v`), M7 (version unique, `User-Agent` complet, changelog du client), m11 (CLI) | 1 j |
| 5. Finition | m1 (docstrings Google, réactiver `D1`), m8 (sous-classes d'erreurs, pickling), m4/m5/m9/m10, tests manquants (m12) | 1–2 j |
| 6. DCC | M9 (publication non bloquante dans Blender, manifeste d'extension), M10 (enregistrement Nuke hors import, tests avec `bpy`/`nuke` factices) | 1–2 j |

## Vérification

```bash
cd clients/python
python -m unittest discover -s . -t .     # 51 tests
python -m pytest                          # même suite
ruff check .. && ruff format --check ..   # clients/python + clients/dcc
```
