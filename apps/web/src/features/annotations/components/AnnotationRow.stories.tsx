import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Ask, Highlight, Note } from "../lib/annotation-types";
import { AnnotationRow } from "./AnnotationRow";

const base = {
  bookId: "b1",
  chapterHref: "chapter-03.xhtml",
  createdAt: "2026-07-06T09:00:00.000Z",
  updatedAt: "2026-07-06T09:00:00.000Z",
};

const highlight: Highlight = {
  ...base,
  id: "h1",
  type: "highlight",
  color: "yellow",
  cfiRange: "epubcfi(/6/8!/4/2/14,/1:0,/1:74)",
  text: "Every action you take is a vote for the type of person you wish to become.",
};

const note: Note = {
  ...base,
  id: "n1",
  type: "note",
  cfiRange: "epubcfi(/6/8!/4/2/22,/1:12,/1:70)",
  text: "Habits are the compound interest of self-improvement.",
  content:
    "Compare with Ericsson's deliberate-practice framing — compounding needs feedback, not just repetition.",
};

// ask = a question trace: `text` is the question itself, rendered unquoted.
const ask: Ask = {
  ...base,
  id: "a1",
  type: "ask",
  cfiRange: "epubcfi(/6/8!/4/2/30,/1:0,/1:41)",
  text: "How does this habit loop differ from Duhigg's cue-routine-reward loop?",
};

const meta = {
  title: "Interface/Annotations/AnnotationRow",
  component: AnnotationRow,
  args: {
    annotation: highlight,
    onNavigate: () => {},
    onDelete: () => {},
  },
  decorators: [
    (Story) => (
      // List-row width, as in the notes popover and the phone drawer.
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AnnotationRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A highlight: a rule in its colour beside the quoted passage. */
export const HighlightRow: Story = {};

/** A note: neutral rule, quoted passage, then the note body with its pencil mark. */
export const NoteRow: Story = {
  args: { annotation: note },
};

/** An ask-AI trace: chat mark, and the question rendered without quotes. */
export const AskRow: Story = {
  args: { annotation: ask },
};
