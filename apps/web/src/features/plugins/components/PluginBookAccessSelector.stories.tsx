import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { PluginBookAccess } from "../lib/plugin-types";
import { PluginBookAccessSelector } from "./PluginBookAccessSelector";

const books = [
  { id: "pale-fire", title: "Pale Fire" },
  { id: "the-trial", title: "The Trial" },
];

function InteractiveSelector({ initial }: { initial: PluginBookAccess }) {
  const [value, setValue] = useState(initial);
  return <PluginBookAccessSelector value={value} books={books} onChange={setValue} />;
}

const meta = {
  title: "Interface/Plugins/PluginBookAccessSelector",
  component: PluginBookAccessSelector,
  parameters: { layout: "centered" },
  args: { value: { mode: "all" }, books, onChange: () => undefined },
} satisfies Meta<typeof PluginBookAccessSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllBooks: Story = {
  render: () => <InteractiveSelector initial={{ mode: "all" }} />,
};

export const CurrentBook: Story = {
  render: () => <InteractiveSelector initial={{ mode: "current" }} />,
};

export const SpecificBook: Story = {
  render: () => <InteractiveSelector initial={{ mode: "book", bookId: "the-trial" }} />,
};

export const NoBooks: Story = {
  render: () => (
    <PluginBookAccessSelector
      value={{ mode: "all" }}
      books={[]}
      onChange={() => undefined}
    />
  ),
};
