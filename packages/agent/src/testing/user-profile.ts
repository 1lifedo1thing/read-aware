import { AppError, normalizeOnboardingChange, normalizeUserProfileChange, userProfilePage, userProfileRevision, normalizeProfileInspectionQuery, profileInspectionPage, type OnboardingReceipt } from "@read-aware/core";
import type { MemoryRecord, ProfilePort } from "../ports";

export function createProfileFixture(state: { summary: string | undefined }, memories: MemoryRecord[] = []): ProfilePort {
  const submissions = new Map<string, { input: string; receipt: OnboardingReceipt }>();
  let eventId: string | null = state.summary === undefined ? null : crypto.randomUUID();
  const snapshot = async () => {
    const summary = state.summary ?? null, event = eventId;
    return { summary, revision: await userProfileRevision(summary, event) };
  };
  const updateProfile: ProfilePort["updateProfile"] = async (raw, signal) => {
    const input = normalizeUserProfileChange(raw), captured = state.summary, capturedEvent = eventId;
    const revision = await userProfileRevision(captured ?? null, capturedEvent);
    if (revision !== input.expectedRevision) throw new AppError("memory/conflict", "Profile changed");
    const changed = captured !== input.summary, nextEvent = changed ? crypto.randomUUID() : capturedEvent;
    const nextRevision = await userProfileRevision(input.summary, nextEvent);
    signal?.throwIfAborted();
    if (state.summary !== captured || eventId !== capturedEvent) throw new AppError("memory/conflict", "Profile changed");
    if (changed) { state.summary = input.summary; eventId = nextEvent; }
    return { changed, revision: nextRevision, persistence: "event-log" };
  };
  return {
    getProfileContext: async () => ({ curated: state.summary ?? null, consolidated: null, derivedStatus: "absent" }),
    inspectProfileContext: async (input, signal) => {
      const query = normalizeProfileInspectionQuery(input);
      signal?.throwIfAborted();
      const page = await profileInspectionPage({ profile: await snapshot(), derived: null, sourceConditions: [] }, query);
      signal?.throwIfAborted();
      return page;
    },
    updateProfile,
    completeOnboarding: async (raw, signal) => {
      const input = normalizeOnboardingChange(raw), serialized = JSON.stringify(input);
      const previous = submissions.get(input.submissionId);
      if (previous) {
        if (previous.input !== serialized) throw new AppError("memory/conflict", "Submission id already used");
        return structuredClone({ ...previous.receipt, status: "already-completed" });
      }
      const before = eventId, observed = await snapshot();
      if (observed.revision !== input.expectedRevision) throw new AppError("memory/conflict", "Profile changed");
      const nextEvent = crypto.randomUUID(), revision = await userProfileRevision(input.summary, nextEvent), now = new Date().toISOString();
      const rows: MemoryRecord[] = input.seeds.map(seed => ({ ...seed, id: crypto.randomUUID(), scope: "user", importance: 0.7,
        evidenceCount: 1, status: "active", createdAt: now, updatedAt: now }));
      signal?.throwIfAborted();
      const concurrent = submissions.get(input.submissionId);
      if (concurrent) {
        if (concurrent.input !== serialized) throw new AppError("memory/conflict", "Submission id already used");
        return structuredClone({ ...concurrent.receipt, status: "already-completed" });
      }
      if (before !== eventId || observed.summary !== (state.summary ?? null)) throw new AppError("memory/conflict", "Profile changed");
      state.summary = input.summary; eventId = nextEvent; memories.push(...rows);
      const receipt: OnboardingReceipt = { status: "completed", submissionId: input.submissionId, revision, memoryIds: rows.map(row => row.id), persistence: "event-log" };
      submissions.set(input.submissionId, { input: serialized, receipt });
      return structuredClone(receipt);
    },
    getProfileSummary: async () => state.summary,
    readProfile: async (query, signal) => {
      signal?.throwIfAborted();
      const result = await userProfilePage(await snapshot(), query);
      signal?.throwIfAborted();
      return result;
    },
    putProfileSummary: async summary => { await updateProfile({ summary, expectedRevision: (await snapshot()).revision }); },
  };
}
