import type { ReaderLoadError } from "../hooks/useReaderSession";

/** Retry only transient failures. Authentication and decryption need a settings
 * change; missing source bytes need an import, not an endless retry loop. */
export function readerRecoveryAction(error: ReaderLoadError): "retry" | "import" | "settings" | null {
  if (error.kind === "generic") return error.retryable ? "retry" : null;
  switch (error.reason) {
    case "unreachable": return "retry";
    case "no-sync":
    case "not-on-relay": return "import";
    case "unauthenticated":
    case "undecodable": return "settings";
  }
}
