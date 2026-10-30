// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Shim for `process`, for libs that reference it on the browser side (e.g. Excalidraw)
(globalThis as unknown as { process?: unknown }).process ??= { env: { NODE_ENV: import.meta.env.MODE } };

import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import App from './v2/App.tsx';
import { ErrorBoundary } from './v2/components/ui/error-boundary.tsx';
import { initLocale } from './v2/i18n';
import './index.css';

// Last-resort safety net: above the router there is nothing left to catch a
// render exception, and the user was left facing a blank screen.
const render = () =>
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary scope="root">
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );

// The catalog of the chosen language is loaded before the first render, and this wait is
// deliberate: no catalog is embedded in the delivered bundle (fix F1), so
// an early render would show not English but the keys themselves,
// "common.save", on screen. The wait is however shortened upstream: the document
// preloads the catalog as soon as it is parsed (`i18nCatalogPreload` in `vite.config.js`), so
// the bytes are already there when this line runs.
// `finally`: an unreadable catalog must not prevent the application from starting, so
// the English fallback is enough.
void initLocale().finally(render);
