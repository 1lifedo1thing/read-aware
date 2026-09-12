# Historical implementation notes

Moved from the root instructions on 2026-09-12. These v0.3.0-era notes are
historical context, not a current completion ledger. Check relevant runtime code,
schema migrations and `docs/host-capability-delivery.md` before relying on a
status, schema number, or listed gap. Read only for historical migration work.

> **Historical implementation status** (v0.3.0, as recorded before extraction):
>
> - Frontend-only monorepo (`apps/web` + `apps/desktop`); the Python backend is
>   gone.
> - **Persistence is SQLite**, not the old IndexedDB/localStorage interim layer.
>   IndexedDB survives only in one-time migration code and a font cache.
> - **Event sourcing is live for writes.** Every state change goes through
>   `commit_events`, which appends to `domain_events` and applies it to the
>   projections in ONE transaction (`storage/apply.rs`).
>   `rebuild_projections` replays the log into the tables;
>   `verify_projections` replays into scratch and diffs, so drift is
>   detectable rather than assumed absent.
> - **Known gap:** rows written before that landed still carry mutations the
>   log never recorded (a recolor, a memory reinforcement). `verify_projections`
>   reports them; they cannot be recovered, only outgrown.
> - **Sync engine is live** (relay = Cloudflare Worker + DO mailbox + R2,
>   E2E-sealed; docs/sync-engine.md). Since 2026-09-07: exact bookkeeping
>   (`unverified` rows settle via `/v1/events/have` + blob HEAD, and a pull's
>   `seqs` acknowledge pushes — a re-login never re-uploads), projection
>   checkpoints (replay = newest valid checkpoint + tail; a published
>   `snapshot:` blob bootstraps a new device in one download, the log
>   backfills behind it), and reading is modelled as SESSIONS: ticks and page
>   turns land in the `reading_sessions_pending` scratch pad, one
>   `book.sessionRecorded` (time + position, last-observed-wins) per closed
>   hour bucket — `book.progressed` / `book.timeRecorded` are legacy.
> - **Profile/entity projections are live** (schema 33): profile field patches,
>   retained entity definitions/aliases and flat merge redirects participate in
>   replay and checkpoints. The summary migrates from KV through a transaction;
>   prompt reads, onboarding, memory 2 profile queries/conditional edits and v1
>   backup summary restore share this projection. Entity consumers and the
>   consolidation pipeline are not built yet.
> - **Book memory v1 is live**: `book.chapterDigested` events project to
>   `chapter_digests` (per-finished-chapter summary + entity registry,
>   names spelled as THIS edition spells them), filled by an idle pipeline
>   and injected into the book-thread system prompt behind the spoiler
>   boundary. Selection turns additionally get deterministic grounding
>   context (`runtime/grounding-context.ts`) assembled host-side.
> - **Digests are narrativity-flavored**: the idle pipeline first classifies
>   an unclassified book (`book.narrativityClassified` → `books.narrativity`);
>   narrative books digest to a character/relation graph behind the spoiler
>   fence, expository books to a concept graph ("argument so far") with no
>   fence. Flavor-mismatched rows (reclassified book) redigest lazily.
> - Target on-device schema: `docs/data-model.md`. Current audit:
>   `docs/review-0.3.0.html`.
