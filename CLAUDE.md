# ReadAware

AI-native desktop reading app. Bun workspaces and Turborepo; React 19,
TanStack Router, Jotai, Tailwind CSS v4, Vite, and Tauri 2.
`AGENTS.md` links to this file; maintain one shared set of project instructions.

## Delivery

- Complete the requested behavior and its agreed acceptance. Continue through
  implementation, relevant verification, and fixes caused by the change without
  pausing for approval of each routine local step.
- Keep the scope finite. A reference's future design or old pending item does not
  become a new deliverable. Once the agreed criteria are met, finish; explain any
  remaining external blocker or deferred acceptance accurately.
- Preserve unrelated worktree changes. Automatically commit coherent units after
  appropriate validation, staging only their files. Push only when authorized.

## Architecture

- The shipping app is desktop-only. `apps/web` supplies Tauri's frontend and local
  dev/Storybook; `apps/landing` is the separate public marketing site.
- Data and retrieval stay on-device: SQLite is the source of truth, with FTS and
  structured retrieval. No embeddings/vector store in the default architecture.
  Local reading and data operations work offline; LLM inference uses remote BYO
  keys or a thin proxy.
- Business state writes use domain commands and `commit_events`. Event append and
  projection updates share one transaction; native committers follow the same
  contract. Use the existing `StorageAdapter` and domain seams. Rebuild projections
  with the shared rules in `apps/desktop/src-tauri/src/storage/apply.rs`; device-local
  settings, chat presentation, task state and legacy data have separate retention
  rules, so not every SQLite row can be rebuilt from events.
- Sync relays E2E-encrypted events and blobs. Business logic and projections stay
  on-device; projections are not independently synced as authoritative rows.
- One core agent orchestrates deterministic pipelines. Continuity lives in memory,
  not a transcript dump. In-book chat is one persistent surface per book; global
  chat supports user-created threads. Memory never splits per chat thread.
- Design memory retrieval around scope, reading progress, relevance and feedback.
  Memory writes and consolidation must account for promotion, conflicts, deduplication,
  entity identity and forgetting. Context exports use structured, versioned bundles.
- `foliate-js` is the single reader engine, vendored under
  `apps/web/public/foliate-js` as static runtime modules. Read original files without
  conversion or rebundling the engine; surface DRM as unsupported.

## UI and code structure

- Components render; hooks own React state, effects and orchestration; pure
  transformations belong in reusable modules. Keep these responsibilities separate.
- Use `@read-aware/ui` components, `@read-aware/ui/cn`, and
  `@phosphor-icons/react` icons for product UI. Shared components and their
  co-located Storybook stories live in `packages/ui/src`; use the existing APIs
  rather than maintaining a second component catalog here.
- Follow tokens in `apps/web/src/index.css`: paper backgrounds, stone colors,
  `text-eyebrow`, `text-caption`, and `leading-display`. Keep the interface quiet:
  no gradients, decorative badges or ornamental highlights. Use serif for display
  and sans for other text; `stone-600` is the minimum body text color on paper.
- Keep keyboard navigation, ARIA and ref behavior consistent with shared components.
  Product icons come from the icon library, not hand-drawn SVG in feature code.

## Errors and IPC

- Use `AppError` / `CommandError` and stable additive error codes from
  `packages/core/src/errors.ts` and `apps/desktop/src-tauri/src/error.rs`.
  Do not rename persisted codes. Import `invoke` through `platform/ipc`, which
  normalizes native failures, rather than directly from the Tauri API.
- Log raw errors; show localized messages through `describeError` or
  `describeErrorCode` in `apps/web/src/i18n/describe-error.ts`. Raw error strings
  do not belong in user-facing messages.
- A failed read shows an error, not an empty result. A failed write reports failure;
  optimistic local KV/secret state rolls back and emits `local-write-failed`.
- Use destructive `useToast` for failed actions, `InlineError` for persistent
  failures, and field `error` props for validation. Ordinary errors do not open
  dialogs; boot failures and error boundaries are separate surfaces. Offer retry
  only when `describeError().retryable` permits it; otherwise show the corrective
  action when available.
- Catch blocks need a user-facing result, a log, or a documented reason that
  ignoring the failure is correct. Background memory, digest, plugin and sync
  pipelines log degraded behavior through their logger.

## Verification

- Choose checks for the behavior and risk changed. Fix failures caused by this
  task; broaden or repeat checks when new changes, failures or unresolved concerns
  justify it. Types and mocks, real runtime behavior and deployment prove different
  boundaries.
- Import, reading, storage, IPC and AI integration acceptance uses the running
  Tauri app. Browser checks cover isolated frontend/layout behavior. Production
  CSP and packaging need the packaged desktop build.
- Respect the agreed implementation and acceptance phases. Deferred runtime
  acceptance stays pending; local checks do not close that boundary.
- For documentation edits, validate facts and links. Check rendered layout or
  interactions when they change or the content creates a concrete rendering risk;
  unchanged templates do not require another full visual suite.

## Code and documentation

- `apps/web/src/domain`: shared reads, commands and subscriptions.
- `apps/web/src/features`: feature UI and orchestration; `platform/ipc` is the IPC seam.
- `apps/desktop/src-tauri`: native commands, SQLite, filesystem and shell.
- `packages/core`: contracts, entities, events and `StorageAdapter`.
- `packages/agent`: agent runtime, tools, memory and context assembly.
- `packages/plugin-types` and `plugins`: public plugin API and first-party consumers.

Read references when their subject is needed for the current task. The
[documentation index](docs/README.md) is the full map; `docs/archive/` contains
historical material, not current status or an automatic work queue.

| Task | Reference |
| --- | --- |
| Agent, memory and context design | [Agent architecture](docs/architecture/agent-architecture.md), [identity and profile](docs/architecture/identity-and-profile.md), [context bundles](docs/architecture/context-bundles.md) |
| Storage or restore | [Data model](docs/architecture/data-model.md), [full backup](docs/features/full-backup.md) |
| Sync behavior | [Sync engine](docs/architecture/sync-engine.md) |
| Plugin boundaries | [Plugin system](docs/plugins/plugin-system.md) |
| Host/Agent/plugin capability delivery | Start with the finite [acceptance list](docs/capabilities/host-capability-acceptance.md); inspect affected rows in `docs/capabilities/host-capability-matrix.data.ts` / `docs/capabilities/host-capability-model.data.ts` and the [current handoff](docs/capabilities/host-capability-delivery.md). Generated MD/HTML are outputs |
| Agent behavior evals | `.agents/skills/evals/SKILL.md` |
| Authorized release work | `.agents/skills/publishing/SKILL.md` |

## Commands

Use bun from the repo root. Available scripts include `bun run dev` (Tauri),
`bun run dev:web`, `bun run dev:landing`, `bun run storybook`, `bun run test`,
`bun run typecheck`, `bun run build`, `bun run build:desktop`, and
`bun run check:docs`. Select relevant commands; package scripts provide focused checks.
