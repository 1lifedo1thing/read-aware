# 新增场景与真书 fixture

仅在新增或修改场景、书籍 fixture 时读取。路径相对仓库根目录。

## 新增场景 / 新书（纪律不可省）

- 新书：EPUB 拷进 `packages/agent/fixtures/<slug>.epub`（超大文件先剥图）→
  `book-fixtures.ts` 注册表加 spec → `eval:digests <slug>` → 写以书名为
  `displayName` 的专属套件，并在 `real-book-common.ts` 加配置；公共场景会直接
  并入这本书的套件，不另建聚合套件。
- **断言素材必须从 fixture 文本实证**：泄漏词要双重实证（正文首现晚于读者
  边界 && 不出现在任何章题/卷题——目录对读者可见，引用卷题是正确行为）。
- 断言分层：确定性检查（answer/tools/interactions/state）优先；语义质量走
  `rubric` + `--judge`。跨章召回别断言人名全名（正确答案会用代词回指——断
  内容词 anyOf）。英文章题断言用 `chapterTitleKey`（已剥 "Chapter N" 前缀）。
- 共享断言件在 `suites/real-book-helpers.ts`——别在套件里复制粘贴。
- 凡"管线写入、agent 消费"的字段，产品投影链必须有直测——eval 的内存端口
  与产品端口共享实现（如 searchTurnRecords），不许让 fixture 在接缝处替产品圆谎。
