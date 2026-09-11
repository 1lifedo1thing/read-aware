import { expect, test } from "bun:test";
import { AppError, type OnboardingReceipt } from "@read-aware/core";
import { createOnboardingService } from "./onboarding";
import type { DomainEventDraft } from "../platform/domain-events";
import { deferred } from "../../tests/helpers/profile-host";
import { durableWrites } from "../platform/write-settlement";

test.each(["committed", "replayed", "failed", "cancel-before", "disabled"])("onboarding %s keeps the dispatch, immutable candidate and receipt boundaries", async mode => {
  const entered = deferred(), gate = deferred(), controller = new AbortController();
  const broadcasts: DomainEventDraft[] = [], calls: unknown[] = [];
  let enabled = true;
  const service = createOnboardingService({ allowed: () => enabled, initialize: async () => {},
    mint: async drafts => {
      if (mode === "cancel-before" || mode === "disabled") { entered.resolve(); await gate.promise; }
      return drafts.map(draft => ({ ...draft, id: "minted", hlc: { wallMs: 1, counter: 1, deviceId: "test" } }));
    }, broadcast: drafts => { broadcasts.push(...drafts); },
    invoke: async <T>(command: string, args: unknown): Promise<T> => {
      calls.push({ command, args: structuredClone(args) }); entered.resolve(); await gate.promise;
      if (mode === "failed") throw new AppError("db/locked", "Fault");
      return { status: mode === "replayed" ? "already-completed" : "completed", submissionId: "interview", revision: `profile2:${"b".repeat(64)}`,
        memoryIds: ["seed"], persistence: "event-log" } as OnboardingReceipt as T;
    },
  });
  const input = { submissionId: "interview", expectedRevision: `profile2:${"a".repeat(64)}`, summary: "Approved summary", seeds: [{ kind: "fact" as const, content: "Approved fact" }] };
  const pending = service(input, "plugin:journal", controller.signal);
  input.summary = "Changed"; input.seeds[0]!.content = "Changed";
  await entered.promise;
  if (mode !== "disabled") controller.abort();
  enabled = false;
  expect(broadcasts).toHaveLength(0);
  if (mode !== "cancel-before" && mode !== "disabled") expect(durableWrites.size).toBeGreaterThan(0);
  gate.resolve();
  if (mode === "failed" || mode === "cancel-before" || mode === "disabled") await expect(pending).rejects.toBeDefined();
  else expect(await pending).toMatchObject({ status: mode === "replayed" ? "already-completed" : "completed" });
  expect(broadcasts).toHaveLength(mode === "committed" ? 1 : 0);
  if (calls.length) expect(calls[0]).toMatchObject({ command: "onboarding_commit", args: { event: { type: "profile.onboarded", origin: "plugin:journal", payload: {
    summary: "Approved summary", seeds: [{ content: "Approved fact" }],
  } } } });
  else expect(["cancel-before", "disabled"]).toContain(mode);
});
