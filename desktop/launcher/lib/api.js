// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Commandes Rust exposées au lanceur (`src-tauri/src/main.rs`). Une seule porte d'entrée,
 * ce qui permet aux tests de la remplacer par un double.
 */
export function tauriApi(invoke) {
  return {
    appInfo: () => invoke('app_info'),
    listServers: () => invoke('list_servers'),
    connect: (address, badge) => invoke('connect', { address, badge }),
    removeServer: (origin) => invoke('remove_server', { origin }),
    ready: () => invoke('launcher_ready'),
    openDiagnostic: (title) => invoke('open_diagnostic', { title }),
    openNotices: (title) => invoke('open_notices', { title }),
    openLink: (which) => invoke('open_link', { which }),
  };
}
