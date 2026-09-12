# 运行与场景选择

仅在执行评测、配置对比或选择场景时读取。命令和代码路径相对仓库根目录。

## 跑法

```sh
bun run eval:agent <suite>                       # 单套件一遍
bun run eval:agent <suite> --scenario <id>       # 单场景
bun run eval:agent <suite> --repetitions 3       # 抽样示例；重复次数按本次评测判据确定
bun run eval:all --concurrency 4                 # 全量；仅在评测范围需要时运行
bun run eval:agent <suite> --judge               # 附加 LLM judge 评 rubric（另付 judge 模型费）
bun run eval:agent <suite> \
  --candidate glm=zai-coding-cn:glm-5.3 \
  --candidate ds=deepseek:deepseek-chat           # 多 provider 同 run 对比：全部变体进同一并发池
                                                  # 真并行；summary 出配对比较，viewer Run 页出
                                                  # 变体对比矩阵（场景 × 变体）
                                                  # provider 另含 ollama-cloud（Ollama 托管 API，
                                                  # key 在 OLLAMA_API_KEY 或 auth.json 的 ollama-cloud 条目）
bun run eval:agent <suite> --gate                # 行为失败也变非零退出码（CI 用）
```

以下是原有配置说明；实际运行前以 runner 配置和 run 工件为准，不因这段说明改写用户指定的模型或路由。provider **openrouter**（模型钉 `deepseek/deepseek-v4-flash-0731`，不带日期的 slug 是 0423 旧快照，
Baidu/千帆优先路由（CoreWeave 次选），key 在 `~/.pi/agent/auth.json`）、thinking **medium**、
单场景超时 **240s**。`--provider deepseek` 是旧直连路径；跨 provider/thinking
档位的结果**不可比**（trend 会标 INCOMPARABLE）。

## 套件地图

| 套件 | 面 |
|---|---|
| karamazov / santi | 叙事真书：剧透围栏、版本保真、预训练知名度压力 + 本书公共行为场景 |
| lebon / refactoring / berger | 说明文/技术书/工具书：概念图、双语纪律、方法应用 + 本书公共行为场景 |
| journeys | 多轮长会话一条龙（选段→追问→标注→跨章→记忆→回顾） |
| legacy | 存量用户：图谱欠账过渡态、旧转录继承、旧断言扬弃 |
| personalization | 记忆必须改变回答（画像 A/B 带对照组） |
| crossbook | 全局线程跨书 |
| memory / annotations / grounding / reading / interactions / settings / tools | 合成小书的基础行为面 |

## 独立 runner

```sh
bun run eval:digests <slug> [--resume]   # 真书纪要 fixture 重生成（断点续跑）
bun run eval:classify                    # 叙事性分类器对全部注册书回归（5 调用）
```
