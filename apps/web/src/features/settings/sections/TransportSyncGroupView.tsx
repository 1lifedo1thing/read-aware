/**
 * The Sync group on a plugin's own settings page, as pure presentation — the
 * whole user-facing surface of a `sync:transport` contribution (WebDAV, …).
 *
 * Three states, one group:
 *  - not connected: one row per transport the plugin registers, each with its
 *    Connect button (the passphrase ritual is `TransportConnectDialog`);
 *  - connected through one of this plugin's transports: Backend / Status /
 *    Books / E2E rows — the same grammar as the relay's group, minus account
 *    and plan, plus the reminder that a transport only syncs on request;
 *  - connected elsewhere (the relay, another plugin): a pointer to Data &
 *    Sync, because one profile holds exactly one sync binding.
 */
import { Button } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";
import type { RegisteredSyncTransport } from "../../../platform/sync/transport-registry";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import type { SyncBacklog, SyncBookBacklogRow } from "../../sync/hooks/useSyncStatus";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import type { useSyncConnection } from "../hooks/useSyncConnection";
import { SyncBookBacklogRows, SyncDisconnectDialog, SyncStatusRow } from "./SyncConnectedRows";
import { TransportConnectDialog } from "./TransportConnectDialog";

type TransportSyncGroupViewProps = {
  /** The plugin's own registrations — what this page may connect. */
  transports: RegisteredSyncTransport[];
  status: SyncStatusSnapshot;
  backlog: SyncBacklog | null;
  bookBacklog: SyncBookBacklogRow[] | null;
  /** Title of the book whose blob is moving right now, if any. */
  movingBookTitle: string | null;
  /** Registry ref of the transport whose connect dialog is open; null = none. */
  connectRef: string | null;
  onConnectRefChange: (ref: string | null) => void;
  disconnectOpen: boolean;
  onDisconnectOpenChange: (open: boolean) => void;
  /** Locks the disconnect confirmation while the teardown runs. */
  working: boolean;
  onSyncNow: () => void;
  onDisconnect: () => void;
  onOpenDataSync: () => void;
  /** Handed to the connect dialog, which drives the passphrase ritual. */
  sync: ReturnType<typeof useSyncConnection>;
};

export function TransportSyncGroupView({
  transports,
  status,
  backlog,
  bookBacklog,
  movingBookTitle,
  connectRef,
  onConnectRefChange,
  disconnectOpen,
  onDisconnectOpenChange,
  working,
  onSyncNow,
  onDisconnect,
  onOpenDataSync,
  sync,
}: TransportSyncGroupViewProps) {
  const { t } = useTranslation("settings");
  const connectedHere = sync.connectedTransport
    ? (transports.find((entry) => entry.ref === sync.connectedTransport!.ref) ?? null)
    : null;

  if (sync.connected && !connectedHere) {
    return (
      <SettingsGroup title={t("dataSync.sync")}>
        <SettingsRow
          borderless
          title={t("dataSync.transport.backendTitle")}
          description={t("dataSync.transport.otherBackend")}
          control={
            <Button size="sm" variant="outline" onClick={onOpenDataSync}>
              {t("dataSync.transport.openDataSync")}
            </Button>
          }
        />
      </SettingsGroup>
    );
  }

  if (!connectedHere) {
    const dialogTransport = transports.find((entry) => entry.ref === connectRef) ?? null;
    return (
      <SettingsGroup title={t("dataSync.sync")}>
        {transports.map((transport, index) => (
          <SettingsRow
            key={transport.ref}
            borderless={index === 0}
            title={contributionText(transport.label)}
            description={t("dataSync.transport.description", { plugin: transport.pluginId })}
            control={
              <Button size="sm" onClick={() => onConnectRefChange(transport.ref)}>
                {t("dataSync.transport.connect")}
              </Button>
            }
          />
        ))}
        <TransportConnectDialog
          transport={dialogTransport}
          onClose={() => onConnectRefChange(null)}
          sync={sync}
        />
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title={t("dataSync.sync")}>
      <SettingsRow
        borderless
        title={t("dataSync.transport.backendTitle")}
        description={`${contributionText(connectedHere.label)} · ${sync.connectedTransport!.endpointId}`}
        control={
          <Button size="sm" variant="ghost" onClick={() => onDisconnectOpenChange(true)}>
            {t("dataSync.connected.disconnect")}
          </Button>
        }
      />
      <SyncStatusRow
        status={status}
        backlog={backlog}
        movingBookTitle={movingBookTitle}
        hint={t("dataSync.transport.manualHint")}
        onSyncNow={onSyncNow}
      />
      <SyncBookBacklogRows bookBacklog={bookBacklog} />
      <SettingsRow title={t("dataSync.e2e.title")} description={t("dataSync.e2e.active")} />
      <SyncDisconnectDialog
        open={disconnectOpen}
        busy={sync.busy || working}
        onClose={() => onDisconnectOpenChange(false)}
        onConfirm={onDisconnect}
      />
    </SettingsGroup>
  );
}
