import { expect, test } from "bun:test";
import type { PluginViewResult, PluginView } from "@read-aware/plugin-types";
import { saveProfile } from "../src/profiles";
import { profileView, profilesView } from "../src/views";
import { fixture } from "./fixture";

function action(view: PluginView, id: string) {
  if (view.kind !== "detail") throw Error("Expected profile detail");
  return view.actions?.find(item => item.id === id);
}
function resultView(result: PluginViewResult): PluginView {
  if (!result?.view) throw Error("View missing");
  return result.view;
}

test("displayed profile revisions protect apply, rename and confirmed deletion", async () => {
  const f = fixture(), saved = await saveProfile(f.ctx, "Reading");
  if (saved.status !== "saved") throw Error("Save failed");
  const detail = await profileView(f.ctx, saved.id);
  const form = resultView(await action(detail, "delete")!.run());
  if (form.kind !== "form") throw Error("Expected confirmation");
  expect(await form.onSubmit({ confirm: false })).toMatchObject({ fieldErrors: { confirm: "Confirm the deletion first." } });
  expect(f.documents.has(saved.id)).toBe(true);
  const rename = resultView(await action(detail, "rename")!.run());
  if (rename.kind !== "form") throw Error("Expected rename form");
  expect(await rename.onSubmit({ name: "" })).toMatchObject({ fieldErrors: { name: "Enter a name of 1–80 characters." } });
  f.revisions.set(saved.id, "changed");
  expect(JSON.stringify(await action(detail, "apply")!.run())).toContain("changed in the meantime");
  expect(JSON.stringify(await rename.onSubmit({ name: "Evening" }))).toContain("changed in the meantime");
  expect(JSON.stringify(await form.onSubmit({ confirm: true }))).toContain("changed in the meantime");
  expect(f.updates).toHaveLength(0); expect(f.documents.has(saved.id)).toBe(true);
  const fresh = await profileView(f.ctx, saved.id);
  const renamed = resultView(await action(fresh, "rename")!.run());
  if (renamed.kind !== "form") throw Error("Expected rename form");
  expect(await renamed.onSubmit({ name: "  Evening  " })).toMatchObject({ toast: "Profile renamed" });
  expect((f.documents.get(saved.id) as { name: string }).name).toBe("Evening");
  const freshForm = resultView(await action(await profileView(f.ctx, saved.id), "delete")!.run());
  if (freshForm.kind !== "form") throw Error("Expected confirmation");
  expect(await freshForm.onSubmit({ confirm: true })).toMatchObject({ toast: "Profile deleted", navigation: "reset" });
  expect(f.documents.size).toBe(0);
});

test("detail rows use the host catalog labels and applying offers undo", async () => {
  const f = fixture(), saved = await saveProfile(f.ctx, "Reading");
  if (saved.status !== "saved") throw Error("Save failed");
  const detail = await profileView(f.ctx, saved.id);
  if (detail.kind !== "detail") throw Error("Expected detail");
  const rows = detail.content[0]!;
  if (rows.kind !== "keyValue") throw Error("Expected rows");
  expect(rows.rows.find(row => row.label === "Shelf layout")?.value).toBe("List");
  expect(rows.rows.find(row => row.label === "Reading font size")?.value).toBe("20");
  expect(rows.rows.find(row => row.label === "reading.fontFamily")?.value).toBe("App default");
  expect(detail.actions?.map(item => [item.id, item.priority])).toEqual([
    ["apply", "primary"], ["rename", "secondary"], ["delete", "secondary"], ["refresh", "secondary"],
  ]);
  const applied = resultView(await action(detail, "apply")!.run());
  expect(f.updates).toHaveLength(1);
  expect(JSON.stringify(applied)).toContain("Profile applied");
  const undone = await action(applied, "undo")!.run();
  expect(undone).toMatchObject({ toast: "Previous settings restored", navigation: "reset" });
  expect(f.updates).toHaveLength(2);
});

test("profile pages use host cursors, summarize each profile and restart after writes", async () => {
  const f = fixture();
  for (let index = 0; index < 41; index++) await saveProfile(f.ctx, `Profile ${index}`);
  const first = await profilesView(f.ctx);
  if (first.kind !== "list") throw Error("List missing");
  expect(first.items).toHaveLength(40);
  expect(first.items[0]!.subtitle).toBe("List · light · 20");
  expect(first.actions?.map(item => [item.id, item.priority])).toEqual([["save", "primary"], ["refresh", "secondary"]]);
  const second = resultView(await first.pagination!.onNext!());
  if (second.kind !== "list") throw Error("List missing");
  expect(second.items).toHaveLength(1); expect(second.pagination!.page).toBe(2);
  expect(second.pagination!.onPrevious).toBeFunction();
  await saveProfile(f.ctx, "Later");
  const stale = resultView(await first.pagination!.onNext!());
  expect(JSON.stringify(stale)).toContain("The profile list changed");
  if (stale.kind !== "detail") throw Error("Stale state missing");
  const refreshed = resultView(await stale.actions![0]!.run());
  expect(refreshed.kind).toBe("list");
});

test("saving opens the new profile and invalid profiles remain removable", async () => {
  const f = fixture();
  const list = await profilesView(f.ctx);
  if (list.kind !== "list") throw Error("List missing");
  const form = resultView(await list.actions!.find(item => item.id === "save")!.run());
  if (form.kind !== "form") throw Error("Form missing");
  const result = await form.onSubmit({ name: "Reading" });
  expect(result).toMatchObject({ toast: "Profile saved", navigation: "reset" });
  expect(resultView(result).kind).toBe("detail");
  expect(f.documents.size).toBe(1);
  f.documents.set("invalid", { version: 2 });
  const detail = await profileView(f.ctx, "invalid");
  expect(action(detail, "apply")).toBeUndefined();
  expect(action(detail, "rename")).toBeUndefined();
  expect(action(detail, "delete")).toBeDefined();
  expect(JSON.stringify(await profileView({ ...f.ctx, locale: "zh-CN" }, "missing"))).toContain("这个预设已不存在");
});
