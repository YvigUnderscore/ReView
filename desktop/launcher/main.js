// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { start } from './app.js';
import { tauriApi } from './lib/api.js';

void start({
  root: document.getElementById('app'),
  footer: document.getElementById('footer'),
  api: tauriApi(window.__TAURI__.core.invoke),
  languages: navigator.languages,
  fetchJson: (path) => fetch(path).then((r) => r.json()),
  win: window,
});
