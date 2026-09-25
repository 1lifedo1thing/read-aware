import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SwatchGroup } from "./SwatchGroup";

const meta = {
  title: "Design System/Components/SwatchGroup",
  component: SwatchGroup,
} satisfies Meta<typeof SwatchGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const LIGHT = { background: "#ffffff", foreground: "#1c1917" };
const DARK = { background: "#1c1917", foreground: "#e7e5e4" };
const OPTIONS = [
  { value: "auto", label: "Auto", colors: LIGHT, alternate: DARK },
  { value: "light", label: "Light", colors: LIGHT },
  { value: "warm", label: "Warm", colors: { background: "#f4efe6", foreground: "#292524" } },
  { value: "dark", label: "Dark", colors: DARK },
  { value: "gutenberg", label: "Gutenberg", colors: { background: "#f6f1e3", foreground: "#3b2f22" } },
  { value: "nocturne", label: "Nocturne", colors: { background: "#0f1720", foreground: "#c9d4df" } },
];

/** Page colors by how they look; "Auto" shows both halves it switches between. */
export const PageColors: Story = {
  args: { ariaLabel: "Page Color", value: "warm", options: OPTIONS, onChange: () => {} },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <div className="w-80"><SwatchGroup {...args} value={value} onChange={setValue} /></div>;
  },
};

/** With a visible label, like ChoiceGroup's. */
export const Labeled: Story = {
  ...PageColors,
  args: { ...PageColors.args, label: "Page Color", ariaLabel: undefined },
};

/** Without names: the colors speak for themselves; names are announced only. */
export const Unlabeled: Story = {
  ...PageColors,
  args: { ...PageColors.args, showLabels: false },
};
