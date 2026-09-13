# 第81项：8行已有证据对账（只读）

2026-09-13。范围固定为 AI07、AI08、AI10、AI11、AI12、ANN06、ANN07、CON01。
依据[矩阵](../../host-capability-matrix.data.ts)、[模型](../../host-capability-model.data.ts)、
[本轮记录](./README.md)和下列原始记录核对；没有运行新模型、桌面探针或测试，
没有改共享账本/覆盖清单。当前清单的“待验”不能解释为零证据；本报告也不关闭整行。
第81项是证据对账编号，不是新增桌面验收流程。

| 行 | 可以直接复用的证据与准确边界 | 尚缺的最小验收步骤 |
| --- | --- | --- |
| AI07 | 第59流程[Responses记录](./responses-protocol-observations.json)：实际 ChatPanel Stop → 原生HTTP服务取消，SQLite没有成功回答，迟到响应不交付；第46流程[隐私记录](./ai-reading-privacy-observations.json)：权限收紧终止实际 Agent/Worker 流。第15流程[真实图片模型记录](./real-image-model-observations.json)：编译 Text Desk 0.22 → 原生解码 → Qwen成功，Worker重启后 completed/settled 历史仍在且旧请求不可取消。 | 不重做聊天Stop和已完成请求的Worker重启。沿现有 Text Desk/推理探针补一次调用预算耗尽、超时，以及运行中退役/进程中断后的历史和不可恢复取消权；核对实际用量、未知费用显示和持久回执。120秒评测驱动终止不是插件默认超时证明；现有记录没有证明提供者实际账单、跨重试总预算或前台费用显示。 |
| AI08 | 第46流程实际 Tauri AgentRuntime/AgentThread + native HTTP 四种选区/viewport外发组合及撤权取消通过；这是自动上下文进入请求的证据，回答为固定文本。第36流程[发布包选区记录](./packaged-selection-shortcuts-observations.json)可复用实际选区进入聊天引用的界面边界。插件受限上下文贡献另有 AI11 的 Worker→请求证据。 | 复用同一自有书，实际书内聊天核对当前书/游标章与选区来源，切换书后旧上下文不串入；有选区/无选区各一次即可组合验证。第46探针显式构造输入，不能独自证明真实读者手势→全部自动grounding。需要模型语义判定时只补此组合的短题，不重跑全套隐私开关。 |
| AI10 | 第77流程[Agent卡片记录](./agent-card-observations.json)：真实挂载聊天 → AgentThread → 编译 Dictionary 1.4.0 Worker lookup_word → 结构化LLM服务 → 原生parts持久化/重载。工具选择及回答来自受控loopback，不是模型自主决策。[9月9日刷新记录](../agent-tool-refresh-2026-09-09.json)另证明实际Worker注册/状态RPC、每次模型请求刷新、旧注册退役拒绝；其会话端口是内存、推理为脚本。 | 不重复词典lookup正向链路或同名注册退役探针。若验收目标要求模型自主使用实际编译插件，仅补一个真实模型词典请求；用当前安装插件补scope不可见/停用后目录消失时可同时覆盖CON01。发布包调用与debug第77分开记录。 |
| AI11 | 第48流程[记忆开关记录](./memory-build-policy-observations.json)：已安装编译Reading Goals 0.5.0真实Worker，在buildMemory关闭时chat请求仍goal:true；开启后新轮继续携带目标。原生HTTP是真实链路，响应/提炼受控；turns:0明确不证明聊天历史持久化。第4流程已证明目标表单→原生文档/候选持久化。 | 在已有目标上复用两个书scope的聊天请求，核对只有本书目标并保留来源；修改目标后下一轮读到新值，停用后不再贡献。预算/来源约束的测试不能代替这一编译插件组合，也不要求重做候选提炼/遗忘全流程。 |
| AI12 | [Dictionary实现](../../../plugins/dictionary/src/agent-tools.ts)确有saved-vocabulary，声明book/global，并按query过滤后slice(limit)。[adapter测试](../../../apps/web/src/features/plugins/runtime/plugin-tools.test.ts)包含旧检索注册退役/同ID替换拒绝；9月9日刷新记录明确其原生探针只测agentTools，检索退役仅为单测。第77lookup_word不是retrieve工具。 | 最小新增链路：在实际编译Dictionary保存一条自有词，真实Agent回合调用自动生成的retrieve工具，核对来源、命中/不命中及limit；停用后旧工具不能执行。受控工具选择可先关闭传输边界，真实模型是否能选对检索工具另判。在本次有界证据集内尚未找到可直接替代此链路的Tauri记录。 |
| ANN06 | [9月10日标注契约记录](../annotation-contract-v2-2026-09-10.json)的askProbe：真实SQLite/WebKit Worker读取/按所见revision删除ask，missing/wrongKind均annotations/not-found；只读Worker无commands、插件无createAsk；真实Agent工具/交互端口decline保留、approve删除。批准是程序作答；本轮第3流程只删高亮/笔记，不能算ask专项。 | 复用既有端口和Worker结果，只补实际聊天批准界面：读取一条自有ask → 拒绝保留 → 批准删除 → 原生重读及界面一致。可与ANN07自然生成的记录合并，避免再造一套标注数据。 |
| ANN07 | [既有探针](../../../apps/web/tests/desktop/desktop-annotation-probe.ts)通过agent domain直接createAsk造数；它没有经过轮末自动记录。[生产thread](../../../packages/agent/src/runtime/thread.ts)轮末在book scope调用recordAsk，锚优先选区、其次游标，这是实现证据。第78流程ask_user/ask_user_form是模型向用户提问的交互，不能证明书内ask轨迹。 | 实际完成一个有选区书内回合和一个无选区回合，原生按kind:ask重读问题文本、书ID和选区/游标锚；关书重开确认。随后复用其中一条做ANN06批准删除。全局回合不新增书内ask可复用已有全局聊天环境作差量观察。当前公开JSON没有记录这些ask专项结果，不能仅凭聊天成功推断已验。 |
| CON01 | 第20流程[安装数据记录](./plugin-data-observations.json)证明实际installPluginFiles/Worker/schema迁移回滚；9月10日契约记录证明实际协商helper拒绝annotations ^1.4.0，但明确不是安装UX。第56流程[目录记录](./plugin-directory-observations.json)证明安装清单/贡献状态与停用变化，不能替代get_host_capabilities。第80[发布包记录](./external-resource-observations.json)已有编译Library Desk运行与卸载；安装同意详情已落入JSON，见下。 | 不重做正向安装同意。补真实Agent get_host_capabilities的host/tools分页并与当轮scope/插件状态核对，停用/恢复一项时旧revision重读；版本/依赖不满足的实际安装拒绝只需复用既有协商夹具接安装入口。正向UI不能证明拒绝或版本不兼容组合。 |

## 第80流程已落档的边界

主代理在本次对账中确认：实际CUA release安装页显示Library Desk 0.12.0、作者
ReadAware，权限包括Manage library、Control reading、Clipboard、Agent tools以及
read/change shelf.layout/sort/group；点击Install后列表出现0.12.0、Enabled on，
并显示installed and enabled。随后编译插件调用原生关联打开进入TextEdit，第一次
安装已经通过Uninstall确认还原6个builtin。第二次安装的退出清理复验也已成功并卸载。
第80 JSON的installationConsent已记载上述字段；退出修复与清理见exitFixRun。
没有专测安装拒绝、依赖失败或版本不兼容。

## 机器模型结果如何复用

只读核对私有run `tools-20260912T173231Z-74919641` 中两个样本：
`global-plugin-tool`机器通过；`book-hides-global-plugin-tool`整体失败，但
“未暴露/未执行禁用工具”两项通过，失败来自冗长与无根据的安装推测。
它们通过[eval夹具](../../../packages/agent/src/evals/suites/behavior/tools.ts)
直接注入`deps.extraTools`，不是编译插件Worker或SQLite安装证据，不将其拼接成
“真实模型已用实际Dictionary”的结论。原始回答、请求和评分留在私有.eval，不复制全文。

优先顺序：ANN07→ANN06合并一组；Dictionary retrieve与CON01目录/停用合并一组；
AI11与AI08的双书/新轮上下文合并一组；AI07只补未覆盖的推理回执边界。
已经有效的证据不重跑，是否还有发布包/模型语义要求继续服从固定全量goal，
不因本对账新增其他平台、模型矩阵或通用框架。

## 第85流程的后续闭合

上表为只读对账时点；随后已完成[实际聊天ask组合](./annotation-ask-chat-observations.json)：
ANN07有选区/无选区两回合的书ID、问题、章节与选区/游标CFI原生核对一致，
关书重开不变；ANN06复用首条ask，真实ChatPanel的Keep it保留、Delete annotation
删除、Notes列表与原生结果一致。由受控Responses服务选工具，不能计真实模型
自主语义或发布包/物理焦点；没有重跑旧Worker/端口测试。上述最小聊天边界不再待验。
