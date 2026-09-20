import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocalAtom } from "./lib/useLocalAtom";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

const meta = {
  title: "Design System/Components/Dialog",
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    title: "Remove from shelf",
    children:
      "This will remove the item from your shelf. You can always add it back later.",
    onClose: () => {},
  },
};

/** A quiet confirmation that leaves the surrounding content sharp. */
export const DimBackdrop: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Open external link?",
    backdrop: "dim",
    children: "This link will open in your default browser.",
  },
};

export const Interactive: Story = {
  args: {
    open: false,
    onClose: () => {},
    title: "Confirm action",
    children: "Are you sure you want to proceed?",
  },
  render: (args) => {
    const [open, setOpen] = useLocalAtom(args.open);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open dialog</Button>
        <Dialog open={open} onClose={() => setOpen(false)} title={args.title}>
          <p>{args.children}</p>
        </Dialog>
      </>
    );
  },
};
