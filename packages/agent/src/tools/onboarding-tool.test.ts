import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildOnboardingTool } from "./onboarding-tool";
import type { UserInteractionAnswer, UserInteractionRequest } from "../ports";

const params = { title: "Your reading", labels: { goals: "Reading goals", background: "Background", explanationDepth: "Explanation depth", language: "Language" } };
const scope = { kind: "global" as const, threadId: "onboarding" };

test("interview collects answers, reviews an immutable full candidate and commits exactly once", async () => {
  const { deps, stores } = createInMemoryDeps();
  const requests: UserInteractionRequest[] = [];
  deps.interactions.request = async (request): Promise<UserInteractionAnswer> => {
    requests.push(structuredClone(request));
    expect(stores.profile.summary).toBeUndefined(); expect(stores.memories).toHaveLength(0);
    if (request.kind === "form") return { values: { goals: "History", background: "Engineer", language: "English" } };
    expect(request).toMatchObject({ action: "complete-onboarding", subject: "Reading goals: History\nBackground: Engineer\nLanguage: English",
      onboardingSeeds: [{ kind: "preference", content: "Reading goals: History" }, { kind: "fact", content: "Background: Engineer" }, { kind: "preference", content: "Language: English" }] });
    if (request.kind === "permission") { request.subject = "Tampered"; request.onboardingSeeds![0]!.content = "Tampered"; }
    return { optionId: "approve" };
  };
  let candidate: Parameters<typeof deps.profile.completeOnboarding>[0] | undefined;
  const commit = deps.profile.completeOnboarding;
  deps.profile.completeOnboarding = async input => { candidate = structuredClone(input); return commit(input); };
  await buildOnboardingTool(scope, deps).execute("interview", params);
  expect(requests.map(request => request.kind)).toEqual(["form", "permission"]);
  expect(requests[0]!.id).not.toBe(requests[1]!.id);
  expect(stores.profile.summary).not.toContain("Tampered"); expect(stores.memories).toHaveLength(3);
  expect(stores.savedMemoryInputs).toHaveLength(0);
  const retry = await commit(candidate!);
  expect(retry.status).toBe("already-completed"); expect(stores.memories).toHaveLength(3);
  await expect(commit({ ...candidate!, summary: "Other" })).rejects.toMatchObject({ code: "memory/conflict" });
});

test.each(["skip", "empty", "decline", "invalid", "conflict", "disabled", "cancel", "write-failure"])("interview %s never leaves a partial profile", async mode => {
  const { deps, stores } = createInMemoryDeps();
  const controller = new AbortController();
  let enabled = true;
  deps.memoryPolicy = { enabled: () => enabled, subscribe: () => () => {} };
  deps.interactions.request = async (request): Promise<UserInteractionAnswer> => {
    if (request.kind === "form") return mode === "skip" ? { cancelled: true } : { values: mode === "empty" ? {} : { goals: mode === "invalid" ? true : "History" } };
    if (mode === "conflict") await deps.profile.updateProfile({ summary: "Other writer", expectedRevision: (await deps.profile.readProfile()).revision });
    if (mode === "disabled") enabled = false;
    if (mode === "cancel") controller.abort();
    return { optionId: mode === "decline" ? "decline" : "approve" };
  };
  if (mode === "write-failure") deps.profile.completeOnboarding = async () => { throw new AppError("db/locked", "Fault"); };
  const work = buildOnboardingTool(scope, deps).execute("interview", params, controller.signal);
  if (["skip", "empty", "decline"].includes(mode)) await work;
  else await expect(work).rejects.toBeDefined();
  expect(stores.memories).toHaveLength(0);
  expect(stores.profile.summary).toBe(mode === "conflict" ? "Other writer" : undefined);
});

test("interview refuses existing profiles and book scope without asking or writing", async () => {
  const { deps, stores } = createInMemoryDeps({ profile: "Already configured" });
  deps.interactions.request = async () => { throw Error("Should not ask"); };
  await buildOnboardingTool(scope, deps).execute("existing", params);
  await expect(buildOnboardingTool({ kind: "book", bookId: "b" }, deps).execute("book", params)).rejects.toMatchObject({ code: "memory/forbidden" });
  expect(stores.profile.summary).toBe("Already configured"); expect(stores.memories).toHaveLength(0);
});
