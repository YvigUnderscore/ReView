<!--
SPDX-FileCopyrightText: 2026 Yvig Bidon
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# ReView desktop — spike de validation du webview

Ce dossier ne contient pas l'application desktop. Il contient la mesure qui décide si
cette application est possible, et sur quels OS.

## La question posée

L'app desktop visée embarque le backend ReView en mode local et affiche le frontend
existant dans une fenêtre Tauri. Le frontend parle au backend en URL relatives (`/api`,
`/socket.io`), donc il n'a rien à changer : il tourne dans la fenêtre comme il tourne
dans un navigateur. Toute l'architecture repose sur cette hypothèse.

Sauf que la fenêtre Tauri n'est pas un navigateur : c'est le webview de l'OS.

| OS      | Moteur     | Risque                                             |
| ------- | ---------- | -------------------------------------------------- |
| Windows | WebView2   | faible — Chromium                                  |
| macOS   | WKWebView  | faible — WebKit à jour                             |
| Linux   | WebKitGTK  | **élevé** — WebGL historiquement faible et instable |

Le viewer de ReView n'est pas une page de formulaires : Three.js r183, Spark (gaussian
splats), hls.js, décodage vidéo, textures flottantes. Si WebKitGTK ne suit pas, Linux a
besoin d'un repli, et il vaut mieux le savoir maintenant que six mois plus tard.

## Lancer la mesure

Prérequis : [dépendances système Tauri](https://tauri.app/start/prerequisites/) et Rust.

```bash
cd desktop
npm install
npm run probe        # ouvre la fenêtre sur la page de diagnostic
```

La page `probe/` est autonome : pas de backend, pas de base, pas de réseau. Elle
interroge exactement ce dont le viewer a besoin, puis dessine 4 000 instances pendant
deux secondes pour mesurer un débit réel — c'est ce chiffre qui distingue un vrai GPU
d'un pilote qui déclare tout et rame.

**Le test n'a de sens qu'en comparaison.** Ouvrir ensuite `probe/index.html` dans le
Chrome de la même machine : c'est la référence. Un écart entre les deux accuse le
webview ; un résultat également mauvais des deux côtés accuse la machine.

À faire sur les trois OS, en collant le rapport JSON (bouton « Copier ») dans l'issue de
suivi.

## Lire le résultat

Le verdict en tête de page tranche, mais trois sondes commandent tout :

- **WebGL 2 absent** → le viewer ne démarre pas. Plateforme disqualifiée, point final.
- **Carte utilisée = llvmpipe / SwiftShader** → rendu logiciel, le GPU n'est pas câblé au
  webview. Sur Linux, cause la plus fréquente d'un échec WebKitGTK.
- **Débit < 25 i/s** → le viewer tourne sur le papier et pas en pratique.

Le reste nuance : `EXT_color_buffer_float` manquant dégrade le pipeline HDR (tone mapping
ACES en 8 bits), `requestVideoFrameCallback` manquant fait dériver le calage des
annotations d'une frame, H.264/AAC manquants cassent la lecture des proxies.

## Si Linux échoue

Trois sorties, par ordre de préférence :

1. Forcer un meilleur chemin GPU côté WebKitGTK (`WEBKIT_DISABLE_DMABUF_RENDERER`,
   pilotes propriétaires) — à tester avant de renoncer.
2. Electron pour Linux seulement : même frontend, moteur Chromium, au prix d'un second
   pipeline de build.
3. Linux reste en mode serveur : l'app ne cible que Windows et macOS, les postes Linux
   ouvrent `localhost` dans leur navigateur.

## Tester le vrai frontend

La page de diagnostic mesure le moteur ; elle ne prouve pas que le viewer de ReView
fonctionne. Pour ça, lancer le frontend et le backend comme d'habitude, puis :

```bash
npm run app          # charge http://127.0.0.1:5173 dans la fenêtre Tauri
```

Vite proxifie déjà `/api` et `/socket.io` vers le backend : rien à configurer. Ouvrir un
plan avec de la 3D, scruber une vidéo, poser une annotation.

## Ce que ce dossier n'est pas

Pas de pair iroh, pas de synchronisation, pas de Postgres embarqué, pas de sidecar. Ces
briques viennent après, et seulement si la mesure passe. Le binaire Rust ouvre une
fenêtre et expose une seule commande (`host_info`) ; il n'a aucune permission disque,
shell ou réseau.

L'icône est provisoire.
