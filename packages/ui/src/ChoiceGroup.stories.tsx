import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Rows, SquaresFour } from "@phosphor-icons/react";
import { ChoiceGroup } from "./ChoiceGroup";

const meta = {
  title: "Design System/Components/ChoiceGroup",
  component: ChoiceGroup,
} satisfies Meta<typeof ChoiceGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

function ControlledChoiceGroup(args: ComponentProps<typeof ChoiceGroup>) {
  const [value, setValue] = useState(args.value);
  return <ChoiceGroup {...args} value={value} onChange={setValue} />;
}

export const Invalid: Story = {
  args: { label: "Color", value: "yellow", options: [{ value: "yellow", label: "Yellow" }, { value: "green", label: "Green" }],
    onChange: () => {}, error: "An annotation changed. Refresh before trying again." },
};

export const Default: Story = {
  args: {
    label: "Theme",
    value: "warm",
    options: [
      { value: "light", label: "Light" },
      { value: "warm", label: "Warm" },
      { value: "dark", label: "Dark" },
    ],
    onChange: () => {},
  },
  render: (args) => <ControlledChoiceGroup {...args} />,
};

/** Stacked rows for longer sets in a narrow menu, such as the shelf's sort order. */
export const List: Story = {
  args: {
    label: "Sort by",
    value: "recent",
    layout: "list",
    options: [
      { value: "recent", label: "Recently read" },
      { value: "added", label: "Date added" },
      { value: "title", label: "Title" },
      { value: "author", label: "Author" },
    ],
    onChange: () => {},
  },
  render: Default.render,
};

export const WithIcons: Story = {
  args: {
    label: "Layout",
    value: "grid",
    options: [
      { value: "grid", label: "Grid", icon: <SquaresFour size={15} weight="regular" /> },
      { value: "list", label: "List", icon: <Rows size={15} weight="regular" /> },
    ],
    onChange: () => {},
  },
  render: Default.render,
};
