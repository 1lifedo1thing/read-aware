/**
 * The Sync group of the Data & Sync panel, as pure presentation.
 *
 * Disconnected it is one quiet row with a "Connect account" button — the whole
 * sign-in flow lives in SyncConnectDialog. Connected it follows the panel's row
 * grammar, one concern per row with its own control: Account (identity /
 * disconnect), Status (last sync / sync now, or the re-login), Plan (tier +
 * usage / upgrade or manage). The icon-strip detail stays in the header
 * popover.
 *
 * Plugin transports (`sync:transport`, e.g. WebDAV) are NOT configured here:
 * their connect, status and disconnect live on the plugin's own settings page
 * (`TransportSyncGroup`). Connected through one, this group shows a single
 * pointer row to that page — and only when the plugin is gone (disabled,
 * uninstalled) does the row offer the disconnect itself, since a dead binding
 * has nowhere else to be torn down.
 *
 * Split from `SyncAccountGroup` because every interesting state here comes from
 * somewhere Storybook cannot reach — a module-level scheduler singleton, the
 * relay, and Tauri IPC. With the data as props, the connected, syncing,
 * rejected, over-quota and rejected-upload states can each be rendered and
 * reviewed on their own.
 */
import { Button, Dialog } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { SyncProfile } from "../../../platform/sync/sync-store";
import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";
import { PendingBadge } from "../components/PendingBadge";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import type { SyncBacklog, SyncBookBacklogRow } from "../../sync/hooks/useSyncStatus";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import type { SyncAccountInfo } from "../hooks/useSyncAccountInfo";
import type { useSyncConnection } from "../hooks/useSyncConnection";
import { SyncConnectDialog } from "./SyncConnectDialog";
import {
  formatBytes,
  SyncBookBacklogRows,
  SyncDisconnectDialog,
  SyncStatusRow,
} from "./SyncConnectedRows";

export { formatBytes };

type SyncAccountGroupViewProps = {
  /** The web shell has no store and no sync — it keeps the placeholder row. */
  supported: boolean;
  connected: boolean;
  status: SyncStatusSnapshot;
  profile: SyncProfile | null;
  /** Fetched from the relay, so quietly absent while offline. */
  accountInfo: SyncAccountInfo | null;
  backlog: SyncBacklog | null;
  bookBacklog: SyncBookBacklogRow[] | null;
  /** Title of the book whose blob is moving right now, if any. */
  movingBookTitle: string | null;
  connectOpen: boolean;
  onConnectOpenChange: (open: boolean) => void;
  disconnectOpen: boolean;
  onDisconnectOpenChange: (open: boolean) => void;
  /**
   * Account deletion (Apple guideline 5.1.1(v): in-app account creation
   * demands in-app deletion). The control is hidden for plugin-transport
   * connections — a WebDAV remote has no relay account to delete.
   */
  deleteAccountOpen: boolean;
  onDeleteAccountOpenChange: (open: boolean) => void;
  /** Locks destructive confirmation while an account action is running. */
  deletingAccount: boolean;
  onDeleteAccount: () => void;
  onSyncNow: () => void;
  onDisconnect: () => void;
  /** Jump to the connected transport's plugin settings page. */
  onOpenTransportSettings: (pluginId: string) => void;
  /**
   * Whether external purchase links may be shown at all — false on iOS
   * storefronts where Apple forbids them (platform/purchase-gate). False
   * hides BOTH plan controls; sync itself is untouched.
   */
  purchaseAllowed: boolean;
  onOpenPortal: () => void;
  onOpenUpgrade: () => void;
  /** Handed straight to the connect dialog, which drives the sign-in flow. */
  sync: ReturnType<typeof useSyncConnection>;
};

export function SyncAccountGroupView({
  supported,
  connected,
  status,
  profile,
  accountInfo,
  backlog,
  bookBacklog,
  movingBookTitle,
  connectOpen,
  onConnectOpenChange,
  disconnectOpen,
  onDisconnectOpenChange,
  deleteAccountOpen,
  onDeleteAccountOpenChange,
  deletingAccount,
  onDeleteAccount,
  onSyncNow,
  onDisconnect,
  onOpenTransportSettings,
  purchaseAllowed,
  onOpenPortal,
  onOpenUpgrade,
  sync,
}: SyncAccountGroupViewProps) {
  const { t } = useTranslation("settings");
  const sessionRejected = status.state === "unauthenticated";

  if (!supported) {
    return (
      <SettingsGroup
        title={t("dataSync.sync")}
        aside={<PendingBadge>{t("dataSync.desktopBadge")}</PendingBadge>}
      >
        <SettingsRow
          borderless
          title={t("dataSync.account.title")}
          description={t("dataSync.account.description")}
        />
      </SettingsGroup>
    );
  }

  if (!connected) {
    return (
      <SettingsGroup title={t("dataSync.sync")}>
        <SettingsRow
          borderless
          title={t("dataSync.account.title")}
          description={t("dataSync.account.description")}
          control={
            <Button size="sm" onClick={() => onConnectOpenChange(true)}>
              {t("dataSync.connectAccount")}
            </Button>
          }
        />
        <SyncConnectDialog
          open={connectOpen}
          onClose={() => onConnectOpenChange(false)}
          sync={sync}
        />
      </SettingsGroup>
    );
  }

  // Connected through a plugin transport: the backend's label is the human
  // name of the remote. The registered transport may be absent while its
  // plugin restarts or after it was disabled — the ref keeps the row honest,
  // and without a plugin page to send the user to, disconnect stays here.
  const viaTransport = sync.connectedTransport;
  if (viaTransport) {
    const transportEntry = sync.transports.find((entry) => entry.ref === viaTransport.ref) ?? null;
    const pluginId = viaTransport.ref.split(":")[1] ?? viaTransport.ref;
    return (
      <SettingsGroup title={t("dataSync.sync")}>
        <SettingsRow
          borderless
          title={t("dataSync.transport.backendTitle")}
          description={
            transportEntry
              ? t("dataSync.transport.connectedVia", {
                  label: contributionText(transportEntry.label),
                  plugin: pluginId,
                })
              : t("dataSync.transport.pluginUnavailable", { plugin: pluginId })
          }
          control={
            transportEntry ? (
              <Button size="sm" variant="outline" onClick={() => onOpenTransportSettings(pluginId)}>
                {t("dataSync.transport.openPluginSettings")}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => onDisconnectOpenChange(true)}>
                {t("dataSync.connected.disconnect")}
              </Button>
            )
          }
        />
        <SyncDisconnectDialog
          open={disconnectOpen}
          busy={sync.busy || deletingAccount}
          onClose={() => onDisconnectOpenChange(false)}
          onConfirm={onDisconnect}
        />
      </SettingsGroup>
    );
  }

  // The email is the human name of the account; the opaque id only appears
  // while the relay hasn't answered yet (offline), shortened to stay legible.
  const accountLabel = accountInfo?.email ?? `${(profile?.remoteAccountId ?? "").slice(0, 8)}…`;

  // A currently-paying account manages its plan in Stripe's portal. Free
  // accounts get the upgrade menu even when a past customer exists (checkout
  // reuses it — after a cancellation the portal has nothing left to manage).
  // A paid tier WITHOUT billing was granted by the operator; staff plans are
  // never sold, so staff sees no control at all. When external purchase
  // links are forbidden entirely (non-US iOS storefronts), the plan row
  // keeps its facts but loses both controls.
  const planControl =
    purchaseAllowed && accountInfo && accountInfo.tier !== "staff" ? (
      accountInfo.tier !== "free" ? (
        accountInfo.hasBilling ? (
          <Button size="sm" variant="outline" onClick={onOpenPortal}>
            {t("dataSync.billing.manage")}
          </Button>
        ) : null
      ) : (
        // Plans are compared and bought on the landing's pricing page — the
        // app doesn't reprint the catalog, it opens the one source of it.
        <Button size="sm" variant="outline" onClick={onOpenUpgrade}>
          {t("dataSync.billing.upgrade")}
        </Button>
      )
    ) : null;

  const overLimit =
    accountInfo?.limits?.maxAccountBlobBytes != null &&
    accountInfo.blobBytesUsed > accountInfo.limits.maxAccountBlobBytes;

  return (
    <SettingsGroup title={t("dataSync.sync")}>
      <SettingsRow
        borderless
        title={t("dataSync.account.title")}
        description={accountLabel}
        control={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => onDisconnectOpenChange(true)}>
              {t("dataSync.connected.disconnect")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-700 hover:text-red-800"
              onClick={() => onDeleteAccountOpenChange(true)}
            >
              {t("dataSync.deleteAccount.action")}
            </Button>
          </div>
        }
      />
      <SyncStatusRow
        status={status}
        backlog={backlog}
        movingBookTitle={movingBookTitle}
        // A rejected session makes "sync now" a guaranteed 401 — its slot
        // offers the re-login (the same connect dialog) instead.
        control={
          sessionRejected ? (
            <Button size="sm" onClick={() => onConnectOpenChange(true)}>
              {t("dataSync.reauth.action")}
            </Button>
          ) : undefined
        }
        onSyncNow={onSyncNow}
      />
      {/* Fetched from the relay, so quietly absent while offline. */}
      {accountInfo && (
        <SettingsRow
          title={t("dataSync.connected.planTitle")}
          description={
            <>
              {t(`dataSync.tier.${accountInfo.tier ?? "free"}`)}
              {" · "}
              <span className={overLimit ? "text-red-700" : undefined}>
                {/* A self-hosted relay predating tiers sends no limits — fall
                    back to the plain usage line rather than "of undefined". */}
                {accountInfo.limits?.maxAccountBlobBytes != null
                  ? t("dataSync.connected.storageUsedOfLimit", {
                      used: formatBytes(accountInfo.blobBytesUsed),
                      limit: formatBytes(accountInfo.limits.maxAccountBlobBytes),
                    })
                  : t("dataSync.connected.storageUsed", {
                      used: formatBytes(accountInfo.blobBytesUsed),
                    })}
              </span>
            </>
          }
          control={planControl}
        />
      )}
      <SyncBookBacklogRows bookBacklog={bookBacklog} overLimit={overLimit} />
      <SettingsRow title={t("dataSync.e2e.title")} description={t("dataSync.e2e.active")} />
      {/* Re-login for a rejected session: the same connect flow, reached from
          the "sign in again" control above (or a deep-linked token). */}
      <SyncConnectDialog
        open={connectOpen}
        onClose={() => onConnectOpenChange(false)}
        sync={sync}
      />
      <SyncDisconnectDialog
        open={disconnectOpen}
        busy={sync.busy || deletingAccount}
        onClose={() => onDisconnectOpenChange(false)}
        onConfirm={onDisconnect}
      />
      <Dialog
        open={deleteAccountOpen}
        onClose={() => {
          if (!deletingAccount) onDeleteAccountOpenChange(false);
        }}
        title={t("dataSync.deleteAccount.title")}
      >
        <div className="space-y-4">
          <p>{t("dataSync.deleteAccount.body")}</p>
          {/* Only paying accounts hear about billing; the relay cancels the
              subscription in the same request. */}
          {accountInfo?.hasBilling && <p>{t("dataSync.deleteAccount.billingNote")}</p>}
          <p>{t("dataSync.deleteAccount.localNote")}</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={deletingAccount}
              onClick={() => onDeleteAccountOpenChange(false)}
            >
              {t("dataSync.connected.cancel")}
            </Button>
            <Button variant="danger" size="sm" disabled={deletingAccount} onClick={onDeleteAccount}>
              {deletingAccount ? t("dataSync.working") : t("dataSync.deleteAccount.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </SettingsGroup>
  );
}
