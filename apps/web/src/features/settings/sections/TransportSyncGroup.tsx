/**
 * Container for a plugin's sync group: the live connection, the outbox
 * backlogs and the host flow binding for THIS plugin's transports. Rendered
 * by `PluginSettingsSectionPanel` under the plugin's declared settings, and
 * only when the plugin has registered a `sync:transport`. The rows are
 * `TransportSyncGroupView`.
 */
import { useSetAtom } from "jotai";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { settingsSectionRequestAtom } from "../../../state/ui";
import { useBlobBookTitle } from "../../sync/hooks/useBlobBookTitle";
import { useSyncBacklog, useSyncBookBacklog } from "../../sync/hooks/useSyncStatus";
import { useSyncConnection } from "../hooks/useSyncConnection";
import { useTransportSyncFlows } from "../hooks/useTransportSyncFlows";
import { TransportSyncGroupView } from "./TransportSyncGroupView";

const log = createLogger("sync");

export function TransportSyncGroup({ pluginId }: { pluginId: string }) {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const sync = useSyncConnection();
  const setSectionRequest = useSetAtom(settingsSectionRequestAtom);
  const transports = sync.transports.filter((transport) => transport.pluginId === pluginId);
  const flows = useTransportSyncFlows(sync, transports);
  const connectedHere = sync.connectedTransport !== null
    && transports.some((transport) => transport.ref === sync.connectedTransport!.ref);
  const backlog = useSyncBacklog(connectedHere);
  const bookBacklog = useSyncBookBacklog(connectedHere);
  const movingBookTitle = useBlobBookTitle(
    sync.status.state === "syncing" ? (sync.status.progress?.blobKey ?? null) : null,
  );

  const handleSyncNow = async () => {
    try {
      await sync.requestSyncNow();
    } catch (error) {
      log.error("manual sync failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.syncStatus.error"),
      });
    }
  };

  return (
    <TransportSyncGroupView
      transports={transports}
      status={sync.status}
      backlog={backlog}
      bookBacklog={bookBacklog}
      movingBookTitle={movingBookTitle}
      connectRef={flows.connectRef}
      onConnectRefChange={flows.setConnectRef}
      disconnectOpen={flows.disconnectOpen}
      onDisconnectOpenChange={flows.setDisconnectOpen}
      working={flows.working}
      onSyncNow={() => void handleSyncNow()}
      onDisconnect={() => void flows.disconnect()}
      onOpenDataSync={() => setSectionRequest("dataSync")}
      sync={flows.sync}
    />
  );
}
