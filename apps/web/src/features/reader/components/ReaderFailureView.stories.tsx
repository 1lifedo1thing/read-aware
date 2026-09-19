import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReaderFailureView } from "./ReaderFailureView";

const meta = {
  title: "Interface/Reader/ReaderFailureView",
  component: ReaderFailureView,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Could not open this book",
    bookTitle: "Refactoring: Improving the Design of Existing Code",
    message: "This book’s file is missing from this device, and the sync service could not be reached. Check your connection and try again, or import the original file from the library.",
    action: { label: "Try again", onClick: () => {} },
    onBack: () => {},
  },
  decorators: [Story => <div className="relative min-h-screen" style={{ background: "#f5f1e8" }}><Story /></div>],
} satisfies Meta<typeof ReaderFailureView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Reproduces dark app controls against a separately configured warm page. */
export const DarkAppWarmPage: Story = { globals: { theme: "dark" } };
export const LightApp: Story = { globals: { theme: "light" } };
export const UnreadableFile: Story = { args: { message: "This file format is not supported.", action: undefined } };
export const NavigationFailure: Story = { args: {
  title: "Could not go to that location", message: "That location could not be found in this book.",
  action: { label: "Continue reading", onClick: () => {} },
} };
