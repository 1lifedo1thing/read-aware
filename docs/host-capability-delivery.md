# 宿主能力交付与证据索引

更新时间：2026-09-15。清理前完整流水账保留在 Git 对象 `17860738`。

## 当前交接

- 阶段：C01–C09 实现冻结，进入集中真实验收。
- 范围：[九项验收清单与停止规则](./host-capability-acceptance.md)。
- 实现判断：已命名的公共调用链已接；C04/C05 不再以“其他来源”“其他操作”继续
  扩张。验收复现的具体断点按 bug 修复，不重新开启全仓能力扫描。
- 下一步：依次执行 C01–C09 的组合场景，为每项给出通过、失败、外部阻塞或不适用。
- 完成边界：真实插件/Worker/Tauri 动作、回执及必要重读或重启；类型、单测、文档和
  commit 数不独立构成完成。

## 事实源

| 用途 | 文件 |
| --- | --- |
| 243 行现状、调用入口、消费者和边界 | [host-capability-matrix.data.ts](./host-capability-matrix.data.ts) |
| Domain/Contribution/Service/Contract 责任模型 | [host-capability-model.data.ts](./host-capability-model.data.ts) |
| 当前有限验收队列 | [host-capability-acceptance.md](./host-capability-acceptance.md) |
| 真实桌面候选场景 | [host-capability-stage-three.md](./host-capability-stage-three.md) |
| 原始运行工件 | [evidence](./evidence/) |

生成的 `host-capability-matrix.{md,html}` 和 `host-capability-model.{md,html}` 是以上
数据源的可读输出，不是独立状态或待办来源。

## 关键证据入口

| 范围 | 证据 |
| --- | --- |
| 2026-09-13 全量桌面观察与逐项工件 | [full-validation](./evidence/2026-09-13-full-validation/README.md) |
| 后续故障与恢复补验 | [full-validation-2](./evidence/2026-09-13-full-validation-2/README.md) |
| 冻结 16 项的最终分类 | [bounded validation report](./evidence/2026-09-13-bounded-validation/final-report.md) |
| Jumper 目录、搜索、导航和历史 | [jumper-capability-2026-09-08.json](./evidence/jumper-capability-2026-09-08.json) |
| Jumper 书签与窗口重启组合 | [bookmark-window-composition-2026-09-11.json](./evidence/bookmark-window-composition-2026-09-11.json) |
| 插件动态状态与 Worker 生命周期 | [plugin-action-state-2026-09-09.json](./evidence/plugin-action-state-2026-09-09.json) |
| 阅读内容、脚注、图片和灯箱组合 | [library-content-composition-2026-09-11.json](./evidence/library-content-composition-2026-09-11.json) |
| 标注真实组合 | [annotation-composition-2026-09-11.json](./evidence/annotation-composition-2026-09-11.json) |
| RSS 虚拟书与网络错误组合 | [rss-composition-2026-09-11.json](./evidence/rss-composition-2026-09-11.json) |
| 管理与朗读组合 | [management-listening-composition-2026-09-11.json](./evidence/management-listening-composition-2026-09-11.json) |
| 打包插件安装/导出/卸载 | [packaged-annotation-desk-2026-09-09.json](./evidence/packaged-annotation-desk-2026-09-09.json) |
| 打包 Worker 网络沙箱修复 | [packaged-sandbox-network-2026-09-09.json](./evidence/packaged-sandbox-network-2026-09-09.json) |

这些证据各自只证明文件声明的环境和边界；失败、partial 与外部阻塞不会因被索引而
变成通过。

## 历史恢复

清理前 3555 行的逐 commit 流水账没有继续留在工作树。需要追查旧实现或精确日志时：

```sh
git show 17860738:docs/host-capability-delivery.md
git log -p -- docs/host-capability-delivery.md
```

已完成的旧目标同样由 Git 历史保存，不再作为当前文档维护。

## 维护规则

1. 本文件顶部只保留一条当前交接，不追加逐 commit 日记或 `/tmp` 日志路径。
2. 一组真实验收结束后，只更新对应结果和稳定 evidence 路径。
3. 能力事实只改数据源；生成的 Markdown/HTML 由脚本刷新。
4. 新问题只有阻塞当前九项行为或有具体安全/正确性证据时才进入范围。
