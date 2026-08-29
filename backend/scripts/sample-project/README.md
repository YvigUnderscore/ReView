<!--
SPDX-FileCopyrightText: 2026 Yvig Bidon
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Sample project generator

Builds a complete demonstration studio in a local ReView instance: a team, the three-episode
*Caminandes* series in production, real media (video, images, USD scenes, Gaussian splats),
and a review history — comments, annotations, decisions, retakes.

Everything it uses is **free to redistribute**. Nothing is committed: media are fetched and
built into `dev_data/sample-project/`, which git ignores.

## Running it

```bash
cd backend
npm run sample                     # everything (about 20 minutes on a first run)
npm run sample -- --skip-media     # structure only, a few seconds
npm run sample -- --concurrency=2  # fewer parallel uploads on a small machine
npm run sample -- --reset          # delete the sample project first
```

Requirements: the docker stack running (`docker compose up -d`), `ffmpeg` on the PATH, and
Blender (for USD and splat generation — set `SAMPLE_BLENDER_BIN` if it is not in the usual
place). Without Blender, the video and image parts still work; USD and splat media are
skipped with a warning.

Every account signs in with the password `sample1234`.

## What it produces

| Episode | State | What it shows |
| --- | --- | --- |
| **EP01 — Llama Drama** | Delivered | A finished episode: everything approved and published |
| **EP02 — Gran Dillama** | Delivered | The hero prop (the fence), an FX sequence, the orbital pull-back |
| **EP03 — Llamigos** | In production | Shots at every stage, open retakes, dailies, a montage |

Eight sequences, thirty-one shots, eleven assets, around three hundred versions. The episode
level is enabled — the only way to see that rung of the hierarchy at work.

## How it is put together

```
config.ts          sources and their licences, work directories
data/              what the production says: team, projects, shots, hand-written feedback
generate.ts        turns a state ("this shot is in lighting") into a history
build/             makes the files: video segments, stills, USD graphs, splats, avatars
seed/              writes to the database, uploads through the API
py/                Blender and OpenUSD scripts
```

Two decisions explain most of the code:

**The structure is written with Prisma, the media go through the API.** A believable project
spans four months — versions a week apart, decisions dated before the next version, comments
from three weeks ago — and no route lets you backdate what it writes. Media are the
exception: uploading them through the API is what triggers the real processing (HLS ladder,
thumbnails, sprite, USD → GLB conversion), and without it the demonstration shows empty
cards.

**One source segment per shot, not per version.** A shot carries eight to ten versions, all
cut from the same seconds of the master. Fetching them separately multiplied remote requests
by ten and ended in `429 Too Many Requests`. A segment slightly wider than the shot is
fetched once, cached, and every version derives from it locally.

## Where the content comes from

- **Video** — *Caminandes* (Blender Foundation), CC BY. Every shot is cut at a timecode
  checked frame by frame against what its description claims, then graded per pipeline step
  so a layout does not look like a final comp.
- **3D and USD** — Poly Haven models (CC0), converted by Blender into geometry layers, then
  assembled here into a proper asset graph (interface layer, payload, material library,
  binding layer, variants, purposes) and shot layer stacks (layout / anim / lighting / fx).
- **Gaussian splats** — generated from Poly Haven photogrammetry scans by surface sampling.
  Research-only datasets are deliberately not used.
- **Avatars and department badges** — generated; they depict nobody.

The generator writes `ATTRIBUTION.md` at the repository root with the full credit list, as
CC BY requires.

## Regenerating after a change

The generator is idempotent and resumable: it skips media already uploaded, reuses cached
segments and USD graphs, and re-runs failed uploads. Deleting `dev_data/sample-project/`
forces a full rebuild; `--reset` removes the sample projects from the database.
