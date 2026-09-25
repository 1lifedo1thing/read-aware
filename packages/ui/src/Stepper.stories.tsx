import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stepper } from "./Stepper";

const meta = {
  title: "Design System/Components/Stepper",
  component: Stepper,
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

const SIZES = ["XXS", "XS", "Small", "Medium", "Large", "XL", "XXL", "XXXL"];

/** Plus / minus through an ordered range; each end disables its button. */
export const Default: Story = {
  args: {
    label: "Font Size", valueText: "Medium", onDecrement: () => {}, onIncrement: () => {},
    decrementLabel: "Smaller text", incrementLabel: "Larger text",
  },
  render: (args) => {
    const [index, setIndex] = useState(3);
    return (
      <div className="w-80">
        <Stepper
          {...args}
          valueText={SIZES[index]!}
          canDecrement={index > 0}
          canIncrement={index < SIZES.length - 1}
          onDecrement={() => setIndex((i) => Math.max(0, i - 1))}
          onIncrement={() => setIndex((i) => Math.min(SIZES.length - 1, i + 1))}
        />
      </div>
    );
  },
};

/** The reader's text-size control: a small and a large "A" for the glyphs. */
export const TextSize: Story = {
  ...Default,
  args: {
    ...Default.args,
    decrementIcon: <span aria-hidden="true" className="font-serif text-[13px] leading-none">A</span>,
    incrementIcon: <span aria-hidden="true" className="font-serif text-[20px] leading-none">A</span>,
  },
};

/** At the top of the range the plus button disables. */
export const AtEnd: Story = {
  args: { ...Default.args, valueText: "XXXL", canIncrement: false },
};
