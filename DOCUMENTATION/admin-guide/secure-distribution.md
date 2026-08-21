# Secure distribution

> Updated: 2026-08-21

*Admin → Review contexts → **Delivery*** (`/admin/distribution`) groups everything
related to getting media out of the studio safely: the studio logo, the viewer
watermark and the FFmpeg burn-ins and slates. Share links themselves are created from
each project.

## Studio logo

Upload a **PNG, JPEG or WebP**. Two steps:
`POST /api/studio/logo/presign` (`ADMIN`) returns a 15-minute presigned PUT to
`branding/logo-{timestamp}.{ext}`, then the key is saved with
`PUT /api/studio/settings` under `studio_logo_key` (`ADMIN`). Removing the logo means
saving an empty value. Any authenticated account can read the current logo
(`GET /api/studio/logo`); the login and client share pages get it through the public
branding endpoint.

Security notes:

- **SVG is deliberately refused.** Branding files are served from the application's
  own origin, and an SVG is a scriptable document — accepting one would be a stored
  cross-site scripting vector on the login page.
- **There is no size limit.** The upload goes straight from the browser to MinIO with
  a presigned URL that carries no length condition. Nothing stops an administrator
  from storing a 200 MB "logo" that is then fetched on every login page load.
- The logo is used on the client share page and can be burned into proxies (below).

## Viewer watermark (overlay)

A discreet tiled watermark carrying the viewer's identity, rendered **client-side**
over the media. It is a deterrent against casual leaks and screen recordings; it is
**not embedded in the file**, and a determined leaker can remove it.

Configuration (`GET /api/studio/watermark` readable by any authenticated account —
the viewers need it; `PUT` requires `ADMIN`). Three fields only:

| Option | Default | Effect |
|--------|---------|--------|
| **On client shares** (`shares`) | **on** | The public client page overlays *link label — studio name — date*. |
| **In internal reviews** (`internal`) | **off** | Review viewers overlay *account name (or email if no name) — date*, for every media type: video, image, 3D, splat, including A/B compare panes. |
| **Opacity** (`opacity`) | **0.08 (8 %)** | 2–40 %. Blend mode `difference` keeps it readable on both light and dark footage. |

This is a **studio-wide** switch. There is no per-project and no per-link override: if
one client needs a watermark, everybody gets one.

The public client page never receives the `internal` flag — the API projects only
`{ enabled: shares, opacity }` — so turning on internal watermarking cannot leak the
fact to external viewers.

For watermarking embedded in the pixels, use burn-ins below (custom text). A
**per-viewer** server-side burn-in is intentionally not offered: it would require one
transcode per viewer.

## Burn-ins & slates (FFmpeg)

Configured as a **studio template** (`GET`/`PUT /api/admin/burnin`, `ADMIN`, audit
`BURNIN_CONFIG_UPDATE`) and overridable **per project** (*Project → Settings →
Burn-ins & slates*, through `PUT /api/projects/:projectId/settings`, effective project
role `SUPERVISOR` — a project supervisor can do this). The project override is
partial: it is merged field by field onto the studio template.

| Field | Default | Element |
|-------|---------|---------|
| `enabled` | **`false`** | **Master switch for every burn-in below** |
| `showShot` | `true` | Shot code, top left |
| `showVersion` | `true` | Version name, top right |
| `showTimecode` | `true` | Timecode, bottom centre, at the media's probed fps |
| `showLogo` | `false` | Studio logo, bottom right |
| `customText` | empty | Free text, bottom left — e.g. `CONFIDENTIAL`; max 120 characters |
| `slate` | `false` | 3-second slate at the head of the client derivative |

> **Nothing is burned in on a fresh install.** `showShot`, `showVersion` and
> `showTimecode` are `true`, but `enabled` is `false` and gates all of them. Turning on
> the individual elements without turning on `enabled` produces no visible change,
> which is the single most common misreading of this screen.

Applied by the worker at transcode time to the review proxy **and every HLS
rendition**, so they affect **future uploads and reprocesses only**. Font size scales
with the rendition height (`height / 32`, minimum 10 px), drawn white on a 35 % black
box. Fonts: `fonts-dejavu-core` is installed in the worker image — FFmpeg `drawtext`
fails without a font.

Two silent-failure modes worth knowing:

- If `showLogo` is on but no `studio_logo_key` is set (or the object cannot be
  downloaded), the worker logs a warning and encodes **without** the logo. The
  transcode succeeds; nobody is told the logo is missing.
- Burn-in resolution as a whole is best effort. A failure leaves the media transcoded
  with no burn-ins rather than failing the job.

### Slates and the client derivative

When **`slate`** is enabled, the worker renders a **3-second** identification card
(studio name, project, shot, version, artist, file name, date — empty fields are
skipped) and concatenates it in front of the review proxy. The result is written to a
**separate derivative**, `derived/{mediaId}/client.mp4`, recorded as
`metadata.clientProxyKey` with `metadata.slateSec`.

- **The internal review proxy never gets a slate.** Prepending frames would shift
  every frame-accurate annotation and every timeline marker by three seconds.
- Only the public client page serves the slated derivative, and it offsets comment
  timestamps by `slateSec` in **both** directions — subtracting when posting,
  adding when seeking — so timestamps stay expressed in the media's own timeline.
- The client derivative also carries whatever burn-ins the proxy already has, because
  it is built from the proxy.
- `slate` is **independent of `enabled`**: `slate: true, enabled: false` produces a
  slated client derivative with no burn-ins. That is a legitimate configuration.
- It applies to **video only** and is best effort. If it fails, the share serves the
  un-slated proxy and reports `slateSec: 0`, so timestamps stay correct either way.

## Hardened share links

Creating, listing and revoking share links requires a **global `ADMIN` or
`SUPERVISOR`** plus access to the project. A *project* supervisor cannot issue one —
see [Users & roles](users-and-roles.md#the-subtle-case-the-project-supervisor). The
full user-facing model is in [Sharing with clients](../user-guide/sharing.md).

Options at creation: an optional **password** (4–200 characters, hashed with bcrypt
cost 12, never returned — the API exposes only `hasPassword`), an optional **expiry**
(1–3650 days), an optional **view limit** (1–1 000 000) and a **permission**
(`VIEW` by default, or comment). Audit actions `SHARE_CREATE` and `SHARE_REVOKE`.

Security properties, and their exact limits:

- **Share sessions.** Every public media or comment route requires a session token in
  the `X-Share-Auth` header — a JWT valid **24 hours**, bound to one link, and
  rejected if it is an ordinary user token. Issuing a session is the only way to
  consume a view.
- **View-limit consumption has no race.** It is a single conditional update
  (`SET viewCount = viewCount + 1 WHERE id = ? AND viewCount < maxViews`); zero rows
  affected means the limit was reached, and the request gets **410**.
  Note that an **already-issued session keeps working for its full 24 hours** on an
  exhausted link — the limit counts sessions opened, not requests served.
- **Unknown, revoked and expired tokens all return the same 404**, so those three
  states cannot be told apart. They are not, however, indistinguishable from every
  other state: a **valid but password-protected** token answers `200 { locked: true }`
  and an **exhausted** one answers `410`. An attacker can therefore learn that a token
  exists — they simply cannot use it.
- **Password unlock is rate-limited** to **10 requests per 15 minutes**, keyed on IP
  *and* token, and failures are audited as `SHARE_UNLOCK_FAIL`. Three caveats: it
  counts all attempts, not only failures (a legitimate user reloading burns budget);
  the window is fixed, not sliding; and the limiter is **in-process**, so it does not
  hold across multiple API replicas.
- **Media URLs are presigned MinIO GETs valid one hour**, and the client page caches
  the response for five minutes. Anyone the recipient forwards a URL to can fetch the
  file for that hour without the password.
- **Deleting the account that created a link revokes the link.** Demoting it does not.

---

## Use case: sending a cut to a client under NDA

*Legal wants the studio name and "CONFIDENTIAL" on the picture, and the link to die
after a week.*

1. *Admin → Delivery → Burn-ins*: set `enabled` **on**, `customText` to
   `CONFIDENTIAL`, and `showLogo` on after checking that a studio logo is actually
   uploaded. Turn on `slate` if legal wants an identification card at the head.
2. Understand the timing: burn-ins are applied **at transcode time**. Media already in
   the studio has none. Either upload the cut after changing the setting, or reprocess
   it — which is impossible once the version is published (`403 PUBLISHED_LOCKED`).
   In practice: change the setting **before** the deliverable is uploaded.
3. If only this show needs it, set the override on the project instead of the studio
   template, so every other project keeps its current look.
4. Leave the client-share watermark on (the default) — it adds the recipient's label
   on top of the burned-in text, which is what makes a leak attributable to a person
   rather than to the studio.
5. Create the share link (global manager role) with a password, a 7-day expiry, and a
   view limit if the number of viewers is known. Send the password by a different
   channel than the link.
6. Note what expiry does **not** do: a presigned media URL already handed out stays
   valid for its remaining hour after the link expires.

## Use case: a link leaked outside the client

*The cut turned up somewhere it should not have.*

1. **Revoke the link first** (*Project → Shares → revoke*). Existing share sessions
   stop working immediately on the next request — revocation is checked per request,
   not cached like user sessions.
2. Presigned media URLs already issued survive up to **one hour**. There is no way to
   invalidate them short of rotating the MinIO credentials. Say so plainly when
   reporting the incident rather than claiming instant containment.
3. *Admin → Maintenance → Media access* gives one line per consultation with the link
   label, the IP and the timestamp, deduplicated over 30 minutes. That is the evidence
   of who fetched what and when.
4. *Maintenance → Audit*: `SHARE_CREATE` tells you who issued it and when;
   `SHARE_UNLOCK_FAIL` bursts tell you whether the password was being guessed.
5. If the leaked copy carries a client-share watermark, the recipient label is legible
   in the image and identifies the link — this is exactly the case the overlay exists
   for.
6. Re-issue with a view limit and a shorter expiry. Consider turning on the **internal**
   watermark too if the leak may have come from inside.

## Use case: enabling internal watermarking without a revolt

*Production wants every internal review watermarked.*

1. Set `internal` on and start at the default opacity of 8 %. The `difference` blend
   makes it legible on both dark plates and white boards without hiding detail.
2. Warn the compositing and lighting teams first: the overlay sits over **every**
   media type including A/B compare panes, and colour-sensitive work is exactly where
   an 8 % overlay is felt. Agree on a value before turning it on, not after.
3. It is studio-wide. There is no way to exempt one project, one department or one
   review — the only lever is the opacity slider (2–40 %).
4. It costs nothing server-side: it is a CSS overlay, no re-encode, no storage, and it
   applies retroactively to all existing media the moment you save.

## Related pages

- [Sharing with clients](../user-guide/sharing.md)
- [Transcoding](transcoding.md) — burn-ins are applied at the same step
- [Users & roles](users-and-roles.md)
- [Identity, API & audit](identity-and-api.md)
- [Branding & notifications](branding-and-notifications.md)
