// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Shim `process` pour les libs qui le référencent côté navigateur (ex. Excalidraw)
globalThis.process = globalThis.process || { env: { NODE_ENV: import.meta.env.MODE } }

import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import App from './v2/App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
