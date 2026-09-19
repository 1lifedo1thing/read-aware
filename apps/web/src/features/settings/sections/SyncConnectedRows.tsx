/**
 * Rows every connected sync backend shows, as pure presentation shared by the
 * relay's Data & Sync group (`SyncAccountGroupView`) and a plugin transport's
 * own settings page (`TransportSyncGroupView`): the Status row with its
 * "sync now" control, the per-book upload backlog, and the disconnect
 * confirmation. Account, plan and billing are relay-only and stay out.
 */
import type { ReactNode } from "react";
import { Button, Dialog } from "@read-aware/ui";
import { ERR_SYNC_FILE_TOO_LARGE, ERR_SYNC_QUOTA } from "@read-aware/core";
import { useTranslation, describeErrorCode } from "../../../i18n";
import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";
import { SettingsRow } from "../components/SettingsRow";
import { syncCycleFraction } from "../../sync/lib/sync-progress";
import type { SyncBacklog, SyncBookBacklogRow } from "../../sync/hooks/useSyncStatus";

/** "12 345 678" bytes → "11.8 MB": one decimal, sensible unit. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes;
  let unit: (typeof units)[number] = "KB";
  for (const next of units) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

/** The engine stores a stable code in `lastError` (classifyBlobRejection);
 *  rows written before that carry the relay's raw wording, mapped here once. */
export function rejectionCode(row: SyncBookBacklogRow): string | null {
  const raw = row.lastError ?? "";
  if (/^[a-z-]+\/[a-z-]+$/.test(raw)) return raw;
  if (raw.includes("quota")) return ERR_SYNC_QUOTA;
  if (raw.includes("exceeds")) return ERR_SYNC_FILE_TOO_LARGE;
  return null;
}

const isQuotaRejection = (row: SyncBookBacklogRow) =>
  row.pushState === "rejected" && rejectionCode(row) === ERR_SYNC_QUOTA;

type SyncStatusRowProps = {
  status: SyncStatusSnapshot;
  backlog: SyncBacklog | null;
  /** Title of the book whose blob is moving right now, if any. */
  movingBookTitle: string | null;
  /** Appended after the idle line — a transport says its cadence is manual. */
  hint?: string;
  /** Replaces the sync-now control; a rejected relay session offers re-login. */
  control?: ReactNode;
  onSyncNow: () => void;
};

/** The Status row's one-line description speaks with exactly one voice at a
 *  time — a rejected session and a failed cycle use the warning tone. */
export function SyncStatusRow({
  status,
  backlog,
  movingBookTitle,
  hint,
  control,
  onSyncNow,
}: SyncStatusRowProps) {
  const { t } = useTranslation("settings");
  const syncing = status.state === "syncing";
  const fraction = syncCycleFraction(status);
  const pending = backlog !== null && backlog.events + backlog.blobs > 0 ? backlog : null;
  const description =
    status.state === "unauthenticated" ? (
      <span className="text-red-700">{t("dataSync.syncStatus.signedOut")}</span>
    ) : status.state === "error" ? (
      <span className="text-red-700">
        {describeErrorCode(status.lastErrorCode ?? undefined)?.body ?? t("dataSync.syncStatus.error")}
      </span>
    ) : syncing ? (
      [
        fraction === null
          ? t("dataSync.syncStatus.syncing")
          : `${t("dataSync.syncStatus.syncing")} ${Math.round(fraction * 100)}%`,
        // Which book is moving right now, with part progress for chunked files.
        movingBookTitle &&
          status.progress &&
          (status.progress.blobPartsTotal > 0
            ? t(
                status.progress.blobDirection === "down"
                  ? "dataSync.progress.bookDownParts"
                  : "dataSync.progress.bookUpParts",
                {
                  title: movingBookTitle,
                  done: status.progress.blobPartsDone,
                  total: status.progress.blobPartsTotal,
                },
              )
            : t(
                status.progress.blobDirection === "down"
                  ? "dataSync.progress.bookDown"
                  : "dataSync.progress.bookUp",
                { title: movingBookTitle },
              )),
      ]
        .filter(Boolean)
        .join(" · ")
    ) : (
      [
        status.lastSyncAt
          ? t("dataSync.syncStatus.lastSync", {
              time: new Date(status.lastSyncAt).toLocaleTimeString(),
            })
          : t("dataSync.syncStatus.never"),
        pending &&
          t("dataSync.progress.pending", { events: pending.events, blobs: pending.blobs }),
        hint,
      ]
        .filter(Boolean)
        .join(" · ")
    );

  return (
    <SettingsRow
      title={t("dataSync.connected.statusTitle")}
      description={description}
      control={
        control ?? (
          <Button size="sm" variant="outline" disabled={syncing} onClick={onSyncNow}>
            {syncing ? t("dataSync.syncStatus.syncing") : t("dataSync.connected.syncNow")}
          </Button>
        )
      }
    />
  );
}

type SyncBookBacklogRowsProps = {
  bookBacklog: SyncBookBacklogRow[] | null;
  /** The relay's account quota is exhausted; a transport has no quota. */
  overLimit?: boolean;
};

/** Per-book upload backlog: which files the remote doesn't hold yet and why.
 *  Renders nothing when every book's file made it — the panel says nothing
 *  when there is nothing to say. */
export function SyncBookBacklogRows({ bookBacklog, overLimit = false }: SyncBookBacklogRowsProps) {
  const { t } = useTranslation("settings");
  if (bookBacklog === null) return null;
  const quotaBlocked = bookBacklog.some(isQuotaRejection);
  if (!quotaBlocked && !overLimit && bookBacklog.length === 0) return null;

  const stateLabel = (row: SyncBookBacklogRow): { text: string; tone?: "error" } => {
    if (!row.localBytes) return { text: t("dataSync.books.awaitingOtherDevice") };
    if (row.pushState === "pending") return { text: t("dataSync.books.pending") };
    if (row.pushState === "unverified") return { text: t("dataSync.books.unverified") };
    if (row.pushState === "failed") return { text: t("dataSync.books.failed") };
    const code = rejectionCode(row);
    if (code === ERR_SYNC_QUOTA) {
      return { text: t("dataSync.books.rejectedQuota"), tone: "error" };
    }
    if (code === ERR_SYNC_FILE_TOO_LARGE) {
      return { text: t("dataSync.books.rejectedTooLarge"), tone: "error" };
    }
    return { text: t("dataSync.books.rejected"), tone: "error" };
  };

  return (
    <SettingsRow
      title={t("dataSync.books.title")}
      description={
        <span className="block space-y-1.5">
          {(quotaBlocked || overLimit) && (
            <span className="block text-red-700">{t("dataSync.books.quotaFull")}</span>
          )}
          {bookBacklog.map((row) => {
            const state = stateLabel(row);
            return (
              <span key={row.bookId} className="block">
                <span className="text-fg">{row.title}</span>
                {row.byteSize != null && ` · ${formatBytes(row.byteSize)}`}
                {" · "}
                <span className={state.tone === "error" ? "text-red-700" : undefined}>
                  {state.text}
                </span>
              </span>
            );
          })}
        </span>
      }
    />
  );
}

type SyncDisconnectDialogProps = {
  open: boolean;
  /** Locks the confirmation while a connection operation is running. */
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function SyncDisconnectDialog({ open, busy, onClose, onConfirm }: SyncDisconnectDialogProps) {
  const { t } = useTranslation("settings");
  return (
    <Dialog open={open} onClose={onClose} title={t("dataSync.connected.disconnectTitle")}>
      <div className="space-y-4">
        <p>{t("dataSync.connected.disconnectBody")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t("dataSync.connected.cancel")}
          </Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={onConfirm}>
            {t("dataSync.connected.disconnect")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
