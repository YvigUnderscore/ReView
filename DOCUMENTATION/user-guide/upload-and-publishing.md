# Upload & publishing

> Updated: 2026-08-21

## Where a file lands

Media are uploaded onto a **version**, and a version belongs to a **task** or directly
to an **asset**. A shot never holds a version itself: dropping a file on a shot page
asks which task should receive it first.

| Kind | Extensions that select it | Processing |
|------|---------------------------|-----------|
| Video | any `video/*` MIME type | HLS multi-rendition transcode + thumbnails + hover sprite |
| Image | any `image/*` MIME type | Thumbnails |
| 3D model | `.glb`, `.gltf`, `.fbx`, `.usd`, `.usda`, `.usdc`, `.usdz`, `.obj`, `.dae`, `.stl`, `.zip` | Conversion to GLB via assimp when needed (`.glb` is served as is) |
| Gaussian splat | `.ply`, `.splat`, `.spz`, `.ksplat`, `.sog`, `.sogs` | Splat pipeline (viewer-ready asset) |

The kind is decided by extension first (splat, then 3D), then by MIME type. Anything
unrecognised is treated as a 3D model. Details of each pipeline in
[Media processing](media-processing.md).

## The gestures

- **Drop anywhere on a task, asset or shot page** — the full-page drop zone creates the
  **next** version and fills it.
- **Drop on a version card** in the timeline — the files join **that** version instead.
- **New version +** button, then the media button on the card.
- On a **shot** or an **asset with tasks**, a picker asks which task the version belongs
  to. Filing a texturing render "on the asset" loses the step that produced it, and
  deprives the version pushed to ShotGrid of its `sg_task`. The picker can create the
  missing task.

Uploads stream straight to MinIO through presigned URLs and are tracked by a **global,
non-blocking upload widget**: you can keep navigating while transfers and processing
continue.

## What happens during the transfer

1. **A sha256 is computed in the browser**, streaming, before anything is sent.
2. **Files under 16 MB** go up as a single presigned `PUT`.
3. **Files of 16 MB and above** go up in **resumable 16 MB parts**. If the connection
   drops, re-uploading the same file to the same version picks up where it stopped: the
   server lists the parts it already holds and the client skips them.
4. **Content already present in storage is deduplicated** — the transfer is skipped
   entirely and the media is ready at once.
5. **Finalize** validates the file's magic bytes, normalises its content type, checks it
   against the quota, and queues the processing job.

Media status progresses `UPLOADING → PROCESSING → READY`, or `FAILED`.

Two server-side checks can turn a media into `FAILED`:

- **Checksum mismatch.** The worker re-hashes the downloaded file and compares it to the
  sha256 announced by the browser. A corrupted transfer never produces derivatives.
- **Antivirus.** When the studio has configured ClamAV, every uploaded file is scanned.
  An infected file is **moved to a quarantine prefix**, removed from its normal
  location, marked `FAILED`, and logged as `MEDIA_QUARANTINED` in the audit trail. If
  the scanner is unreachable the job is retried rather than published unscanned.

### Naming conventions

A project can carry a **file naming rule** (a regular expression) with three policies,
set in the project settings:

- `off` — never checked;
- `warn` — the upload proceeds and the interface flags the name;
- `reject` — the upload is refused.

An invalid or dangerous pattern is treated as `off` rather than blocking work: the
convention is an aid to rigour, not a security control.

## Drafts

New media are **drafts**. A draft is **strictly private to the person who uploaded it** —
not to the team, not to supervisors. Nobody else sees it, and nobody else can publish it:
the publish route answers `404` to anyone but the uploader.

Your own drafts are reachable in two places:

- the floating **Pending drafts** pill at the bottom left of the screen, which lists
  them with their location, and offers **View**, **Publish** and delete on each. It
  appears only when you have drafts and refreshes as uploads complete;
- the **Reviews** page, with the status filter set to **My drafts**.

A draft can be reviewed, trimmed (video), transformed (3D) and edited (splat) freely —
that is the point of the state.

## Publishing

Publishing a media makes it visible to the whole project. **A version becomes published
as soon as it has no draft media left**, which the server handles: the *Publish n* button
on a version card publishes every one of your remaining drafts in one gesture.

Publishing triggers, in order: visibility to the project, a real-time `media:update` to
the project room, a push to ShotGrid when the project is linked, a notification to the
watchers of the version, shot or asset, and the outgoing `media.published` webhook.

Versions have a third state, `REVIEW`, used by the API publishing flow: when an artist
completes an upload through the API without the right to publish the version, the media
is published and the version is set to `REVIEW` — submitted, not validated. A supervisor
or admin sets `PUBLISHED`.

## The publish lock

Publishing is final for the **content**. Any structural edit on a published media returns
`403 PUBLISHED_LOCKED`: splat edits and masks, video trim, reprocessing, 3D transform.

Only two things stay editable after publication:

- the **splat presentation** (staging: camera framing, depth of field, reveal, LOD);
- the **thumbnail**.

To fix a published version, upload a **new version**. The history keeps every iteration
side by side, which is what makes A/B comparison in review possible. See
[Projects & pipeline](projects-and-pipeline.md#versions--publication).

Version *status* is a separate matter from media content: a supervisor or admin can move
a version out of `PUBLISHED`, but an author cannot — otherwise the lock would have one
meaning, since unpublishing would make `assertNotPublished` see a draft again.

## Thumbnails

Thumbnails are generated automatically during processing and can be overridden manually,
**including on published versions** — a thumbnail is presentation, not content. 3D and
splat media capture theirs from the client on first viewing when they have none.

## Use cases

### Delivering an animation playblast at the end of the day

1. Open the shot, drop the `.mov` anywhere on the page.
2. The picker asks for the step: pick **Animation**. The version is created and the file
   starts uploading; you can navigate away immediately — the widget follows it.
3. Processing turns it into HLS renditions and a hover sprite. The status goes to
   `READY`.
4. The **Pending drafts** pill shows *1 draft pending*. Open it, click **View** to check
   the media in review, then **Publish**.
5. The version turns published, the shot's cut updates itself, the supervisor's watchers
   are notified, and — on a linked project — the version appears on the ShotGrid site.

### Recovering an interrupted 4 GB upload

The VPN dropped halfway through a splat scan.

Re-drop the **same file** on the **same version**. The client hashes it again, the server
recognises the multipart upload in progress and returns the list of parts it already
holds; only the missing ones are sent. Nothing has to be restarted from zero, and nothing
has to be cleaned up first.

### Fixing something already published

You cannot. Trim, transform, splat edits and reprocessing all return `403` on a published
media, and that is deliberate: a published version is what the supervisor approved and
what the client link serves.

Create the **next version** instead, drop the corrected file, publish it. The old one
stays in the timeline, and review can put the two side by side with the A/B compare.

The one exception is the thumbnail: right-click the version's media tile and set a better
poster frame at any time.

### Uploading on behalf of the whole team

You cannot do that either. A draft belongs to its uploader alone, and only its uploader
can publish it. If a render farm or a pipeline tool has to deliver, give it a **service
account** and an API token, and let it use the publishing flow of the
[public API](../api/v1-integration.md) — which is exactly what the `REVIEW` version state
is for.

## Related pages

- [Media processing](media-processing.md) — what happens after the upload
- [Projects & pipeline](projects-and-pipeline.md) — versions, hierarchy, publish lock
- [Review video](review-video.md), [Review 3D](review-3d.md),
  [Review splat](review-splat.md)
- [Sharing with clients](sharing.md) — what a published media exposes outside the studio
