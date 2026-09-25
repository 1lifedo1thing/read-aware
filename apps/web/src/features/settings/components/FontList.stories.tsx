import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CURATED_FONTS } from "../lib/curated-fonts";
import { toCuratedFont, type ReaderFontFamily } from "../lib/reader-settings";
import { FontList } from "./FontList";

/** Typed against the non-nullable branch of the props union (see FontField.stories). */
type FontListArgs = {
  value: ReaderFontFamily;
  onChange: (value: ReaderFontFamily) => void;
  className?: string;
};

/**
 * The font choices as a list, for a page of its own (the phone's appearance
 * drawer): the current font checked, and "Custom" switching the list to the
 * fonts installed on this device.
 */
const meta = {
  title: "Interface/Settings/FontList",
  component: FontList as (props: FontListArgs) => ReturnType<typeof FontList>,
  args: { value: toCuratedFont(CURATED_FONTS[2]!.id), onChange: () => {} },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <div className="w-[358px]"><FontList {...args} value={value} onChange={setValue} /></div>;
  },
} satisfies Meta<FontListArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
