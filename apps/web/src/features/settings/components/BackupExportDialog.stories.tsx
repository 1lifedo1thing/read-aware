import type { Meta, StoryObj } from "@storybook/react-vite";
import { BackupExportDialog } from "./BackupExportDialog";

const meta = {
  title: "Interface/Settings/Backup export",
  component: BackupExportDialog,
  args: { flow: { view: null, edit: () => {}, submit: async () => {}, cancel: () => {} } },
} satisfies Meta<typeof BackupExportDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Password: Story = {
  args: { flow: { ...meta.args.flow, view: { step: "form", form: {
    format: "full", password: "", confirmation: "", passwordError: false, confirmationError: false,
  } } } },
};
export const Capturing: Story = {
  args: { flow: { ...meta.args.flow, view: { step: "running", format: "full", cancelling: false,
    progress: { phase: "database", remainingPages: 25, totalPages: 100 } } } },
};
export const Cancelling: Story = {
  args: { flow: { ...meta.args.flow, view: { step: "running", format: "full", cancelling: true, progress: { phase: "encrypting" } } } },
};
