# Code structure

> Updated: 2026-07-18

```
ReView-app/
├── docker-compose.yml       # postgres + minio + redis + backend + worker + frontend
├── DOCUMENTATION/           # this manual (English, committed, served on /docs)
├── backend/
│   ├── prisma/schema.prisma # single source of truth for the data model
│   └── src/
│       ├── server.ts, app.ts    # bootstrap Express + Socket.io
│       ├── config/env.ts        # Zod-validated environment
│       ├── lib/                 # prisma, redis, jwt, errors, hls, pipeline…
│       ├── middleware/          # auth (JWT), rbac, validate (Zod), error, rateLimit
│       ├── services/            # business logic (Storage, Job, Socket, Bulk…)
│       ├── workers/ffmpeg.worker.ts
│       └── routes/              # one thin router per domain (≤ 200 lines)
└── frontend/
    ├── scripts/build-docs.mjs   # DOCUMENTATION/ → public/docs + manifest
    └── src/
        ├── v2/                  # the app: App.tsx (routing), pages/, components/
        │   ├── components/ui/   # shadcn-style primitives (shared)
        │   ├── components/review/  # viewers (video, image, 3D, splat), camera/
        │   ├── lib/             # queries (TanStack), query keys, shortcuts…
        │   └── types/api.ts     # one entity = one type definition
        ├── lib/                 # apiClient, uploadClient
        └── stores/              # Zustand (uploads, auth…)
```

## Principles

- **Routes are thin**: validate (Zod) → call a service/lib → respond. Business
  logic lives in `services/`/`lib/`, testable in isolation.
- **One entity, one type** (`v2/types/api.ts`), composed with `Pick`/intersections
  — never re-declared locally.
- **Data fetching = TanStack Query only** (`qk.*` keys, hooks in
  `lib/queries.ts`); mutations invalidate targeted keys and give user feedback.
- Size budgets: components/pages ≤ ~300 lines, backend routes ≤ ~200 lines —
  enforced by ESLint `max-lines` and the validation script.

## Related pages

- [Conventions](conventions.md)
- [Validation & tests](validation-and-tests.md)
- [Internationalisation](i18n.md)
