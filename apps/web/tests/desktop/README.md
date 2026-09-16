# Desktop Acceptance

These modules are test drivers and Worker probes, not installable plugins and
not part of the application source tree. The original modules were moved here
together; their source imports and Worker URLs retain their original targets.
Historical JSON evidence retains the paths used when it was recorded.

On 2026-09-15 the first-party Library Desk, Maintenance Desk, Memory Desk and
Text Desk plugins were removed. Probes that only drove those desk views were
deleted, and the remaining probes stopped starting the compiled desk Workers;
host behaviour (memory domain, digests, graph tasks, ranges, text state and
tasks, reading time, annotations, classification, feedback, observation) is
still exercised through the synthetic inline plugin actors and Agent tools.
On 2026-09-16 Listening Desk was removed as well (the native reader owns
playback and mode controls), Annotation Desk was renamed Annotations
(`plugins/annotations`, id `annotations`), and the compiled-plugin probes
follow the new path and id.
The directory currently holds 136 modules.

## Stage One Checks

From the repository root:

```sh
bun run --filter @read-aware/web typecheck:desktop
bun run --filter @read-aware/web test:desktop-contracts
```

The normal workspace typecheck includes this directory through its own tsconfig.
The contract tests validate module paths, prohibit production dependencies on
these drivers, and run the existing real Bun Worker protocol suite. They do not
start Tauri, prove native storage behavior, or count as plugin E2E acceptance.

## Stage Three Execution

Use only the isolated Tauri configuration at
`apps/desktop/src-tauri/tauri.capability-e2e.conf.json`. Driver imports from that
application's dev server now start with `/tests/desktop/`, for example
`/tests/desktop/desktop-selection-probe.ts`. Do not use the normal application or
its data directory. Each driver retains its isolation checks and explicit cleanup
entrypoints; preparation, observations, assertions and cleanup must all be
recorded. A cleanup failure is a failed round, not a successful test.

These existing probes are reusable building blocks, not the final plugin-round
runner. Stage two must map real installable plugin workflows to matrix rows;
stage three must run the complete mapped workflow with failure, concurrency,
cancellation and revocation paths and persist evidence. Old probe evidence does
not close that new acceptance requirement.
