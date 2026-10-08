// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Les commandes de l'application sont déclarées : chacune devient une permission
// (`allow-<commande>`) que seules les capacités du lanceur et du diagnostic accordent.
// Sans manifeste, toute fenêtre locale pourrait les appeler.
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "app_info",
            "host_info",
            "list_servers",
            "connect",
            "remove_server",
            "launcher_ready",
            "open_diagnostic",
            "open_notices",
            "open_link",
        ]),
    ))
    .expect("échec de tauri-build");
}
