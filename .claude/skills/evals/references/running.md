# 运行与场景选择

仅在执行评测、配置对比或选择场景时读取。命令和代码路径相对仓库根目录。

## 跑法

```sh
bun run eval:agent <suite>                       # 单套件一遍
bun run eval:agent <suite> --scenario <id>       # 单场景
bun run eval:agent <suite> --repetitions 3       # 抽样示例；重复次数按本次评测判据确定
bun run eval:all --concurrency 4                 # 全量；仅在评测范围需要时运行
bun run eval:agent <suite> --judge               # 附加 LLM 语义初评，仍需主 Agent 复核（另付 judge 模型费）
bun run eval:agent <suite> \
  --candidate glm=zai-coding-cn:glm-5.3 \
  --candidate ds=deepseek:deepseek-chat           # 多 provider 同 run 对比：全部变体进同一并发池
                                                  # 真并行；summary 出配对比较，viewer Run 页出
                                                  # 变体对比矩阵（场景 × 变体）
                                                  # provider 另含 ollama-cloud（Ollama 托管 API，
                                                  # key 在 OLLAMA_API_KEY 或 auth.json 的 ollama-cloud 条目）
bun run eval:agent <suite> --gate                # 要求完成语义验收；新样本待审时返回非零
```

以下是原有配置说明；实际运行前以 runner 配置和 run 工件为准，不因这段说明改写用户指定的模型或路由。provider **openrouter**（模型钉 `deepseek/deepseek-v4-flash-0731`，不带日期的 slug 是 0423 旧快照，
Baidu/千帆优先路由（CoreWeave 次选），key 在 `~/.pi/agent/auth.json`）、thinking **medium**、
单场景超时 **240s**。`--provider deepseek` 是旧直连路径；跨 provider/thinking
档位的结果**不可比**（trend 会标 INCOMPARABLE）。

默认所有场景都包含四维语义标准。运行结束的 `diagnosticScore` 和 checks 仅为辅助；
`Quality` 显示审阅覆盖率，未经主 Agent / 人工评审的样本始终 pending。
主 Agent 按 [结构化审阅](reviewing.md) 直接读日志，使用 `eval:review --list / --case / --save`。
保存逐条评语后执行 `bun run eval:review .eval/<run-id> --gate`；这一步不调用模型，
会根据原始记录和 `human-reviews.json` 更新 summary/report，包含自由追问的结论。
`eval:rescore` 只重算诊断 / 可选自动初评，不删除既有主 Agent 评语。

## 套件地图

| 套件 | 面 |
|---|---|
| karamazov / santi | 叙事真书：剧透围栏、版本保真、预训练知名度压力 + 本书公共行为场景 |
| lebon / refactoring / berger | 说明文/技术书/工具书：概念图、双语纪律、方法应用 + 本书公共行为场景 |
| journeys | 多轮长会话一条龙（选段→追问→标注→跨章→记忆→回顾） |
| legacy | 存量用户：图谱欠账过渡态、旧转录继承、旧断言扬弃 |
| personalization | 记忆必须改变回答（画像 A/B 带对照组） |
| crossbook | 全局线程跨书 |
| search | search/fetch、provider 差异、图片依据、并发与失败恢复；核对来源、图片匹配和延迟，不以调用次数代替效果 |
| memory / annotations / grounding / reading / interactions / settings / tools | 合成小书的基础行为面 |

## 独立 runner

```sh
bun run eval:digests <slug> [--resume]   # 真书纪要 fixture 重生成（断点续跑）
bun run eval:classify                    # 叙事性分类器对全部注册书回归（5 调用）
```
