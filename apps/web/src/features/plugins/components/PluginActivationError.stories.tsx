import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AppError, ERR_PLUGIN_APP_UPDATE_REQUIRED, ERR_PLUGIN_UPDATE_REQUIRED } from "@read-aware/core";
import { PluginActivationError } from "./PluginActivationError";

const meta = {
  title: "Interface/Plugins/PluginActivationError",
  component: PluginActivationError,
  decorators: [
    (Story) => (
      <div className="max-w-md p-4">
        <Story />
      </div>
    ),
  ],
  args: { onCheckAppUpdate: fn() },
} satisfies Meta<typeof PluginActivationError>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Built for older host contracts, with a newer marketplace release to install. */
export const UpdateAvailable: Story = {
  args: {
    error: new AppError(ERR_PLUGIN_UPDATE_REQUIRED, "requires services.storage ^1.0.0, but the host provides 2.6.0"),
    update: { version: "1.1.0", busy: false, onUpdate: fn() },
  },
};

/** The update is downloading or waiting on consent. */
export const Updating: Story = {
  args: { ...UpdateAvailable.args, update: { version: "1.1.0", busy: true, onUpdate: fn() } },
};

/** Outdated, but the marketplace has nothing newer (or could not be reached). */
export const UpdateRequiredWithoutRelease: Story = {
  args: { error: UpdateAvailable.args.error },
};

/** The plugin targets a newer ReadAware. */
export const AppUpdateRequired: Story = {
  args: { error: new AppError(ERR_PLUGIN_APP_UPDATE_REQUIRED, "requires app version 0.9.0 or newer") },
};

/** Any other failure: start-up errors and runtime crashes share one line. */
export const Unclassified: Story = {
  args: { error: new Error("activate() threw: Cannot read properties of undefined") },
};
