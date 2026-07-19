# Color management (OCIO)

> Updated: 2026-07-20

ReView manages color with OpenColorIO (OCIO) configs. The official **ACES** configs from
the Academy Software Foundation are fetched directly from their GitHub releases; projects
then pick a display and view.

## Installing an ACES config

*Admin → Contextes de review → Couleur (OCIO)*:

1. Click **Parcourir les releases ACES** — ReView lists the releases of
   [AcademySoftwareFoundation/OpenColorIO-Config-ACES](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/releases)
   and their config assets (studio / cg).
2. **Installer** the config you want. The `.ocio` file is downloaded into the studio
   storage (MinIO). The **studio config, ACES 1.3** is flagged as the recommended default.
3. Use the **star** to set the studio default config.

Only ADMIN can browse releases or install; the fetch targets a fixed, trusted repository
and the download host is allow-listed.

## Per-project display / view

*Project → Settings → Gestion de couleur (OCIO)*: pick a config (or keep the studio
default), then a **display** and a **view** from that config. The lists are read from the
installed `.ocio` file. The choice sets the project's color intent, shown as an `OCIO`
badge in the 3D review viewer.

> Pixel-exact OCIO transforms applied to the rendered image (via OCIO wasm / GPU LUTs) are
> a later step; this release covers config management and display/view selection.

## Related pages

- [Pipeline settings](pipeline-settings.md)
- [3D review](../user-guide/review-3d.md)
