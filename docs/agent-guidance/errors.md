# Error handling conventions

Read when adding or changing error handling, IPC commands, or background pipelines.
Paths below are relative to the repository root.

## Error Handling

The app has ONE error-handling contract (landed 2026-08-30; see
`packages/core/src/errors.ts`, `apps/web/src/i18n/describe-error.ts`,
`apps/desktop/src-tauri/src/error.rs`):

- **Stable codes, not prose.** Failures carry a machine-readable code
  (`fs/not-found`, `db/locked`, `ai/rate-limited`, `sync/network`…) via
  `AppError` (TS) / `CommandError` (Rust). Codes are only ever added, never
  renamed — persisted `errorCode` columns and localized copy match on them.
- **Raw error text never reaches the user.** `error.message` goes to the file
  log (`createLogger(...)`) where the diagnostics bundle picks it up; the UI
  renders `describeError(error, { fallback })` / `describeErrorCode(code)` —
  localized copy from `common:errors.*` (all 8 locales). No `{error.message}`
  in JSX, no `t("...", { message })` interpolation of raw text.
- **IPC goes through the seam.** Import `invoke` from `platform/ipc`, never
  from `@tauri-apps/api/core` — raw invoke rejects with a bare string, the
  seam normalizes it to an `IpcError` with a code. New Rust commands return
  `Result<T, CommandError>` (storage/secrets already do); legacy `String`
  errors map to `ipc/unknown`.
- **Catch blocks pick one of three, always:** (a) a comment naming why
  swallowing is correct (best-effort cache, platform no-op, parse fallback),
  (b) a log line, or (c) a user-facing surface. Silent `catch {}` on anything
  the user would care about is a bug.
- **Read failure ≠ empty state.** A failed load renders an error state
  (`InlineError`, usually with retry), never `catch → []` — an empty shelf and
  a locked database must not look alike.
- **Write failure must be told.** A failed save gets a destructive toast; a
  write-through snapshot (localKV, secret-store) rolls back and emits
  `local-write-failed` instead of pretending the change stuck.
- **Three presentation surfaces only:** destructive `useToast` (an action
  failed, transient), `InlineError` from @read-aware/ui (persistent in-surface
  failure, quiet stone palette per the design system), and the form-control
  `error` prop (field validation). **Never a Dialog** — errors don't
  interrupt; the only full-screen failures are boot failure and the error
  boundaries.
- **Retry only when honest.** `describeError().retryable` says whether "try
  again" can succeed; don't offer retry on terminal failures (quota, bad
  input), offer the fix surface instead (`action`, e.g. open AI settings).
- **Background pipelines log.** Anything running without a surface (memory
  extraction, digests, plugin schedules, sync cycles) takes a logger
  (`deps.log` in @read-aware/agent) and warns on every degraded fallback.
