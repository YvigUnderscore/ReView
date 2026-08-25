# Upload & publishing

*From dropping a file to publishing it: where it lands, what is checked on the way, and what publication locks forever.*

> Updated: 2026-08-23

Delivering into ReView is a drag and a drop. Everything that follows — hashing, resuming,
deduplicating, checking, transcoding, publishing — happens without holding you on the page:
the transfer lives in a floating widget at the bottom right, and you keep working while it
runs. This page describes the whole path, and the one decision at the end of it that cannot
be undone.

## Where a file lands

Media are uploaded onto a **version**, and a version belongs to a **task** or directly to an
**asset**. A shot never holds a version itself: dropping a file on a shot page asks which
task should receive it first.

The **kind** of a media is not a label you choose. The server keeps a closed table of the
extensions each kind admits, and it checks the file's own header against that kind before
anything is processed.

| Kind | Extensions the server admits | What is produced |
|------|------------------------------|------------------|
| Video | `.mp4` `.m4v` `.mov` `.mkv` `.webm` `.avi` `.mxf` `.ts` `.m2ts` `.mts` | MP4 proxy, adaptive HLS ladder, poster, hover sprite, audio waveform |
| Image | `.jpg` `.jpeg` `.png` `.webp` `.gif` `.bmp` `.exr` `.dpx` `.tif` `.tiff` `.tga` | JPEG thumbnail — plus a **full-resolution JPEG web proxy** for everything outside the six formats a browser decodes |
| 3D model | `.glb` `.gltf` `.fbx` `.obj` `.usd` `.usda` `.usdc` `.usdz` `.dae` `.stl` `.zip` | A GLB the viewer can open (`.glb` is served as is), plus a rendered preview |
| Gaussian splat | `.ply` `.splat` `.spz` `.ksplat` `.sog` `.sogs` | Nothing: served to the viewer as it is, plus a rendered preview |
| Image sequence | numbered `.exr` `.dpx` `.tif` `.tiff` `.tga` `.png` `.jpg` `.jpeg` frames | **One** `VIDEO` media assembled from the frames — see [Image sequences](image-sequences.md) |

`.abc` (Alembic) is deliberately absent: no signature identifies it and no converter turns it
into a GLB, so announcing it would be a promise the pipeline cannot keep. Details of each
pipeline in [Media processing](media-processing.md).

> [!WARNING]
> **A production still delivered on its own may be refused.** The browser guesses the kind
> from the extension for splat and 3D formats, then from the MIME type the operating system
> reports, and falls back to *3D model*. Most systems report nothing for `.exr`, `.dpx` or
> `.tga`, so a single such frame is announced as a 3D model, fails the header check at the
> end of the transfer, and comes back as `400 INVALID_FILE` with the media marked `FAILED`.
> Deliver production frames as a **sequence** (two or more numbered files, which is the
> normal VFX delivery anyway), or hand a single reference plate over as `.tif` or `.png`.

## The gestures

- **Drop anywhere on a task, asset or shot page** — the full-page drop zone creates the
  **next** version and fills it.
- **Drop on a version card** in the timeline — the files join **that** version instead.
- **Drop a folder.** The drop reader walks the directory tree (eight levels deep, hidden
  files skipped) up to **10 000 files**, the same ceiling the server puts on one sequence. A
  folder of 1 200 EXR frames is a normal delivery, not an accident.
- **New version +** button, then the media button on the card.
- On a **shot** or an **asset with tasks**, a picker asks which task the version belongs to.
  Filing a texturing render "on the asset" loses the step that produced it, and deprives the
  version pushed to ShotGrid of its `sg_task`. The picker can create the missing task.

If the drop contains **two or more numbered frames** sharing a base name, a field width and
an extension, a grouping dialog opens first: each detected sequence is listed with its
pattern, first and last frame, file count, total size and the number of missing frames.
Accepting a group makes it **one** media; unticking it sends the frames as separate files.
Nothing is grouped without that confirmation, and closing the dialog uploads nothing. See
[Image sequences](image-sequences.md).

Uploads stream straight to MinIO through presigned URLs and are tracked by a **global,
non-blocking upload widget** at the bottom right: you can keep navigating while transfers and
processing continue. Three files transfer at a time; the rest wait their turn rather than
fighting for the link.

## What happens during the transfer

![A dropped file is hashed in the browser; the server hands out an upload URL only after the naming rule and the quota pass; small files go up in one PUT and large ones in resumable parts, with deduplication; finalize checks the magic bytes, normalises the content type and weighs the real object before the processing job runs.](../assets/user-guide/upload-path.svg)

1. **A sha256 is computed in the browser**, streaming, before anything is sent.
2. **The server hands out an upload URL** — and this is where an upload can be refused
   *before* a single byte moves: an archived project, the per-user storage quota, the
   project storage quota, the declared file size against the studio limit, and the project's
   file **naming rule** in `reject` mode.
3. **Files under 16 MB** go up as a single presigned `PUT`.
4. **Files of 16 MB and above** go up in **resumable parts** of 16 MB — grown just enough
   past 16 GB to stay under a thousand parts — **four at a time**, each retried and re-signed
   on failure. If the connection drops, re-uploading the same file to the same version picks
   up where it stopped: the server lists the parts it already holds and the client skips
   them.
5. **Content already present in storage is deduplicated.** Same sha256, same size, same kind,
   a media that is `READY` and whose source object is still there — and, crucially, *inside a
   project you can already see*. The object is copied server-side and the media is ready at
   once, with a `MEDIA_DEDUP` entry in the audit trail. This is a property of the large-file
   path: a file under 16 MB is simply sent.
6. **Finalize** validates the file's magic bytes against the declared kind, normalises the
   stored content type to something inert, weighs the **real** object against the file limit
   and the project quota, and queues the processing job.

Media status then progresses `UPLOADING → PROCESSING → READY`, or `FAILED`.

| Default | Value | Where it is changed |
|---|---|---|
| Maximum file size | `5 GB` | Admin → Settings |
| Per-account storage | `10 GB` | Admin → Settings, or per user |
| Project storage quota | none until set | Project → Settings → Storage |
| Concurrent uploads accepted per account | `5` | Admin → Settings |
| Files transferring at once, in the browser | `3` | not configurable |
| Parts or frames in flight, per file | `4` | not configurable |

Two server-side checks can turn a media into `FAILED` after the transfer:

- **Checksum mismatch.** The worker re-hashes the downloaded file and compares it to the
  sha256 announced by the browser. A corrupted transfer never produces derivatives.
- **Antivirus.** When the studio has configured ClamAV, every uploaded file is scanned. An
  infected file is **moved to a quarantine prefix**, removed from its normal location, marked
  `FAILED`, and logged as `MEDIA_QUARANTINED` in the audit trail. If the scanner is
  unreachable the job is retried rather than published unscanned.

**Cancelling is a real cancellation.** Removing a line from the upload widget cuts the
requests in flight and tells the server to abort the multipart upload — or, for a sequence,
to empty the frame prefix and delete the media left in `UPLOADING`. Nothing stays billed and
invisible in the bucket.

### Naming conventions

A project can carry a **file naming rule** (a regular expression) with three policies, set in
the project settings:

| Mode | Effect |
|------|--------|
| `off` | never checked (the default) |
| `warn` | the upload proceeds and the interface flags the name |
| `reject` | the upload is refused with `NAMING_REJECTED`, before any transfer |

An invalid or dangerous pattern is treated as `off` rather than blocking work: the convention
is an aid to rigour, not a security control.

## Drafts

New media are **drafts**. A draft is **strictly private to the person who uploaded it** — not
to the team, not to supervisors. Nobody else sees it, and nobody else can publish it: the
publish route answers `404` to anyone but the uploader.

Your own drafts are reachable in two places:

- the **Pending drafts** pill in the **top bar**, immediately left of the search box. It
  appears only when you have drafts, counts them, and refreshes as uploads complete; clicking
  it opens a panel listing each draft with its location and offering **View**, **Publish** and
  delete. In a narrow window the pill shrinks to its icon;
- the **Reviews** page, with the status filter set to **My drafts**.

A draft can be reviewed, trimmed (video), transformed (3D) and edited (splat) freely — that
is the point of the state.

> [!NOTE]
> A media dropped onto a version that is **already published** is born published. That is the
> counterpart of the rule below: without it, adding one more render to a published version
> would drag the whole version back into draft, or force you to republish by hand what was
> already out.

## Publishing

![A media is a draft private to its uploader until it is published; a version turns published as soon as it has no draft media left, and only a supervisor or an administrator can move it back. After publication the content is locked, while the splat presentation and the thumbnail stay editable.](../assets/user-guide/draft-to-published.svg)

Publishing a media makes it visible to the whole project. **A version becomes published as
soon as it has no draft media left**, which the server handles: the *Publish n* button on a
version card publishes every one of your remaining drafts in one gesture. A media that
`FAILED` does not count — otherwise one dead file would keep a version in draft for good.

Publishing fans out, in order:

1. visibility to the project;
2. a real-time `media:update` to the project room, so open screens update themselves;
3. a push to ShotGrid when the project is linked — creating the remote version, or adding the
   media to the one already there;
4. a notification to the **watchers** of the version, shot or asset;
5. the outgoing `media.published` webhook;
6. a line in the studio's Slack or Discord channel, when a webhook is configured for it.

Versions have a third state, `REVIEW`, used by the API publishing flow: when an artist
completes an upload through the API without the right to publish the version, the media is
published and the version is set to `REVIEW` — submitted, not validated. A supervisor or
admin sets `PUBLISHED`.

A media still in `UPLOADING` cannot be published: the route answers `NOT_FINALIZED`, because
such a file has passed neither the header check, nor the content-type normalisation, nor the
antivirus, nor the real-size control.

## The publish lock

Publishing is final for the **content**. Any structural edit on a published media returns
`403 PUBLISHED_LOCKED`: splat edits and masks, video trim, reprocessing, 3D transform.

Only two things stay editable after publication:

- the **splat presentation** (staging: camera framing, depth of field, reveal, LOD);
- the **thumbnail**.

To fix a published version, upload a **new version**. The history keeps every iteration side
by side, which is what makes A/B comparison in review possible. See
[Projects & pipeline](projects-and-pipeline.md#versions--publication).

Version *status* is a separate matter from media content: a supervisor or admin can move a
version out of `PUBLISHED`, but an author cannot — otherwise the lock would have one meaning,
since unpublishing would make the content editable again.

## Thumbnails

Thumbnails are generated automatically during processing and can be overridden manually,
**including on published versions** — a thumbnail is presentation, not content.

3D models and Gaussian splats get theirs from a separate renderer that runs on its own queue:
Blender for models, an in-house point rasteriser for splats. That render never touches the
media's status (a preview cannot leave a file stuck in `PROCESSING`) and never overwrites an
existing thumbnail, including one captured by hand from the viewer. See
[Spatial thumbnails](../admin-guide/spatial-thumbnails.md).

## Use cases

### Delivering an animation playblast at the end of the day

1. Open the shot, drop the `.mov` anywhere on the page.
2. The picker asks for the step: pick **Animation**. The version is created and the file
   starts uploading; you can navigate away immediately — the widget follows it.
3. Processing turns it into an MP4 proxy, HLS renditions and a hover sprite. The status goes
   to `READY`.
4. The **Pending drafts** pill in the top bar shows *1 draft pending*. Open it, click **View**
   to check the media in review, then **Publish**.
5. The version turns published, the shot's cut updates itself, the watchers are notified, and
   — on a linked project — the version appears on the ShotGrid site.

### Delivering a comp as an EXR sequence

1. Drag the render folder onto the task page. The grouping dialog lists
   `SH0100_comp_v003.%04d.exr`, frames `1001` to `1200`, 1 200 files, and any gaps it found.
2. Leave it ticked, confirm. One media is created, and the frames go up four at a time; the
   progress line counts frames, not just bytes.
3. The worker assembles a master and runs the ordinary video pipeline on it. You review it
   frame by frame, with the delivered numbering (`1001`…) shown in the transport.

### Recovering an interrupted 4 GB upload

The VPN dropped halfway through a splat scan.

Re-drop the **same file** on the **same version**. The client hashes it again, the server
recognises the multipart upload in progress and returns the list of parts it already holds;
only the missing ones are sent. Nothing has to be restarted from zero, and nothing has to be
cleaned up first.

### Fixing something already published

You cannot. Trim, transform, splat edits and reprocessing all return `403` on a published
media, and that is deliberate: a published version is what the supervisor approved and what
the client link serves.

Create the **next version** instead, drop the corrected file, publish it. The old one stays
in the timeline, and review can put the two side by side with the A/B compare.

The one exception is the thumbnail: right-click the version's media tile and set a better
poster frame at any time.

### Uploading on behalf of the whole team

You cannot do that either. A draft belongs to its uploader alone, and only its uploader can
publish it. If a render farm or a pipeline tool has to deliver, give it a **service account**
and an API token, and let it use the publishing flow of the
[public API](../api/v1-integration.md) — which is exactly what the `REVIEW` version state is
for.

## Troubleshooting

**`400 INVALID_FILE` at the very end of a long transfer.** The file's header does not match
the kind the browser declared. On a lone `.exr`, `.dpx` or `.tga`, this is the mis-detection
described at the top of this page; on other files it means the extension lies about the
content.

**`NAMING_REJECTED` before anything moves.** The project's file naming rule is set to
`reject` and the filename does not match it. The rule is in Project → Settings.

**`FILE_TOO_LARGE`, or a quota error.** The declared size passes but the real object does
not, or the project has reached its storage quota. Project → Settings → Storage shows usage
against quota; the studio-wide file limit is in Admin → Settings.

**`TOO_MANY_UPLOADS` (429).** You already have as many uploads in flight as the studio allows
per account. Wait for one to finish — the widget will start the queued ones on its own.

**A media disappeared right after upload.** It was quarantined by the antivirus; the audit
log records it as `MEDIA_QUARANTINED`.

**A draft you cannot find.** Drafts are private to their uploader: if someone else delivered
it, only they see it and only they can publish it.

## Related pages

- [Media processing](media-processing.md) — what happens after the upload
- [Image sequences](image-sequences.md) — the VFX delivery, frame by frame
- [Projects & pipeline](projects-and-pipeline.md) — versions, hierarchy, publish lock
- [Video review](review-video.md), [3D review](review-3d.md),
  [Splat review](review-splat.md)
- [Sharing with clients](sharing.md) — what a published media exposes outside the studio
