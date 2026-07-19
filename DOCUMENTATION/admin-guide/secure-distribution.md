# Secure distribution

> Updated: 2026-07-19

The **Admin → Review contexts → Distribution** section groups everything related to
secure media distribution: studio logo, viewer watermark and FFmpeg burn-ins/slates.

## Studio logo

Upload a PNG/JPEG/WebP logo (stored in MinIO, `Setting studio_logo_key`). It is
shown on the public client share page and can be burned into proxies (see below).

## Viewer watermark (overlay)

A discreet tiled watermark with the viewer's identity, rendered client-side over
the media (deterrent against leaks — it is not embedded in the file):

| Option | Effect |
|--------|--------|
| **On client shares** (default: on) | Client page overlays *recipient label — studio — date*. |
| **In internal reviews** (default: off) | Review viewers overlay *account name — date* for every media type (video, image, 3D, splat, including A/B compare modes). |
| **Opacity** | 2–40 %. Blend mode `difference` keeps it readable on light and dark footage. |

For watermarking embedded in the pixels, use burn-ins below (custom text) — a
per-viewer server-side burn-in is intentionally not offered (it would require one
transcode per viewer).

## Burn-ins & slates (FFmpeg)

Configured as a **studio template**, overridable **per project** (project →
Settings → "Burn-ins & slates"). Applied by the worker at transcode time to the
review proxy **and** every HLS rendition — so they affect **future uploads and
reprocesses only**.

Elements (each toggleable): shot code (top left), version name (top right),
timecode (bottom center, at media fps), studio logo (bottom right, overlay input),
free text (bottom left — e.g. `CONFIDENTIAL`). Font size scales with the rendition
height. Fonts: `fonts-dejavu-core` is installed in the worker image (FFmpeg
`drawtext` fails without a font).

### Slates and the client derivative

When **"Slate at the head of client shares"** is enabled, the worker renders a
3-second identification card (studio, project, shot, version, artist, file, date)
and concatenates it **in front of a separate derivative**
(`derived/<id>/client.mp4`, `metadata.clientProxyKey` + `slateSec`).

**The internal review proxy never gets a slate**: prepending frames would shift
every frame-accurate annotation and timeline marker. Only the public client page
serves the slated derivative, and it offsets comment timestamps by `slateSec` in
both directions (posting and seeking), so timestamps stay expressed in the media's
own timeline.

## Hardened share links

See [Sharing with clients](../user-guide/sharing.md) for the full model
(password, expiry, view limit, share sessions, audit trail). Key security
properties:

- share sessions are signed 24 h JWTs bound to one link; every public media/comment
  route requires one — issuing a session is the only way to consume a view;
- view-limit consumption is an atomic SQL increment bounded by `maxViews` (no race);
- unknown, revoked and expired tokens return the same 404 (no enumeration oracle);
- password unlock is rate-limited (10 attempts / 15 min per IP + token) and failures
  are audited;
- media URLs are short-lived presigned MinIO GETs.
