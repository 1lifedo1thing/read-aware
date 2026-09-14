import { expect, test } from "bun:test";
import type { RuntimeDeps } from "../ports";
import { buildTransactionTools } from "./transaction-tools";

test("transaction approval displays the host preview and decline never dispatches", async () => {
  const preview = { id: "frozen", expiresAt: "2026-09-14T00:00:00Z", operations: [{ kind: "book.metadata", bookId: "book", patch: { title: "Chosen title" } }], before: [{ title: "Old" }] };
  const subjects: string[] = [], committed: string[] = [];
  let approve = false;
  const deps = { transactions: () => ({ inspectPreview: async (id: string) => id === preview.id ? structuredClone(preview) : null,
    commit: async (id: string) => { committed.push(id); return { id, committed: true }; } }),
    interactions: { request: async (request: { action: string; subject: string }) => {
      expect(request.action).toBe("atomic-transaction"); subjects.push(request.subject); return { optionId: approve ? "approve" : "decline" };
    } },
  } as unknown as RuntimeDeps;
  const tool = buildTransactionTools({ kind: "book", bookId: "book" }, deps).find(tool => tool.name === "commit_atomic_transaction")!;
  await tool.execute("decline", { id: "frozen" });
  expect(committed).toEqual([]);
  approve = true;
  await tool.execute("approve", { id: "frozen" });
  expect(committed).toEqual(["frozen"]);
  expect(subjects.map(subject => JSON.parse(subject))).toEqual([preview, preview]);
  const missing = await tool.execute("missing", { id: "invented" }).catch(error => error);
  expect(missing).toMatchObject({ code: "transaction/preview-expired" });
  expect(subjects).toHaveLength(2);
});
