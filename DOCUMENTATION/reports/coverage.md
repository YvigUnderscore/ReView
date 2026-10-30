# Test coverage

*Measured unit-test coverage of the backend and the frontend (vitest + `@vitest/coverage-v8`), per package and per folder, with the least-covered notable files.*

> Updated: 2026-10-29

Measured on branch `dev` with `npx vitest run --coverage` in `backend/` and `frontend/` (vitest 4.1.12,
provider `@vitest/coverage-v8` 4.1.12). The backend run needs the placeholder environment variables
of the CI job (`DATABASE_URL`, `JWT_SECRET`, `S3_*`, `REDIS_URL`). Integration tests (`*.itest.ts`) and
Playwright are not included: these figures are **unit tests only**.

## Totals

| Package | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| Backend (`backend/src`) | 67.02 % (10865 / 16210) | 66.45 % (12570 / 18916) | 63.15 % (7749 / 12269) | 64.90 % (2561 / 3946) |
| Frontend (`frontend/src`) | 54.82 % (13684 / 24959) | 54.15 % (15799 / 29172) | 47.05 % (9222 / 19598) | 46.89 % (4016 / 8564) |

All source files are counted (`include: src/**`), including those no test imports: an untested
service weighs zero instead of disappearing from the measure.

## Ratchet floors

The floors live in `scripts/coverage-floors.json` and are checked by `scripts/check-coverage.mjs`
(also wired into `scripts/validate.sh`). They are the measured values rounded down to 0.1 point,
and can only go up (`node scripts/check-coverage.mjs <backend|frontend> --update`).

| Package | Folder | Statements | Branches |
|---|---|---|---|
| Backend | `src/lib` | 87.2 % | 82.4 % |
| Backend | `src/middleware` | 89.8 % | 88.2 % |
| Backend | `src/services` | 65.1 % | 57.3 % |
| Backend | `src/routes` | 40.8 % | 40.7 % |
| Backend | `src/workers` | 38.7 % | 32.3 % |
| Backend | others (`app.ts`, `config`, `i18n`...) | 33.7 % | 57.8 % |
| Frontend | `src/lib` | 85.7 % | 80.9 % |
| Frontend | `src/stores` | 73.0 % | 58.3 % |
| Frontend | `src/v2/lib` | 68.6 % | 70.5 % |
| Frontend | `src/v2/components` | 52.3 % | 46.3 % |
| Frontend | `src/v2/pages` | 52.1 % | 44.6 % |
| Frontend | others (`main.tsx` excluded, `v2/App.tsx`, `v2/i18n`...) | 60.5 % | 54.4 % |

## Least-covered notable files

Files with at least 60 statements, by statement coverage.

### Backend (46 files at 0 %)

| File | Statements | Coverage |
|---|---|---|
| `src/app.ts` | 114 | 0 % |
| `src/services/shotgrid/ShotgridDiffService.ts` | 97 | 0 % |
| `src/services/shotgrid/ShotgridStatusSync.ts` | 83 | 0 % |
| `src/routes/shotgrid-sync.routes.ts` | 64 | 0 % |
| `src/routes/shotgrid-config.routes.ts` | 63 | 0 % |
| `src/services/SplatEditService.ts` | 61 | 0 % |
| `src/routes/admin.routes.ts` | 60 | 0 % |
| `src/services/shotgrid/ShotgridVersionSync.ts` | 176 | 1.1 % |
| `src/services/shotgrid/ShotgridPushService.ts` | 259 | 2.3 % |
| `src/services/shotgrid/ShotgridConfigService.ts` | 123 | 10.6 % |
| `src/workers/ffmpeg.worker.ts` | 404 | 13.9 % |
| `src/workers/ocio/bakeJob.ts` | 60 | 20.0 % |
| `src/services/shotgrid/ShotgridCrewService.ts` | 120 | 25.8 % |
| `src/services/shotgrid/ShotgridPullService.ts` | 316 | 28.5 % |
| `src/services/shotgrid/ShotgridSyncService.ts` | 155 | 31.6 % |

The ShotGrid integration and the ffmpeg worker are the main gap; they are exercised by the
integration suite and the ShotGrid end-to-end harness, which this measure does not see.

### Frontend (206 files at 0 %)

Largest uncovered files (0 %): `src/v2/pages/timeline/useContinuousPlayback.ts` (211 statements),
`src/v2/pages/TimelinePlayerPage.tsx` (116), `src/v2/pages/profile/AccountSections.tsx` (98),
`src/v2/pages/board/useBoardDocument.ts` (80), `src/v2/pages/project/PlaylistsTab.tsx` (76),
`src/v2/pages/client/ClientVideoPlayer.tsx` (74), `src/v2/pages/admin/LoginAppearanceTab.tsx` (74),
`src/v2/pages/project/TrashTab.tsx` (73), `src/v2/components/production/DeadlineCalendar.tsx` (73),
`src/v2/pages/review/VideoTimeline.tsx` (72), `src/v2/components/Shell.tsx` (67),
`src/v2/App.tsx` (60). Pages and shell components that are mostly covered by the Playwright smoke
test rather than unit tests dominate this list.
