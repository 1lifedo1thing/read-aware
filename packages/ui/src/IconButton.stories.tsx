import type { Meta, StoryObj } from "@storybook/react-vite";
import { X } from "@phosphor-icons/react";
import { IconButton } from "./IconButton";

const meta = {
  title: "Design System/Components/IconButton",
  component: IconButton,
  argTypes: {
    size: { control: "select", options: ["sm", "md", "toolbar"] },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { icon: <X size={16} weight="regular" />, label: "Close" },
};

export const Small: Story = {
  args: { icon: <X size={16} weight="regular" />, label: "Close", size: "sm" },
};

/** Toolbar slots: each button fills an equal share of a phone bottom toolbar. */
export const ToolbarSlots: Story = {
  args: { icon: <X size={20} weight="regular" />, label: "Close", size: "toolbar" },
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: (args) => (
    <div className="grid w-full max-w-sm grid-cols-5 border-t border-border bg-fill px-1">
      {Array.from({ length: 5 }, (_, i) => <IconButton key={i} {...args} className={i === 1 ? "text-fg" : undefined} />)}
    </div>
  ),
};
