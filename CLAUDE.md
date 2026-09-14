# ReadAware

AI-native reading application. Bun workspaces and Turborepo; React 19 SPA,
TanStack Router, Jotai, Tailwind CSS v4, Vite, and a Tauri 2 desktop shell.
`AGENTS.md` links to this file; keep these instructions useful across coding agents.

## Product and architecture boundaries

- The shipping reading app is desktop-only. `apps/web` supplies Tauri's frontend
  and local dev/Storybook; it is not a standalone browser/PWA product.
  `apps/landing` is the separate public marketing site.
- Data and retrieval are local: SQLite is the source of truth, with FTS and
  structured retrieval. No embeddings/vector store in the default architecture.
  LLM inference is remote through BYO keys or a thin proxy.
- Application state writes go through event-sourced domain commands and
  `commit_events`; event append and projection updates share one transaction.
  Keep projections rebuildable. Use the existing StorageAdapter and domain seams.
- Sync is an E2E-encrypted event/blob relay, not a business-logic backend.
- The product uses one core agent over deterministic pipelines. Continuity lives
  in memory, not a transcript dump; memory does not split per chat thread.
- `foliate-js` is the single reader engine. Keep it vendored as static runtime
  modules; read original files without conversion. Surface DRM as unsupported.
- Keep module responsibilities clear: components render, hooks own React state
  and effects, and pure transformations belong in reusable modules.

## Work and verification

- Keep changes within the agreed deliverable. Architecture guidance does not
  authorize completing every future capability described in a reference.
- Choose validation by the changed behavior. Product import, reading, storage,
  IPC and AI integration acceptance must use the running Tauri app. Plain browser
  checks can verify isolated frontend/layout behavior, not desktop integration.
  Production CSP or packaging changes need the packaged desktop build.
- Respect the user's implementation and acceptance phases. Mark deferred runtime
  acceptance explicitly pending; local checks do not close that boundary.
- Validate document facts and links for content edits. Check rendered layout or
  interactions when those change or content creates a concrete rendering risk;
  unchanged templates do not require repeating the full visual suite.
- Preserve the task's worktree changes. Automatically commit coherent, validated
  units with only their related files; do not push without authorization.

## Code entrypoints

- `apps/web/src/domain`: shared domain reads, commands, and subscriptions.
- `apps/web/src/features`: feature UI and orchestration; `platform/ipc` is the IPC seam.
- `apps/desktop/src-tauri`: native commands, SQLite, filesystem and shell.
- `packages/core`: contracts, entities, events and StorageAdapter.
- `packages/agent`: agent runtime, tools, memory and context assembly.
- `packages/plugin-types` and `plugins`: public plugin API and first-party consumers.
- `packages/ui`: shared design system. Use `@read-aware/ui` components,
  `@read-aware/ui/cn`, and `@phosphor-icons/react` icons for product UI.

## References by task

Documentation map: [the documentation index](docs/README.md). Read only the references needed
for the current change. Paths are repo-relative; `docs/archive/` is historical,
not a source of current implementation status or automatic work items.

| Task | Reference |
| --- | --- |
| Memory, retrieval, storage or reader architecture | [Architecture decisions](docs/agent-guidance/architecture.md); `docs/architecture/agent-architecture.md` or `docs/architecture/data-model.md` for the affected design |
| Sync behavior | [Sync engine](docs/architecture/sync-engine.md) |
| Product UI and component conventions | [UI conventions](docs/agent-guidance/ui.md) |
| Error handling and IPC | [Error contract](docs/agent-guidance/errors.md); keep stable codes, localized user messages, logged raw errors, honest retries and visible read/write failures |
| Plugin boundaries | [Plugin system](docs/plugins/plugin-system.md) |
| Host/Agent/plugin capability delivery | Start from the finite [acceptance list](docs/capabilities/host-capability-acceptance.md), then read only affected rows in `docs/capabilities/host-capability-matrix.data.ts` / `docs/capabilities/host-capability-model.data.ts`; use the compact [evidence index](docs/capabilities/host-capability-delivery.md) for prior proof. Generated MD/HTML are outputs |
| Agent behavior evals | `.agents/skills/evals/SKILL.md` |
| Authorized release work | `.agents/skills/publishing/SKILL.md` |
| Historical migrations | [Historical implementation notes](docs/archive/reviews/implementation-history.md); not current status |

## Commands

Run from the repo root using bun. Select commands relevant to the change:
`bun run dev` (Tauri), `bun run dev:web`, `bun run dev:landing`,
`bun run storybook`, `bun run test`, `bun run typecheck`, `bun run build`,
`bun run build:desktop`. Consult the affected package's scripts for focused checks.
