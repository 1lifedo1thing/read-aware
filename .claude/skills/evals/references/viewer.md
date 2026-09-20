# 查看和记录评测

这是用户查看结果和讨论评语的界面。主 Agent 直接使用 [结构化审阅](reviewing.md)，
不用启动浏览器或 Viewer 来判断结果；查看已有工件不要求重新运行模型。

## 可视化：eval viewer SPA

```sh
bun run eval:ui        # http://127.0.0.1:5199 （packages/agent/eval-viewer）
```

- **Overview**：全部套件（稳定 S 编号）+ 最近 runs 列表。
- **Suite 页就是主评测面**：默认载入最近一次 run，每个场景按文档流直接呈现
  读者问题、模型完整回答、人工评分与评语；可切历史 run，也可按全部/待评/
  有问题筛选。测试定义、机器 checks 和 seed 退到按需诊断层。
- **Run 页**：历史 run 的固定链接，使用同一套逐条评测文档流，不再嵌入一套
  带侧栏的“小工作台”。
- **人工 Judge**：评分与评语直接贴在每条回答下方；1–5 分会映射为满意/
  有保留/不满意，问题标签与评语修改后自动保存，不需要点击保存按钮。结果落在
  run bundle 的 `human-reviews.json`，自由会话落在 `manual-sessions.json`。
- **自由评测**：从任一固定场景继承同一本书、seed、阅读位置和可选选区，直接输入
  新问题；同一会话可连续追问，使用真实 `AgentThread` 和该 run 的模型配置。进程
  重启后历史仍可阅读和评分，但模型会话不可恢复，需要新开会话。
- **引用坐标**：场景一律用 `S07.3` 这种编号沟通（套件 code + 套件内序号）；
  编号只增不改。用户报编号 → 在 viewer 的 Suite 页或 `evalSuites` 注册表
  按序号定位场景。
- 数据即 `.eval/` 工件目录（repo 根 + packages/agent 两处都扫）+ 从 agent 包
  实时加载的套件定义——**不跑 eval 也能浏览目录**。
- viewer 是**直播的**：正在跑的 run（含进行中进度 n/total）实时出现在列表与 Run 页，
  SSE 随工件落盘自动刷新，无须手动刷新；十分钟无写入的未完成 run 标"中断"。
  终端仍打印 trend delta（`!` 前缀 = 回归场景）。bundle 含书文本与模型输出——本地诊断工件，**不许 commit、不许外发**。

## 共享评语

Viewer 使用 `POST /api/runs/<run-id>/human-reviews` 保存用户输入。主 Agent 用
`eval:review --save` 合并到同一份本地文件，格式如下。`targetId` 为 `run:<runs.jsonl 中的 id>`，
自由追问则为 `manual:<turn.id>`。每条评语引用实际证据，不能批量复制“看起来不错”。

```json
{
  "schemaVersion": 1,
  "reviews": {
    "run:<record-id>": {
      "targetId": "run:<record-id>",
      "verdict": "partial",
      "score": 3,
      "dimensions": { "correctness": 2, "completeness": 4, "helpfulness": 3, "restraint": 4 },
      "flags": ["章节或进度错误"],
      "notes": "Turn 1 的 read_chapter 返回原题为下卷第一章；回答却写第六章。引用内容相符，但把检索索引当成了章号。",
      "updatedAt": "<ISO timestamp>"
    }
  }
}
```

语义任务的 `verdict` + 非空证据评语才算已审。确定性操作显式标为 programmatic，
有完成输出和实际状态验证时直接计入通过/失败，不出现在待语义审阅列表。
数字用于辅助比较，不能平均掉实质性错误。
API 和 CLI 保存后都自动更新报告；直接写文件后执行 `bun run eval:review <bundle> --gate`。
总览、套件与 run 使用相同的评语来源，旧机器通过样本默认待审；自动 judge 初评
单独呈现。断言趋势仍保留，但明确标注为诊断趋势，不代表读者体验的升降。
