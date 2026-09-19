/**
 * The plugin-page counterpart of `useSyncAccountFlows`: owns the connect and
 * disconnect dialogs for ONE plugin's `sync:transport` contributions and
 * binds them to the shared host flow controller while the page is mounted.
 *
 * `syncFlowSection` navigates a transport request to this page, so when it
 * arrives here the request is ours by construction; anything else (relay
 * sign-in, billing, a disconnect of a different backend) is refused with a
 * stable code rather than silently handled on the wrong surface.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { AppError, type HostSyncFlow, type HostSyncFlowRequest } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { describeError, useTranslation } from "../../../i18n";
import type { DomainActor } from "../../../platform/domain-actor";
import { createLogger } from "../../../platform/logger";
import { getSyncConnectionBusy } from "../../../platform/sync/connection-operation";
import { getSyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";
import type { RegisteredSyncTransport } from "../../../platform/sync/transport-registry";
import { syncFlowConditions } from "../../../services/sync-flow-conditions";
import { hostSyncFlows } from "../../../services/sync";
import type { useSyncConnection } from "./useSyncConnection";

const log = createLogger("sync");

export function useTransportSyncFlows(
  sync: ReturnType<typeof useSyncConnection>,
  /** The transports this page owns — the plugin's own registrations. */
  transports: readonly RegisteredSyncTransport[],
) {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  /** Registry ref of the transport whose connect dialog is open; null = none. */
  const [connectRef, setConnectRef] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const owns = (ref: string | null | undefined) => !!ref && transports.some((item) => item.ref === ref);
  const close = () => {
    setConnectRef(null);
    setDisconnectOpen(false);
  };
  const failure = (error: unknown) => {
    log.error("sync transport action failed", error);
    toast({
      variant: "destructive",
      title: t("dataSync.noticeError"),
      description: describeError(error, { fallback: t("dataSync.connect.failed") }).body,
    });
  };
  const perform = async (
    action: HostSyncFlow,
    operation: (signal?: AbortSignal, origin?: DomainActor) => Promise<unknown>,
  ) => {
    setWorking(true);
    try {
      await hostSyncFlows.run(action, operation, false);
      close();
    } catch (error) {
      failure(error);
    } finally {
      setWorking(false);
    }
  };

  const latest = useRef({ open: (_request: HostSyncFlowRequest) => {}, close });
  latest.current = {
    close,
    open: (request) => {
      if (working || getSyncConnectionBusy() || connectRef || disconnectOpen) {
        throw new AppError("ui/unavailable", "A native sync dialog is already active");
      }
      const status = getSyncStatusSnapshot();
      const blocked = syncFlowConditions(request, status, getSyncConnectionBusy(), sync.transports, false)
        .find((value) => value.state === "unavailable");
      if (blocked) {
        throw new AppError(
          blocked.errorCode === "sync/transport-unavailable" ? "sync/transport-unavailable" : "ui/unavailable",
          blocked.reason,
        );
      }
      if (request.action === "connect") {
        if (!owns(request.transportRef)) {
          throw new AppError("ui/unavailable", "This settings page owns no such sync transport");
        }
        setConnectRef(request.transportRef!);
      } else if (request.action === "disconnect") {
        if (status.backend !== "transport" || !owns(status.transportRef)) {
          throw new AppError("ui/unavailable", "The connected sync backend is not this plugin's transport");
        }
        setDisconnectOpen(true);
      } else {
        throw new AppError("ui/unavailable", "Relay account flows live in Data & Sync");
      }
    },
  };
  useLayoutEffect(
    () =>
      hostSyncFlows.bind({
        open: (request) => latest.current.open(request),
        close: () => latest.current.close(),
      }),
    [],
  );

  return {
    connectRef,
    setConnectRef: (ref: string | null) => {
      if (working || getSyncConnectionBusy()) return;
      if (ref === null) hostSyncFlows.dismiss("connect");
      setConnectRef(ref);
    },
    disconnectOpen,
    setDisconnectOpen: (open: boolean) => {
      if (working || getSyncConnectionBusy()) return;
      if (!open) hostSyncFlows.dismiss("disconnect");
      setDisconnectOpen(open);
    },
    working,
    disconnect: () => perform("disconnect", (_signal, origin) => sync.disconnect(origin)),
    sync: {
      ...sync,
      connectTransport: (...args: Parameters<typeof sync.connectTransport>) =>
        hostSyncFlows.run("connect", (_signal, origin) => sync.connectTransport(args[0], args[1], origin), true),
    },
  };
}
