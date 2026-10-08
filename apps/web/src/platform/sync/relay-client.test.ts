import { describe, expect, test } from "bun:test";
import { ERR_SYNC_FILE_TOO_LARGE, ERR_SYNC_QUOTA, errorCode } from "@read-aware/core";
import { classifySyncError } from "./classify-sync-error";
import { createRelayClient, RelayError } from "./relay-client";

/** A client whose relay answers every request with this status and body. */
function answering(status: number, body: unknown, headers: Record<string, string> = {}) {
  return createRelayClient({
    baseUrl: "https://relay.test",
    session: () => "session",
    fetchFn: (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      })) as unknown as typeof fetch,
  });
}

async function refusal(status: number, body: unknown, headers: Record<string, string> = {}): Promise<RelayError> {
  const error = await answering(status, body, headers)
    .putBlob("bookfile:b1", new Uint8Array(4))
    .then(
      () => null,
      (thrown: unknown) => thrown,
    );
  expect(error).toBeInstanceOf(RelayError);
  return error as RelayError;
}

describe("relay error bodies", () => {
  test("a coded quota refusal carries the app's quota code", async () => {
    const error = await refusal(413, {
      error: "account blob quota exceeded",
      code: "relay/blob-quota-exceeded",
    });
    expect(error.status).toBe(413);
    expect(error.relayCode).toBe("relay/blob-quota-exceeded");
    expect(errorCode(error)).toBe(ERR_SYNC_QUOTA);
    expect(error.message).toBe("relay 413: account blob quota exceeded");
  });

  test("per-file and per-part size refusals read as file-too-large", async () => {
    for (const code of ["relay/blob-too-large", "relay/blob-part-too-large"]) {
      expect(errorCode(await refusal(413, { error: "too big", code }))).toBe(ERR_SYNC_FILE_TOO_LARGE);
    }
  });

  test("an uncoded body (an older relay) or an unknown code sets no code", async () => {
    const old = await refusal(413, { error: "account blob quota exceeded" });
    expect(old.relayCode).toBeUndefined();
    expect(errorCode(old)).toBeUndefined();
    const newer = await refusal(413, { error: "x", code: "relay/some-future-limit" });
    expect(newer.relayCode).toBeUndefined();
    expect(errorCode(newer)).toBeUndefined();
  });

  test("a relay code without app meaning keeps only its status", async () => {
    const error = await refusal(429, { error: "slow down", code: "relay/rate-limited" });
    expect(error.relayCode).toBe("relay/rate-limited");
    expect(errorCode(error)).toBeUndefined();
    expect(error.retryAfterMs).toBeNull();
  });

  test("a Retry-After in seconds rides on the error for the scheduler", async () => {
    const error = await refusal(429, { error: "slow down", code: "relay/rate-limited" }, { "retry-after": "60" });
    expect(error.retryAfterMs).toBe(60_000);
    // The HTTP-date form is not one the relay sends; it is ignored, not misread.
    const dated = await refusal(429, { error: "x" }, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" });
    expect(dated.retryAfterMs).toBeNull();
  });
});

describe("classifySyncError on relay 413s", () => {
  test("quota codes read as quota; size-limit codes do not", () => {
    expect(classifySyncError(new RelayError(413, "full", "relay/event-quota-exceeded"))).toBe(ERR_SYNC_QUOTA);
    expect(classifySyncError(new RelayError(413, "big", "relay/batch-too-large"))).toBeNull();
    expect(classifySyncError(new RelayError(413, "big", "relay/event-too-large"))).toBeNull();
  });

  test("an uncoded 413 from an older relay still reads as quota", () => {
    expect(classifySyncError(new RelayError(413, "account event quota exceeded"))).toBe(ERR_SYNC_QUOTA);
  });
});
