import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SyncProfile } from "../../../platform/sync/sync-store";
import type { RegisteredSyncTransport } from "../../../platform/sync/transport-registry";
import { backlog, failed, idle, uploadingBook } from "../../sync/components/sync.fixtures";
import type { SyncBookBacklogRow } from "../../sync/hooks/useSyncStatus";
import type { useSyncConnection } from "../hooks/useSyncConnection";
import { TransportSyncGroupView } from "./TransportSyncGroupView";

const MB = 1024 * 1024;

const webdavTransport: RegisteredSyncTransport = {
  ref: "plugin:webdav-sync:webdav",
  pluginId: "webdav-sync",
  transportId: "webdav",
  generation: 0,
  label: "WebDAV",
  open: () => Promise.reject(new Error("storybook stand-in")),
};

const endpointId = "reader@dav.example.com/ReadAware";

const profile: SyncProfile = {
  syncEnabled: true,
  remoteAccountId: `transport:webdav-sync:webdav:${endpointId}`,
  encryptionKeyRef: "key_local",
  lastPushAt: "2026-06-28T20:14:00.000Z",
  lastPullAt: "2026-06-28T20:14:00.000Z",
};

/** Inert stand-in for the live connection hook; the dialogs never run here. */
const inertSync = {
  status: idle,
  profile,
  connected: true,
  connectedTransport: { ref: webdavTransport.ref, endpointId },
  transports: [webdavTransport],
  busy: false,
  probeTransport: async () => ({ hasKeys: false }),
  connectTransport: async () => {},
  disconnect: async () => {},
  requestSyncNow: async () => {},
} as unknown as ReturnType<typeof useSyncConnection>;

const pendingBook: SyncBookBacklogRow = {
  bookId: "book-1",
  title: "The Left Hand of Darkness",
  byteSize: 18 * MB,
  pushState: "pending",
  lastError: null,
  localBytes: true,
};

/**
 * The Sync group on a `sync:transport` plugin's own settings page (WebDAV
 * Sync, …): the plugin's transports to connect, or — connected through one —
 * backend, status with the manual-cadence reminder, backlog and encryption.
 * Everything comes from the scheduler singleton and Tauri IPC, so the
 * container passes it in and these stories write it out.
 */
const meta = {
  title: "Interface/Settings/TransportSyncGroup",
  component: TransportSyncGroupView,
  parameters: { layout: "padded" },
  args: {
    transports: [webdavTransport],
    status: idle,
    backlog: null,
    bookBacklog: [],
    movingBookTitle: null,
    connectRef: null,
    onConnectRefChange: () => {},
    disconnectOpen: false,
    onDisconnectOpenChange: () => {},
    working: false,
    onSyncNow: () => {},
    onDisconnect: () => {},
    onOpenDataSync: () => {},
    sync: inertSync,
  },
} satisfies Meta<typeof TransportSyncGroupView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Connected through this plugin's transport, nothing pending. */
export const Connected: Story = {};

/** Not connected: one row per registered transport with its Connect button. */
export const Disconnected: Story = {
  args: {
    sync: { ...inertSync, connected: false, connectedTransport: null, profile: null },
  },
};

/** Mid-cycle, with the book that is moving right now. */
export const Syncing: Story = {
  args: { status: uploadingBook, movingBookTitle: pendingBook.title, backlog },
};

/** The last requested cycle failed; the row speaks in the warning tone. */
export const Failed: Story = {
  args: { status: failed },
};

/** Files the server does not hold yet, listed under the status. */
export const WithBacklog: Story = {
  args: { bookBacklog: [pendingBook, { ...pendingBook, bookId: "book-2", title: "Kindred", pushState: "failed" }] },
};

/** Sync is bound to the relay (or another plugin): this page only points away. */
export const ConnectedElsewhere: Story = {
  args: {
    sync: {
      ...inertSync,
      connectedTransport: null,
      profile: { ...profile, remoteAccountId: "acct_9f4c2b7ae1d0" },
    },
  },
};

/** The disconnect confirmation, as the Backend row opens it. */
export const DisconnectDialogOpen: Story = {
  args: { disconnectOpen: true },
};
