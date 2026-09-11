/** ProfilePort reads and edits the event-backed summary projection. */
import type { ProfilePort } from "@read-aware/agent";
import { changeUserProfile, putUserProfile, readUserProfile, readUserProfilePage } from "../../../../domain/user-profile";
import { readProfileContext, inspectProfileContext } from "../../../../domain/identity-consolidation";
import { completeOnboarding } from "../../../../domain/onboarding";

export function createProfilePort(): ProfilePort {
  return {
    getProfileContext: readProfileContext,
    inspectProfileContext,
    getProfileSummary: readUserProfile,
    readProfile: readUserProfilePage,
    putProfileSummary: putUserProfile,
    updateProfile: (input, signal) => changeUserProfile(input, "agent", signal),
    completeOnboarding: (input, signal) => completeOnboarding(input, "agent", signal),
  };
}
