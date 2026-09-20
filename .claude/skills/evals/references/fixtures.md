# 新增场景与真书 fixture

仅在新增或修改场景、书籍 fixture 时读取。路径相对仓库根目录。

## 新增场景 / 新书（纪律不可省）

- 新书：EPUB 拷进 `packages/agent/fixtures/<slug>.epub`（超大文件先剥图）→
  `book-fixtures.ts` 注册表加 spec → `eval:digests <slug>` → 写以书名为
  `displayName` 的专属套件，并在 `real-book-common.ts` 加配置；公共场景会直接
  并入这本书的套件，不另建聚合套件。
- **断言素材必须从 fixture 文本实证**：泄漏词要双重实证（正文首现晚于读者
  边界 && 不出现在任何章题/卷题——目录对读者可见，引用卷题是正确行为）。
- 主 Agent 逐条审阅工具轨迹、实际来源和最终回答，作为行为质量的主要判断。
  确定性断言和可选 LLM judge 是辅助信号，不能替代这种审阅或用通过率关闭验收。
  跨章召回不要强制出现人名全名（正确答案可能用代词）。涉及章号时保留并核对
  原书完整章名、卷名与范围，不能用剥掉编号后的标题关键词证明章号正确。
- 共享断言件在 `suites/real-book-helpers.ts`——别在套件里复制粘贴。
- 凡"管线写入、agent 消费"的字段，产品投影链必须有直测——eval 的内存端口
  与产品端口共享实现（如 searchTurnRecords），不许让 fixture 在接缝处替产品圆谎。

## 章节边界验收

现有 headless EPUB fixture 保留旧套件固定的 spine 坐标，不等于宿主的目录章节。
涉及同文件多章、跨文件续章或目录锚点映射时，使用宿主抽取测试与真实 Tauri 正文端口，
把完整工具输出和原书目录保存在 run 工件中；不能用合成 seed 或旧 spine fixture
单独证明真实书籍的分章正确。
