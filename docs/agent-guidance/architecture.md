# Architecture decisions

Read for changes to memory, retrieval, persistence, sync, or reader architecture.
These are product constraints and design context, not a work queue: implement
only the capabilities in the current task. Verify implementation claims against
current code. Paths below are relative to the repository root.

- Product architecture: single-agent system (one orchestrator over deterministic pipelines, not one LLM loop doing everything)
- User experience: the in-book chat is one persistent surface per book (prompt assembly is stateless per turn — continuity lives in the memory layer, not the transcript); the global (Context page) chat supports multiple user-created threads. Memory never splits per thread
- System model: memory-first, not transcript-first
- Deployment model: **local-first** — data and retrieval live on-device; the remote backend is a sync/relay layer, not where business logic lives
- Two independent axes — keep them separate:
  - **Data + retrieval: local** (on-device store + SQLite FTS; no vector store — see Storage Responsibilities)
  - **LLM inference: remote** (BYO API key or a thin proxy; no local model required)
- Frontend: a `React + TypeScript` SPA, shipped **only** inside the `Tauri` desktop app (desktop-only)
- On-device storage: `SQLite` only (source of truth + FTS retrieval). **No embeddings / vector store in the default architecture** (decided 2026-07-02, see `docs/agent-architecture.md` §4)
- Remote backend: sync + relay only (see Storage Responsibilities)

### Agent Model

- ReadAware uses one core agent that orchestrates the product's intelligence
- This agent is responsible for:
  - building and updating the user's profile
  - updating user memory over time
  - retrieving relevant book notes, highlights, and prior conversations
  - assembling the right context for the current reading moment
- Do not model the product as multiple user-visible agents unless the product direction explicitly changes

### Memory and Context

- The core system problem is memory management, not chat history management
- User-visible chat should feel continuous, but the system should not rely on dumping all prior messages into the prompt
- Treat chat transcripts as raw source material, not as the memory layer itself
- Memory is **event-sourced**. Model it in layers:
  - `raw events` — append-only, immutable; **this is the unit of sync** (see Storage Responsibilities)
  - working memory — local projection
  - long-term user memory — local projection
  - book / highlight / note memory — local projection
  - exportable context bundles — local projection
- Everything above `raw events` is a **local projection rebuilt from the event log** — projections are recomputed on-device, never synced directly. This is enforced, not aspirational: `storage/apply.rs` is the only writer of a projection row, and `rebuild_projections` can reproduce every one of them from the log. One thing is deliberately NOT derived and is excluded from the check: chat presentation state (`parts_json`, `error`). Covers are fully derived: `book.coverExtracted` projects `books.cover_status`/`cover_blob_key` (the verdict — `ready` with a synced `cover:` blob, or `none`), the bytes live in the device-local blob registry, and the shelf paints them through the `rablob://` scheme rather than any data-URL column
- Design the **write / consolidation pipeline** as explicitly as retrieval; it is the harder half:
  - promotion from raw events into long-term memory (summarization / consolidation)
  - conflict resolution when new information contradicts old memory
  - decay / forgetting so memory does not grow into noise
  - dedup / entity resolution behind "repeated appearance across books or conversations"
- Memory retrieval should consider more than text-match relevance, including:
  - relevance to the current reading goal
  - recency
  - importance
  - explicit user feedback
  - repeated appearance across books or conversations

### Storage Responsibilities

- On-device `SQLite` is the source of truth for structured application data:
  - users / profile
  - books
  - highlights
  - notes
  - raw events (the append-only log)
  - memory metadata
  - context bundle versions
- **Retrieval is structured, not vector-based**: SQLite FTS + scope/recency/importance signals, plus agentic iterative search (the agent reformulates queries, walks the TOC, reads chapters). The product's unit of intelligence is the user's reading trace (annotations, questions, memories), not the book corpus — retrieval needs are deliberately lightweight
- No embedding model, no LanceDB in the default build. If FTS + agentic search ever proves insufficient, the upgrade ladder is: embed memories + annotations first, full text last — and any vector index would be a derived, rebuildable, never-synced projection
- The remote backend is **sync + relay only**, never a source of truth. Its only jobs:
  - identity / auth
  - durable storage of the (preferably E2E-encrypted) event log + large blobs (book files, derivatives) for multi-device merge and new-device bootstrap
  - a change feed to sync event logs across devices
  - optionally, an LLM proxy (to hide / meter API keys)
- The backend holds no business logic — consolidation, retrieval, and bundle assembly all run on-device
- Reach storage through a pluggable `StorageAdapter` (native filesystem + SQLite on desktop). The abstraction stays for testability and clean layering — **not** to support an in-browser engine port

### Context Portability

- Context must be dynamically updatable
- Context must be exportable at any time
- Exported context should be usable by external agents or systems
- Prefer structured context bundles over ad hoc prompt strings
- Likely bundle types include:
  - `user_profile_context`
  - `reading_intent_context`
  - `book_memory_context`
  - `conversation_insights_context`

### Platform Direction

- **Local-first**: the app must be fully usable offline against on-device data; the network is for sync and (optional) remote inference, not for core reads/writes
- **Desktop-only**: the product ships as the Tauri desktop app. The web build exists only as Tauri's bundled frontend and for local dev / Storybook — there is no standalone browser app, PWA, or in-browser storage engine
- **Verify desktop behavior in Tauri**: imports, reading, persistence, raw-IPC book blobs and AI integrations need the running Tauri app. An isolated browser UI check can verify layout or component behavior, but does not prove those desktop integrations. Packaged-build constraints such as production CSP need a real `bun run build:desktop` build. Respect the task's acceptance phase and report deferred runtime checks as pending.
- **E2E by default**: end-to-end encrypt synced data. With no server-backed web client to feed, the server stays a dumb encrypted relay — there is no E2E-vs-web-client tradeoff to weigh
- Do not use no-code / visual agent platforms as the core product architecture
- Keep the AI layer code-first and product-native
- Prefer explicit state, explicit memory writes, and explicit retrieval pipelines over opaque agent magic

### Reader Engine Strategy

- Single reading engine: **`foliate-js`** renders every supported format —
  `EPUB`, `MOBI`, `AZW3`, `FB2`, `PDF` — under one selection / annotation / CFI /
  progress model
- The engine is **vendored**, served as a static ES-module tree from
  `apps/web/public/foliate-js` and loaded at runtime via script injection (see
  that folder's `VENDOR.md` and `features/reader/lib/foliate-engine.ts`); do not
  bundle it
- Read original files directly — **no format conversion, no Calibre, no
  normalized derivatives**. Keep only the imported source file
- Surface DRM-protected files as unsupported with explicit UX messaging
