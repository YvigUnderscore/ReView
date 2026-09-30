// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Shim `process` pour les libs qui le référencent côté navigateur (ex. Excalidraw)
globalThis.process = globalThis.process || { env: { NODE_ENV: import.meta.env.MODE } };

import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import App from './v2/App.tsx';
import { ErrorBoundary } from './v2/components/ui/error-boundary.tsx';
import { initLocale } from './v2/i18n';
import './index.css';

// Filet de dernier recours : au-dessus du routeur, il n'y a plus rien pour rattraper une
// exception de rendu — l'utilisateur se retrouvait devant un écran blanc.
const render = () =>
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary scope="root">
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );

// Le catalogue de la langue retenue est chargé avant le premier rendu, et ce blocage est
// délibéré : aucun catalogue n'est embarqué dans le bundle livré (correctif F1), si bien
// qu'un rendu anticipé n'afficherait pas de l'anglais mais les clés elles-mêmes —
// « common.save » à l'écran. L'attente est en revanche raccourcie en amont : le document
// précharge le catalogue dès son analyse (`i18nCatalogPreload` dans `vite.config.js`), donc
// les octets sont déjà là quand cette ligne s'exécute.
// `finally` — un catalogue illisible ne doit pas empêcher l'application de démarrer, le
// repli anglais suffit.
initLocale().finally(render);
