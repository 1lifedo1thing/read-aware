import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocalAtom } from "./lib/useLocalAtom";
import { Toggle } from "./Toggle";

const meta = {
  title: "Design System/Components/Toggle",
  component: Toggle,
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

function InteractiveToggle({ label, checked: initial }: { label?: string; checked: boolean }) {
  const [checked, setChecked] = useLocalAtom(initial);
  return <Toggle label={label} checked={checked} onChange={setChecked} />;
}

export const Invalid: Story = {
  args: { label: "Sync", checked: false, onChange: () => {}, error: "Connection is unavailable." },
};

export const Off: Story = {
  args: { label: "Dark mode", checked: false, onChange: () => {} },
};

export const On: Story = {
  args: { label: "Dark mode", checked: true, onChange: () => {} },
};

export const Interactive: Story = {
  args: { label: "Show annotations", checked: false, onChange: () => {} },
  render: (args) => <InteractiveToggle label={args.label} checked={args.checked} />,
};
