# Secure distribution

*Everything that leaves the studio: the logo, the watermark, burn-ins, slates, and what one hardened link really bounds.*

> Updated: 2026-08-23

Getting a shot out of the building is the one operation nobody can undo. Once a file has been
watched by someone outside the studio, the only levers left are the ones that were set
*before* it left: what was drawn into the pixels, what was written over the picture, and how
narrow the link was.

Three of those levers live on a single screen — *Admin → Review contexts → **Delivery***
(`/admin/distribution`), which carries the **studio logo**, the **viewer watermark** and the
**burn-in and slate template**. The fourth, the share link itself, is created per project, in
the project's **Shares** tab. The day-to-day gestures are in
[Sharing with clients](../user-guide/sharing.md); this page is about the settings behind them,
who may change each one, and what each one actually buys you.

## Four defences, and what each one survives

![Burn-ins live in the pixels and survive a re-encode, but only on media transcoded after the setting was turned on; the slate names the copy; the watermark overlay is drawn by the browser and survives a screenshot only; the media access log carries no picture at all and is evidence after the fact.](../assets/admin-guide/leak-attribution-layers.svg)

Read the figure as a ladder of cost. The deeper a defence sits, the more it survives — and
the more it costs to change your mind, because everything below the browser is baked at
transcode time and cannot be applied retroactively to media that is already in the studio.

| Defence | Where it is decided | Applies to media already in the studio |
|---|---|---|
| **Burn-ins** | Studio template, overridable per project | No — next transcode or reprocess only |
| **Slate** | Same template, own switch | No — next transcode or reprocess only |
| **Watermark overlay** | Studio-wide only | Yes, the moment you save |
| **Media access log** | Always on, nothing to configure | Yes, from the day it was installed |

> [!NOTE]
> There is deliberately no **per-viewer server-side burn-in**. Printing a recipient's name
> into the pixels would mean one transcode per recipient, which is a storage and a queue
> decision, not a security one. The client-side watermark is the per-viewer answer; the
> burn-in is the per-*copy* one.

## Studio logo

Upload a **PNG, JPEG or WebP**, in two steps: `POST /api/studio/logo/presign` (`ADMIN`)
returns a **15-minute** presigned `PUT` to `branding/logo-{timestamp}.{ext}`, and the returned
key is then saved with `PUT /api/studio/settings` under `studio_logo_key` (`ADMIN`). Removing
the logo means saving an empty value. Any authenticated account can read the current logo
(`GET /api/studio/logo`, presigned for an hour); the login page and the client share page get
it through the public branding endpoint, without a session.

The same file is used in three places: the login page, the header of the client share page,
and — if you switch `showLogo` on — the bottom right corner of every burned-in proxy.

> [!CAUTION]
> **There is no size limit.** The browser uploads straight to MinIO with a presigned URL that
> carries no length condition, so nothing stops a 200 MB "logo" from being fetched on every
> load of the login page. Check the file before you upload it.

**SVG is deliberately refused**, here and for the two other branding images. These files are
served from the application's own origin, and an SVG is a scriptable document: accepting one
would turn the logo upload into a stored cross-site scripting vector on the page where people
type their password.

## Viewer watermark

A discreet tiled overlay carrying the viewer's identity, drawn **client-side** over the media.
It deters casual leaks and screen recordings; it is **not in the file**, and a determined
leaker removes it.

Configuration is read by `GET /api/studio/watermark` — open to **any authenticated account**,
because the viewers need it to draw anything — and written by `PUT /api/studio/watermark`
(`ADMIN`). Three fields, and no more:

| Option | Default | Effect |
|---|---|---|
| **On client shares** (`shares`) | **on** | The public client page overlays *link label — studio name — date* |
| **In internal reviews** (`internal`) | **off** | Review viewers overlay *account name (or e-mail if no name) — date*, on every media type: video, image, 3D, splat, A/B compare panes included |
| **Opacity** (`opacity`) | **0.08 (8 %)** | Clamped to 2–40 %. Blend mode `difference` keeps it legible on both dark plates and white boards |

This is a **studio-wide** switch. There is no per-project and no per-link override: if one
client needs a watermark, everybody gets one. The only lever is the opacity slider.

The public client page never receives the `internal` flag — the API projects exactly
`{ enabled: shares, opacity }` — so turning internal watermarking on cannot leak, to an
external viewer, the fact that the studio watermarks itself.

For a mark that is *in the picture*, use the burn-in free text below.

## Burn-ins and slates

Configured as a **studio template** (`GET`/`PUT /api/admin/burnin`, `ADMIN`, audited
`BURNIN_CONFIG_UPDATE`) and overridable **per project** in *Project → Settings →
Burn-ins & slates*, through `PUT /api/projects/:projectId/settings`. That project route uses
the **effective** project role, so a member promoted to `SUPERVISOR` on one project can set
the override there — unlike share links, which need a global role.

![The studio template and an optional project override are merged field by field into one effective configuration, which the FFmpeg worker applies at transcode time; the review proxy and the HLS renditions carry the burn-ins but never a slate, the client derivative carries both, and the original file is never re-encoded.](../assets/admin-guide/burnin-resolution.svg)

| Field | Default | Element |
|---|---|---|
| `enabled` | **`false`** | **Master switch for every burn-in below** |
| `showShot` | `true` | Shot code, top left — `SQ010 · SH020` when the shot has a sequence, the shot code alone otherwise, the asset name for an asset |
| `showVersion` | `true` | Version name, top right |
| `showTimecode` | `true` | Timecode, bottom centre, at the media's probed frame rate (rounded, clamped to 1–240, 24 if nothing was probed) |
| `showLogo` | `false` | Studio logo, bottom right, composited as a second input |
| `customText` | empty | Free text, bottom left — `CONFIDENTIAL`, a client name — **120 characters** maximum |
| `slate` | `false` | 3-second slate at the head of the client derivative |

> [!IMPORTANT]
> **Nothing is burned in on a fresh install.** `showShot`, `showVersion` and `showTimecode`
> are `true`, but `enabled` is `false` and gates all three. Turning the individual elements
> on without turning `enabled` on produces no visible change at all — the single most common
> misreading of this screen.

The override is **partial and merged field by field**: a project that only sets `customText`
keeps the studio's choice for everything else. Beware of the entry point, though — the
*Customise for this project* button seeds the override with **its own** defaults (`enabled`
**on**, shot, version and timecode on, no logo, no slate), not with a copy of the studio
template. Read the checkboxes after you press it.

Filters are built at transcode time, on the review proxy **and on every HLS rendition**, so
the burn-in stays legible at every quality of the ladder: font size is `rendition height / 32`
with a floor of **10 px**, margin `height / 60` with a floor of 8 px, white text on a **35 %
black** box. The worker image ships `fonts-dejavu-core` — FFmpeg's `drawtext` fails outright
without a font on disk.

Two silent-failure modes are worth knowing:

- If `showLogo` is on but no `studio_logo_key` is set, or the object cannot be downloaded, the
  worker logs a warning and encodes **without** the logo. The transcode succeeds; nobody is
  told the logo is missing.
- Burn-in resolution as a whole is best effort. A failure leaves the media transcoded with no
  burn-ins rather than failing the job and losing the upload.

### Slates and the client derivative

When **`slate`** is on, the worker renders a **3-second** identification card on a near-black
background — studio name, project, shot, version, artist, file name and date, with empty
fields skipped — and concatenates it in front of the review proxy. The result is written to a
**separate derivative**, `derived/{mediaId}/client.mp4`, recorded as `metadata.clientProxyKey`
alongside `metadata.slateSec`.

- **The internal review proxy never gets a slate.** Prepending frames would shift every
  frame-accurate annotation and every timeline marker by three seconds.
- Only the public client page serves the slated derivative, and it offsets comment timestamps
  by `slateSec` in **both** directions — subtracting when posting, adding when seeking — so a
  timestamp always means the same frame on both sides of the link.
- The client derivative carries whatever burn-ins the proxy already has, because it is built
  from the proxy.
- `slate` is **independent of `enabled`**: `slate: true, enabled: false` produces a slated
  client derivative with no burn-ins. That is a legitimate configuration.
- It applies to **video only**, needs a proxy with known dimensions, and is best effort. If it
  fails the share serves the un-slated proxy and reports `slateSec: 0`, so timestamps stay
  correct either way.

Because the derivative is built from the proxy, an audio-less source stays audio-less and a
source with sound gets three seconds of silence in front of it, so the audio never drifts.

## Who may issue a share link, and what it bounds

Creating, listing and revoking share links requires a **global `ADMIN` or `SUPERVISOR`** plus
access to the project. A *project* supervisor — someone elevated through a project membership
— **cannot** issue one; see [Users & roles](users-and-roles.md). Audit actions are
`SHARE_CREATE`, `SHARE_EMAIL`, `SHARE_VIEW`, `SHARE_UNLOCK_FAIL` and `SHARE_REVOKE`.

A link carries seven decisions, all made once and never editable afterwards:

| Field | Range | What it bounds, and what it does not |
|---|---|---|
| **`scope`** | `PROJECT` (default), `PLAYLIST`, `VERSION`, `MEDIA` | The set of media the link opens. Re-applied on **every** read — the grid, the presigned URL, the comment thread — so a client cannot reach a sibling by guessing an id. A `MEDIA` selection is capped at **200** |
| **`permission`** | `VIEW` (default) or `COMMENT` | Whether the guest may write. `VIEW` refuses a post with `403` |
| **`label`** | 1–120 characters | Printed in the client watermark, in the list, in the audit metadata and in the media access log. It is what makes a leaked frame attributable to a recipient |
| **`password`** | 4–200 characters | Hashed with bcrypt cost 12 and **never returned** — the API exposes only `hasPassword`. Lost means revoke and re-create |
| **`expiresInDays`** | 1–3650, or none | Kills the link. Does **not** invalidate presigned media URLs already handed out |
| **`maxViews`** | 1–1 000 000, or none | Counts **sessions opened**, not requests served, and not people |
| **`createdBy`** | the issuer | **Deleting that account revokes the link.** Disabling it or changing its role does not |

The scope target is validated against the link's project at creation — a playlist, version or
media list belonging to another project is refused — and a `MEDIA` selection may only contain
**published** media. `GET /api/share/candidates?projectId=` feeds the picker with the
project's published media, newest first, capped at 200.

> [!WARNING]
> A scope whose target has since been deleted **matches nothing**; it never falls back to the
> whole project. The list shows such a link with a *Restricted* badge. That silent widening is
> exactly what the scope exists to prevent, so an empty client grid is the intended failure.

The public grid is bounded too: at most **200 media** per page load, with `mediaTotal` and
`mediaHasMore` in the payload so the page can say the set is truncated. The answer to a link
that shows too much is to narrow its scope, not to paginate a catalogue in front of a client.

### What the guarantees really are

- **Share sessions.** Every public media or comment route requires a session token in the
  `X-Share-Auth` header: a JWT valid **24 hours**, bound to one link, and rejected if it is an
  ordinary user token. Issuing a session is the only way to consume a view, which is why
  neither the password nor the view limit can be side-stepped by calling a media URL directly.
- **View-limit consumption has no race.** It is a single conditional update
  (`SET viewCount = viewCount + 1 WHERE id = ? AND viewCount < maxViews`); zero rows affected
  means the limit was reached and the request gets **410**. An **already-issued session keeps
  working for its full 24 hours** on an exhausted link — a client is never cut off mid-review.
- **Unknown, revoked and expired tokens all return the same 404.** Those three states cannot
  be told apart. They are not indistinguishable from every state, though: a valid but
  password-protected token answers `200 { locked: true }` and an exhausted one answers `410`.
  An attacker can therefore learn that a token exists; they simply cannot use it.
- **Password unlock is rate-limited** to **10 attempts per 15 minutes**, keyed on the IP *and*
  the token, with every failure audited as `SHARE_UNLOCK_FAIL`. The counters live in **Redis**,
  so the budget is shared by every API replica and a restart no longer resets it — and if
  Redis is unreachable the limiter **fails closed** (`429`) rather than letting the attempts
  through. Two caveats remain: it counts successes too, so a legitimate user reloading burns
  budget, and the window is fixed rather than sliding. On top of that, `/api/share` and
  `/api/client` share a per-IP ceiling of **300 requests per 15 minutes**.
- **Media URLs are presigned MinIO GETs valid one hour.** The same URL is handed out again for
  up to ten minutes, so a browser reuses its cache instead of re-downloading, and the client
  page keeps the response for five minutes. Anyone the recipient forwards a URL to can fetch
  the file for the remainder of that hour, without the password and after the link is revoked.

### Sending the link by e-mail

Right-clicking a link in the **Shares** tab offers *Send by email…*
(`POST /api/share/:id/email`). ReView sends through the studio's own SMTP relay, **one message
per recipient** — a list in a plain `To:` header would tell each client who else received the
same link — and the message states what the link opens, whether it is password-protected, and
its expiry.

| Limit or refusal | Meaning |
|---|---|
| **10 recipients** per send | Above that it is a mailing list, not a delivery |
| **1000 characters** of note | Quoted in the message body |
| `APP_URL_MISSING` | The studio has no public URL, so the link in the message would be dead |
| `SMTP_NOT_CONFIGURED` | No relay — see [SMTP & announcements](smtp-and-announcements.md) |
| `SHARE_REVOKED` | The link is already revoked |
| `SMTP_SEND_FAILED` | Every message was refused by the relay; the audit entry still records the attempt |

The e-mail is always written in **English**, deliberately: the recipient has no account and
therefore no known language preference.

## What a client actually gets

The client page mounts the studio's **real viewers**, in read-only form, for all four kinds of
media — a frame-accurate video transport, the image viewer, the 3D pane and the splat pane,
with their navigation but not one editing tool. The watermark and the slate offset apply over
all of them.

For a 3D media the share serves the converted **GLB** derivative alongside the source
(`glbUrl`), because no browser opens an `.fbx`, an `.obj` or a `.usd`. A delivery whose
conversion never ran shows a plain "this media cannot be displayed here" rather than an empty
frame — which is an argument for checking the job queue before sending the link, not after.

> [!NOTE]
> The public payload carries the file, that GLB and the slate offset. The spatial viewers are
> already written to replay the studio's staging — persisted splat edits, the USD override,
> the camera presentation, the project lighting — and fill in on their own the day the route
> serves those fields; until then a guest gets the raw scene, navigable but unstaged.

A guest comment goes through the **same comment service** as an internal one: it reaches the
media's watchers and the person who created the link, fires the outgoing webhooks and the v1
event journal, and is pushed to ShotGrid as a note. What the guest actor cannot do is
mention, assign, resolve, reply or attach a file, and its comment is forced
`isVisibleToClient`. An archived project refuses the write outright.

## Tracing a consultation

*Admin → Maintenance → **Media access*** (`GET /api/admin/media-access`, `ADMIN`, paginated,
newest first) gives one line per consultation — the account for an internal review, the link
label and the IP for a share — **deduplicated per viewer, per media, over 30 minutes**, so
reloads and seeks do not inflate it. A link that has since been purged leaves a placeholder
label rather than dropping the row.

Logging is fire-and-forget: a failure is logged and never blocks the request. Treat the log as
evidence, not as proof of completeness.

*Maintenance → Audit* carries the decisions rather than the consultations: who issued a link
and with what options (`SHARE_CREATE` records the permission, the label, whether a password
was set, the view limit, the expiry, the scope and the size of a selection), who mailed it,
who revoked it, and every wrong password.

## Use case: sending a cut to a client under NDA

*Legal wants the studio name and "CONFIDENTIAL" on the picture, and the link to die after a
week.*

1. *Admin → Delivery → Burn-ins & slates*: set `enabled` **on**, `customText` to
   `CONFIDENTIAL`, and `showLogo` on **after** checking that a studio logo is actually
   uploaded. Turn `slate` on if legal wants an identification card at the head.
2. Understand the timing. Burn-ins are applied **at transcode time**, so media already in the
   studio has none. Either upload the cut after changing the setting, or reprocess it — which
   is impossible once the version is published (`403 PUBLISHED_LOCKED`). In practice: change
   the setting **before** the deliverable is uploaded.
3. If only this show needs it, set the override on the project instead of the studio template,
   so every other project keeps its current look.
4. Leave the client-share watermark on (the default). It adds the recipient's label on top of
   the burned-in text, which is what makes a leak attributable to a person rather than to the
   studio.
5. Create the link (global manager role) scoped to the **version** or to a hand-picked
   selection rather than to the project, with a password, a 7-day expiry, and a view limit if
   you know how many people will watch. Send the password on a different channel.
6. Note what expiry does **not** do: a presigned media URL already handed out stays valid for
   its remaining hour after the link dies.

## Use case: a link leaked outside the client

*The cut turned up somewhere it should not have.*

1. **Revoke the link first** (*Project → Shares → right-click → Revoke*). Existing share
   sessions stop working on their very next request — revocation is checked per request, not
   cached like user sessions.
2. Presigned media URLs already issued survive up to **one hour**, and there is no way to
   invalidate them short of rotating the MinIO credentials. Say so plainly in the incident
   report rather than claiming instant containment.
3. *Admin → Maintenance → Media access* gives one line per consultation with the link label,
   the IP and the timestamp. That is the evidence of who fetched what, and when.
4. *Maintenance → Audit*: `SHARE_CREATE` tells you who issued the link and with which options,
   `SHARE_EMAIL` who it was sent to and how many messages left, and a burst of
   `SHARE_UNLOCK_FAIL` tells you the password was being guessed rather than forwarded.
5. If the leaked copy carries a client-share watermark, the recipient label is legible in the
   image and identifies the link — this is the case the overlay exists for. If it carries a
   slate, the card identifies the delivery even after a re-encode.
6. Re-issue with a narrower scope, a view limit and a shorter expiry. Consider turning the
   **internal** watermark on too if the leak may have come from inside.

## Use case: enabling internal watermarking without a revolt

*Production wants every internal review watermarked.*

1. Set `internal` on and start at the default opacity of 8 %. The `difference` blend keeps it
   legible on both dark plates and white boards without hiding detail.
2. Warn compositing and lighting **first**. The overlay sits over every media type including
   A/B compare panes, and colour-sensitive work is exactly where an 8 % overlay is felt. Agree
   on a value before turning it on, not after.
3. It is studio-wide. There is no way to exempt one project, one department or one review; the
   only lever is the opacity slider, 2 to 40 %.
4. It costs nothing server-side — a CSS overlay, no re-encode, no storage — and it applies
   retroactively to every existing media the moment you save. That is also the reason it is
   the wrong tool against a determined leaker.

## Troubleshooting

**I turned the burn-ins on and nothing changed.** Either `enabled` is still off, which gates
every element, or the media was transcoded before the change. Only a new upload or a
reprocess picks it up, and a published version cannot be reprocessed.

**The logo is missing from the burned-in frames.** `showLogo` is on but no `studio_logo_key`
is set, or the object could not be downloaded. The transcode succeeded silently; check
*Delivery → Studio logo*.

**The client sees the video three seconds late compared to my notes.** They should not — the
offset is applied in both directions. If timestamps really are shifted, the slate step failed
and the share is serving the un-slated proxy with `slateSec: 0`, or a note was written against
the derivative through a route that does not apply the offset.

**A client says the link asks for a password they never received.** The password is never
displayed again after creation. Revoke and re-create; send it on a channel different from the
link.

**"Too many attempts" on a link nobody is attacking.** The unlock limiter counts successes as
well as failures, ten per quarter of an hour per IP and per link. A client reloading the page
several times burns the budget. It also fails closed: if Redis is down, every unlock is
refused.

## Related pages

- [Sharing with clients](../user-guide/sharing.md) — the day-to-day gesture, scope by scope
- [Transcoding](transcoding.md) — burn-ins are applied at the same step
- [Users & roles](users-and-roles.md) — who may issue a link, and the project-supervisor case
- [Identity, API & audit](identity-and-api.md) — sessions, tokens, webhooks, audit
- [SMTP & announcements](smtp-and-announcements.md) — the relay that mails a link
- [Branding & notifications](branding-and-notifications.md) — the other branding images
- [Data retention](data-retention.md) — what happens to originals and derivatives over time
