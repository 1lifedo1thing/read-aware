# Agent 架构

ReadAware 使用一个核心阅读 Agent，配合确定性的检索、存储与后台整理流程。
运行时已实现；本页说明当前结构，不把模型回答质量或全部桌面场景视为已经验收。
文档整理于 2026-09-15，依据下列源码入口。

## 会话与记忆

- 每本书有自己的持久对话；全局 Context 页面允许用户创建多个对话。
- 会话决定本轮关注哪本书、读取哪些上下文；用户记忆和全局记忆不随对话拆成多份。
- 聊天记录保存原始交流。长期连续性由记忆、画像、书籍摘要与图谱支持，不能依靠
  无限回放完整聊天记录。
- 书内运行时保留当前章节会话；跨章节发送、权限或策略变化时按运行时规则重建或
  刷新上下文。全局对话按轮装配上下文。近期转录窗口仍可参与对话，这不等于把转录
  当成长期记忆。

入口：[ThreadScope](../../packages/agent/src/thread-scope.ts)、
[AgentThread](../../packages/agent/src/runtime/thread.ts)、
[上下文装配](../../packages/agent/src/context/system-prompt.ts)。

## 一轮请求怎样执行

1. 桌面聊天适配器把用户输入、附件和当前阅读位置交给 `AgentRuntime`。
2. `AgentThread` 按书籍范围、阅读进度和隐私设置装配上下文，并解析本轮可用工具。
3. 主聊天模型生成回答，必要时通过工具查询正文、记忆或请求宿主动作。
4. 宿主负责实际授权、需要用户确认的操作、持久写入和真实结果；工具不能绕过它。
5. 运行时流式返回文字与界面事件，持久化对话，并在策略允许时排队提炼记忆或更新摘要。

可重试的模型连接、限流等错误保留本次运行时内的请求断点：点击 Retry 时复用已经完成的
工具结果、图片 ID 和展示记录，从失败的模型请求继续，不重复执行已完成的工具。
失败请求的半截输出会丢弃；成功回答的 Regenerate 仍从头生成。断点仅在当前运行时有效，
重启、切换模型、上下文失效或开始新一轮后不再复用；无有效断点时按正常流程重建。

入口：[桌面适配器](../../apps/web/src/features/ai/agent/pi-chat-transport.ts)、
[宿主运行时装配](../../apps/web/src/features/ai/agent/agent-runtime.ts)、
[核心运行时](../../packages/agent/src/runtime/runtime.ts)、
[工具注册](../../packages/agent/src/tools/registry.ts)。

## 检索、整理与模型

检索以本地 SQLite、全文索引和结构化范围为基础。Agent 可以继续查目录、搜索正文、
读取章节；默认架构不引入 embedding 或向量数据库。

公开网络资料通过独立的 BYOK Search / Fetch 能力获取。在「设置 → AI → 联网搜索」
选择服务商、填写 key 并启用后，书内与全局 Agent 都可使用 `web_search` / `web_fetch`。
搜索配置与模型配置独立，切换服务商保留各自凭据；可选择 TinyFish、Exa、Tavily、SerpAPI（Google）或 Brave。
一个选择同时决定搜索和正文读取，二者使用同一服务商、同一 key，不能跨服务商回退。
Exa、Tavily、TinyFish 提供正文读取；Brave 用自己的 LLM Context 获取指定 URL 的提取片段，
不保证完整正文或实时抓取。SerpAPI 暂无正文接口，不提供 `web_fetch`。
旧配置里的独立 `fetchProvider` 不再生效，原有各家 key 保留。连接测试调用所选服务商的搜索及其支持的正文读取；
关闭搜索则在下一次工具装配和调用检查时生效。

宿主通过 `RuntimeDeps.web` 提供查询和正文读取，凭据使用既有加密 secret store 的
`ai-api-key.search.<provider>` 槽位，沿用其加密备份与同步规则；普通配置不包含 key。
模型只接收有界的来源、摘要或正文，不接收服务商凭据。联网只发送查询词及公开网址，
本地书架检索仍走本地端口。网页资料按不可信数据处理，不能改变设置、泄露私密上下文，
也不能代替本书版本的原文或绕过剧透边界；回答使用来源链接。

模型按问题判断是否需要配图，不按人物等场景设置触发规则。`web_search` / `web_fetch` 的
`includeImages` 请求当前服务商返回来源关联的候选图片；`present_web_images` 只能展示本轮检索
返回的图片 ID，每轮最多三张。TinyFish 带图搜索会并行读取排名靠前的最多两个不同来源，
从同一 provider 的 Fetch `image_links` 取图，先得到可用候选即返回并取消另一请求；额外等待最多 5 秒。
同时返回最多 2,000 字符的 `imageContext` 正文摘录与续读位置，复用宿主正文缓存。
Brave 带图搜索并行调用原生 [Image Search](https://api-dashboard.search.brave.com/documentation/services/image-search)
与 Web Search，图片接口额外等待最多 5 秒；失败时保留网页结果缩略图并说明限制。
带日期筛选的查询仅使用筛选后网页的缩略图，并说明这不证明图片本身的日期；图片接口不支持日期筛选。
Exa、Tavily 支持随搜索/正文返回图片，SerpAPI 使用自然结果缩略图。
图片失败、超时不丢失文字结果；用户主动取消仍会取消整次调用。没有合适图片时照常回答，不换服务商兜底。
候选先过滤已知站点装饰图、合并 MediaWiki 同图不同尺寸，再截取最多八张；多个互补图片
可由模型一起展示。检索完成即预加载最多三张候选预览，下载与模型选图并行；最多等待 8 秒，
卡片与预加载共享请求和缓存。保留 provider 返回的缩略图与原图 URL；MediaWiki 多尺寸图片优先用
已返回的较小尺寸（至少 240px）预览，不拼接猜测图片 URL。
点击聊天图片复用阅读器的全屏图片查看器，先显示预览再按需加载原图，原图失败保留预览，支持缩放、旋转与复制。
图片说明与来源随聊天记录保存；宿主用无凭据的 HTTP 请求读取 HTTPS 位图（最多 4 MiB），
转换为临时 blob 显示，关闭时释放，失败则保留说明与来源。图片以 URL 哈希存入本机
`app_cache_dir/web-images`，最多 128 MiB / 512 张、30 天；内存另保留最多 24 MiB，
相同下载请求合并。缓存不进入 SQLite、书籍 blob、同步事件或备份，因此不会上传到 R2。
聊天仍保存图片来源 URL、说明；在其他设备上由该设备自行加载和缓存图片。展示图片不等于模型看过图片像素。

桌面检索端口保留短时内存响应缓存（搜索 60 秒，正文 5 分钟，分别最多 16 MiB / 32 项），
按当前服务商及 key 隔离。相同并发请求共享网络读取，但取消其中一个订阅不会取消其他订阅；
正文缓存完整的服务商响应，`nextOffset` 续读无需重新下载，保留最初的 `retrievedAt`。
`fresh=true` 绕过本地缓存；上游无法强制刷新的限制仍照常返回。失败不复用，缓存不落盘。
独立来源可同轮并行读取；模型认为图片有帮助时，首轮检索就请求候选。已有摘录与描述够用时直接选图，
详细主张仍需足够的来源正文，不为加速而把搜索摘要当完整证据。
日志分别记录检索、首个图片引用、图片字节就绪耗时与缓存层，不记录查询词、图片 URL 或密钥。
首个引用不等于图片已绘制；桌面验收另从发送时刻观测图片解码与可见状态。

各适配器使用官方 HTTP API，不自动升级到浏览器、Agent 或付费深度研究服务：

| Provider | Search | Fetch 与特有约束 |
| --- | --- | --- |
| [TinyFish](https://docs.tinyfish.ai/search-api/reference) | Search API，时间、语言、域名筛选 | [Fetch API](https://docs.tinyfish.ai/fetch-api/reference)，`fresh` 设置 `ttl: 0` |
| [Exa](https://exa.ai/docs/reference/search) | `auto`，返回 highlights；无显式语言筛选，会返回限制说明 | [Contents](https://exa.ai/docs/reference/get-contents)，`fresh` 设置 `maxAgeHours: 0` |
| [Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search) | `basic`，禁用自动升档和生成式 answer，支持日期、语言、域名 | [Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract)，检查 HTTP 200 中的 `failed_results`；无缓存绕过参数，`fresh` 返回限制说明 |
| [SerpAPI](https://serpapi.com/search-api) | Google 自然搜索结果，忽略广告与 answer box；检查 `search_metadata.status` | 暂不支持；凭据在其要求的查询参数中传送，不回显请求 URL 或上游错误正文 |
| [Brave](https://api-dashboard.search.brave.com/api-reference/web/search/get) | Web Search，extra snippets，日期区间、site 限制；中文映射为 `zh-hans` / `zh-hant` | [LLM Context](https://api-dashboard.search.brave.com/documentation/services/llm-context)，仅接受与目标 URL 完全匹配的提取片段；无匹配则失败，不能拿相关网页代替。响应明确标注正文可能不完整、不按原顺序且无法强制刷新 |

Fetch 每次读取一个公开域名网址，TinyFish / Exa 默认接受一小时内缓存。
正文最多返回 12,000 字符并提供 `nextOffset`（桌面正文缓存有效期内复用快照，过期后重新查询服务商）。
每次请求最多 60 秒、响应最多 4 MB。域名筛选在本地复核，域外结果不会作为匹配来源返回。
空搜索、HTTP 错误和单 URL 抓取失败分别处理，不能把失败解释为「未找到」。

`search` eval 套件包含 provider 专属场景：真实 AgentThread 和模型通过实际适配器消费固定 HTTP 响应，
覆盖高亮/摘要与原文差异、广告过滤、网页指令隔离、Tavily 部分失败与新鲜度限制、SerpAPI 限流、
以及 Brave 提取不完整/目标 URL 缺失、SerpAPI 不支持正文时的诚实性。它不消耗真实搜索额度，也不证明线上服务可用或调用延迟；
真实请求与耗时须在桌面宿主另行观测。

入口：[Provider 注册表](../../packages/agent/src/web/providers.ts)、
[工具](../../packages/agent/src/tools/web-tools.ts)、
[桌面端口](../../apps/web/src/features/ai/agent/ports/web-port.ts)、
[设置面板](../../apps/web/src/features/settings/components/SearchConfigPanel.tsx)。

主聊天使用 `smart` 模型角色，提炼、摘要等后台流程使用 `fast` 角色；实际模型和
账号由配置解析。推理通过宿主提供的网络传输访问远端服务；书籍数据与书内检索留在本机，
可选的公开网络检索按上述 Search / Fetch 配置执行。
取消、权限收紧、模型失败和后台排空由既有运行时处理，不能把请求受理当成保存成功。

画像和实体整理见 [画像与身份](./identity-and-profile.md)，上下文输出见
[上下文包](./context-bundles.md)，阅读快捷动作见
[阅读 AI 动作](../features/reading-ai-actions.md)，读者访谈见
[阅读建档](../features/onboarding.md)。

## 宿主与插件的边界

Agent 和插件消费同一套宿主业务能力，各自拥有独立权限和作用域。插件可以提供
工具、上下文和记忆候选，但不能直接访问数据库、操作系统或其他插件私有数据。
详细规则见 [插件系统](../plugins/plugin-system.md) 与
[能力模型](../capabilities/host-capability-model.md)。

## 验证与历史

当前能力接线查 [能力矩阵](../capabilities/host-capability-matrix.md)；剩余真实组合
场景查 [集中验收](../capabilities/host-capability-acceptance.md)。模型行为评测和桌面
操作验收是不同证据，任何一个都不能代替另一个。

[早期设计](../archive/designs/agent-architecture.md) 保留 SDK 选型、初始方案和迁移讨论；
其中“实现未开始”等状态只属于当时，不作为现在的待办。
