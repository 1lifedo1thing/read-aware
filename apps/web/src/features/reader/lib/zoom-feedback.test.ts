import { expect, test } from "bun:test";
import { createZoomFeedback } from "./zoom-feedback";

test("each report reaches subscribers as a new snapshot, even at an unchanged percent", () => {
  const feedback = createZoomFeedback();
  const seen: unknown[] = [];
  const unsubscribe = feedback.subscribe(() => seen.push(feedback.getSnapshot()));
  expect(feedback.getSnapshot()).toBeNull();
  feedback.publish(1.249);
  feedback.publish(1.25);
  expect(seen).toEqual([
    { percent: 125, serial: 1 },
    { percent: 125, serial: 2 },
  ]);
  unsubscribe();
  feedback.publish(2);
  expect(seen).toHaveLength(2);
  expect(feedback.getSnapshot()).toEqual({ percent: 200, serial: 3 });
});

test("a quiet report updates the percentage without announcing it", () => {
  const feedback = createZoomFeedback();
  feedback.publish(1.5, { announce: false });
  expect(feedback.getSnapshot()).toEqual({ percent: 150, serial: 0 });
  feedback.publish(2);
  expect(feedback.getSnapshot()).toEqual({ percent: 200, serial: 1 });
});
