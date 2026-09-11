import { appDataDir } from "@tauri-apps/api/path";
import { createRoot, type Root } from "react-dom/client";
import type { OnboardingChange } from "@read-aware/core";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { toChatInteractionRequest } from "../../src/features/ai/agent/chat-interaction-request";
import { ChatInteractionPrompt } from "../../src/features/ai/components/ChatInteractionPrompt";
import type { ChatInteractionPart } from "../../src/features/ai/lib/chat-types";
import { buildOnboardingTool } from "../../../../packages/agent/src/tools/onboarding-tool";
import { interactionFromToolDetails } from "../../../../packages/agent/src/tools/user-interaction";
import { invoke } from "../../src/platform/ipc";
import { getDefaultStore } from "jotai";
import { startPluginWorker } from "../../src/features/plugins/runtime/plugin-worker-host";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { parseProbeToast } from "./probe-toast";

let root: Root | undefined, container: HTMLElement | undefined, controller: AbortController | undefined;
let work: Promise<void> | undefined, outcome: unknown, candidate: OnboardingChange | undefined;
async function isolated() {
  const path = (await appDataDir()).replace(/[/\\]$/, "");
  if (!path.endsWith("/com.readaware.app.capability-onboarding-20260911")) throw Error("Isolated onboarding data required");
  return path;
}
export async function beginOnboardingApproval() {
  await isolated();
  if (work) throw Error("Finish the previous interview first");
  container = document.createElement("div"); container.dataset.onboardingApproval = "true";
  Object.assign(container.style, { position: "fixed", zIndex: "10000", inset: "72px 24px 24px", maxWidth: "640px", margin: "auto", background: "var(--color-paper, white)", padding: "16px", overflow: "auto" });
  document.body.append(container); root = createRoot(container); controller = new AbortController(); outcome = { status: "pending" };
  const deps = buildRuntimeDeps(), commit = deps.profile.completeOnboarding;
  deps.profile.completeOnboarding = (input, signal) => { candidate = structuredClone(input); return commit(input, signal); };
  let part: ChatInteractionPart | undefined;
  work = buildOnboardingTool({ kind: "global", threadId: "onboarding-probe" }, deps).execute(crypto.randomUUID(), {
    title: "Your reading profile", labels: { goals: "Reading goals", background: "Background", explanationDepth: "Explanation depth", language: "Language" },
  }, controller.signal, update => {
    const details = interactionFromToolDetails(update.details);
    if (details?.phase === "request") part = { type: "interaction", id: details.request.id, request: toChatInteractionRequest(details.request), state: "pending" };
    if (details?.phase === "response" && part) part = { ...part, state: "answered", answer: details.answer };
    if (part) root?.render(<ChatInteractionPrompt part={part} />);
  }).then(result => { outcome = { status: "done", result }; }, error => { outcome = { status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null }; });
  return { started: true };
}
export async function onboardingProbeStatus() {
  const path = await isolated(), deps = buildRuntimeDeps();
  return { path, outcome, profile: await deps.profile.readProfile(), memories: await deps.memory.listMemories() };
}
export async function repeatOnboardingSubmission() {
  await isolated(); if (!candidate) throw Error("No approved submission");
  return buildRuntimeDeps().profile.completeOnboarding(candidate);
}
export async function verifyOnboardingProjections() {
  await isolated(); return invoke("verify_projections");
}
export async function runOnboardingWorkerProbe(write: boolean) {
  await isolated();
  const id = `capability-onboarding-${write ? "write" : "read"}`, disposables: PluginDisposable[] = [];
  const sandbox = await startPluginWorker({ id, name: "Onboarding probe", version: "1.0.0", schemaVersion: 1,
    permissions: [write ? "memory:write" : "memory:read"], requires: { domains: { memory: "^2.5.0" } } }, "0.5.4", disposables,
    { moduleUrl: new URL("./onboarding-wire-probe.ts", import.meta.url).href });
  try {
    await sandbox.checkHealth(); sandbox.promote();
    const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === "onboarding");
    if (!command) throw Error("Missing Worker command");
    return parseProbeToast((await command.run())!.toast!);
  } finally { await sandbox.terminate(); for (const item of disposables.reverse()) item.dispose(); }
}
export async function endOnboardingApproval() {
  controller?.abort(); await work; work = undefined; controller = undefined;
  root?.unmount(); root = undefined; container?.remove(); container = undefined;
  return outcome;
}
