# 宿主能力当前交接

更新时间：2026-09-15。清理前完整流水账保留在 Git 对象 `17860738`。

## 当前交接

- 阶段：C01–C09 实现冻结，进入集中真实验收。
- 范围：[九项验收清单与停止规则](host-capability-acceptance.md)。
- 实现判断：已命名的公共调用链已接；C04/C05 不再以“其他来源”“其他操作”继续
  扩张。验收复现的具体断点按 bug 修复，不重新开启全仓能力扫描。
- 下一步：依次执行 C01–C09 的组合场景，为每项给出通过、失败、外部阻塞或不适用。
- 完成边界：真实插件/Worker/Tauri 动作、回执及必要重读或重启；类型、单测、文档和
  commit 数不独立构成完成。

## 事实源

| 用途 | 文件 |
| --- | --- |
| 243 行现状、调用入口、消费者和边界 | [host-capability-matrix.data.ts](host-capability-matrix.data.ts) |
| Domain/Contribution/Service/Contract 责任模型 | [host-capability-model.data.ts](host-capability-model.data.ts) |
| 当前有限验收队列 | [host-capability-acceptance.md](host-capability-acceptance.md) |
| 真实桌面候选场景 | [host-capability-stage-three.md](host-capability-stage-three.md) |

生成的 `host-capability-matrix.{md,html}` 和 `host-capability-model.{md,html}` 是以上
数据源的可读输出，不是独立状态或待办来源。

## 历史恢复

清理前 3555 行的逐 commit 流水账没有继续留在工作树。需要追查旧实现或精确日志时：

```sh
git show 17860738:docs/host-capability-delivery.md
git log --follow -p -- docs/capabilities/host-capability-delivery.md
```

旧目标、专项验收报告和原始运行工件只保留在 Git 历史中，不再在 docs 维护。

## 维护规则

1. 本文件顶部只保留一条当前交接，不追加逐 commit 日记或 `/tmp` 日志路径。
2. 一组真实验收结束后，把结果、日期、环境和未验证边界写回对应文档，不追加原始运行工件。
3. 能力事实只改数据源；生成的 Markdown/HTML 由脚本刷新。
4. 新问题只有阻塞当前九项行为或有具体安全/正确性证据时才进入范围。
