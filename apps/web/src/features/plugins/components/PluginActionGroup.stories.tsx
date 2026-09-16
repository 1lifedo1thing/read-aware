import type { Meta, StoryObj } from "@storybook/react-vite";
import { PluginActionGroup } from "./PluginActionGroup";
import { destructiveActions, noopRunner, sampleActions } from "./plugin.fixtures";

/**
 * Host-rendered buttons for actions a plugin declares. The plugin picks a
 * label, an icon name and a semantic variant; everything else — sizing,
 * spacing, the disabled-while-busy rule — belongs to the host.
 */
const meta = {
  title: "Interface/Plugins/PluginActionGroup",
  component: PluginActionGroup,
  parameters: { layout: "padded" },
  args: { actions: sampleActions, busy: false, onResult: noopRunner },
} satisfies Meta<typeof PluginActionGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default: buttons, left-aligned, each variant as the plugin declared it. */
export const Buttons: Story = {};

/** Aligned to the end, as detail views place their action row. */
export const AlignedEnd: Story = {
  args: { align: "end" },
};

/**
 * Toolbar display, used for view-level action rows: a short set stays inline
 * as labeled buttons, so three actions look the same as the buttons display.
 */
export const ToolbarShort: Story = {
  args: { display: "toolbar", align: "end" },
};

/**
 * A long unprioritized set: the host keeps the first two inline and folds the
 * rest behind one "More" menu instead of rendering a strip of icon buttons.
 */
export const ToolbarOverflow: Story = {
  args: {
    display: "toolbar",
    align: "end",
    actions: Array.from({ length: 7 }, (_, i) => ({
      id: `a${i}`,
      label: ["Refresh", "Saved covers", "Import book", "Browse folder", "Duplicates", "Collections", "Cleanup"][i]!,
      icon: ["arrows-clockwise", "image", "plus", "folder", "books", "folder", "trash"][i],
      run: () => undefined,
    })),
  },
};

/** Explicit priorities: primary stays inline wherever declared, secondary always folds. */
export const ToolbarPrioritized: Story = {
  args: {
    display: "toolbar",
    align: "end",
    actions: [
      { id: "refresh", label: "Refresh", icon: "arrows-clockwise", priority: "secondary", run: () => undefined },
      { id: "filter", label: "Filter", icon: "magnifying-glass", run: () => undefined },
      { id: "new", label: "New note", icon: "note-pencil", variant: "solid", priority: "primary", run: () => undefined },
      { id: "export", label: "Export", icon: "export", run: () => undefined },
      { id: "delete", label: "Delete all", icon: "trash", variant: "danger", priority: "secondary", run: () => undefined },
    ],
  },
};

/** A danger variant is the strongest emphasis a plugin can ask for. */
export const WithDangerAction: Story = {
  args: { actions: destructiveActions },
};

/** While a result is running every action is disabled, not hidden. */
export const Busy: Story = {
  args: { busy: true },
};

/** Actions may omit an icon entirely — the button is then text-only. */
export const WithoutIcons: Story = {
  args: {
    actions: [
      { id: "apply", label: "Apply", variant: "solid", run: () => undefined },
      { id: "reset", label: "Reset", run: () => undefined },
    ],
  },
};

/** An unknown icon name falls back to the puzzle piece rather than vanishing. */
export const UnknownIconName: Story = {
  args: {
    actions: [
      { id: "x", label: "Custom action", icon: "not-a-real-icon", run: () => undefined },
    ],
  },
};

/** Many actions wrap onto a second line instead of overflowing the surface. */
export const Wrapping: Story = {
  args: {
    actions: Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`,
      label: `Action number ${i + 1}`,
      icon: "sparkle",
      run: () => undefined,
    })),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/** Nothing declared: the group renders nothing rather than an empty bar. */
export const NoActions: Story = {
  args: { actions: [] },
};
