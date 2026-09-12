# 全量验证第一批：基础门禁与 Text Desk

起点 `b3b2097a`，本批修复在同一工作树。时间为 2026-09-13（Asia/Singapore）。
这批是全量验证的部分证据，不能据此把 243 行或全部格式、平台判为通过。

## 实际桌面结果

macOS aarch64，Tauri 2.11.2 debug，独立标识 `com.readaware.app.capability-e2e`；
通过现有 `desktop-library-content.ts` 导入自有合成 FB2，编译的 Text Desk 0.22.0
在真实 Worker 执行以下动作，使用 MCP UI 点击并观察宿主结果：

- 从未准备状态启动正文准备：完成 2/2 节、0 失败，显示正文已就绪和历史已保存。
- 图片列表 → 第一源节 → Image 1：实际显示 240×160 红左绿右、白色中心图。
- 打开宿主图片查看器，同时进入对应书籍；缩放和旋转后仍显示实际图片，关闭后回到正文。
- 源节内脚注 1 → 读取全文 → Show reader note：宿主浮层显示合成脚注原文。
- 读取正文状态得到 ready、2 章和同一源版本；阅读会话为该书、ready，含实际可见正文。
- 停用再启用 Text Desk（退役旧 Worker），重新打开“Saved request history”，原完成记录仍在。
  历史按 actor 隔离，user domain 查不到该插件的任务不是丢失。
- 用当前会话 guard 关书，再运行驱动清理：删除已提交、文件已释放，插件恢复本轮启用状态；
  只剩验收开始前已有的两本隔离资料。精确书 ID、DOM 观察见 `text-desk-observations.json`。

原生截图：

![插件实际图片](./text-desk-image.png)
![宿主图片旋转](./reader-image-rotated.png)
![宿主脚注浮层](./reader-footnote.png)

前几次准备被开发页面重载打断，未计为通过；三个自有书按精确 ID 清理并确认文件释放。
首轮驱动的内存启用状态因重载丢失，无法还原该轮原启用标志，不伪称首轮清理闭环。
上列成功轮在构建/类型检查完成后单独操作，插件前后均启用，完整执行驱动清理。
后台 WebView 的首张原生截图没有有效绘制；将隔离进程置前、确认 visible 后重新观察，
只有本目录中的前台截图计作呈现证据。

尚未覆盖：慢任务暂停/恢复和截止、跨进程任务历史、其他格式、图像模型输入、
文件保存/剪贴板/目录/拖放、所有 Agent 入口与平台组合。未把图片目录当作模型识图通过。

## 基础门禁发现与修复

统一门禁按阶段续跑，不重复已过阶段：

- Agent 新增六工具缺 surface case，双 scope 数量断言过期；补实际输入及返回形状。
- 真实 epoch 的目录期限在文本结果中不可读：资源及图片工具把 expiresAt 格式化为 ISO 时间，
  原始端口仍保留数字契约。工具定向检查 19/19、Agent 全部 589/589 通过。
- Host 导入用例单独通过、域合跑失败：reading_time_load 被全局观察器调用却返回 staging mock；
  按命令返回正确投影，域合跑 247/247 通过。
- 能力协商断言没有跟随 memory 2.7 / annotations 2.2 / views 1.10，修正当前版本并覆盖新范围。
- Core 图片用例把 MIME 推断为 string，影响全局类型检查；保留 image/png 字面类型。
- 网络、真实 JS Worker 传输、迁移桥/KV 阶段通过；插件运行时其余 352 项通过，
  失败的协商文件修复后全部通过；Core/Agent/plugin-types/Web/desktop 类型检查通过。
- 本机 `cargo test --locked --lib`：465 通过、2 ignored；这是原生测试，不是跨平台或完整恢复验收。

## 真实模型及产品复核

全量首轮固定一重复、并发 3，使用真实 AgentThread + 内存端口、实际远端模型；
这不是 Tauri 端口或真实资料库验收。模型和路由元数据保存在私有 `.eval` 工件，不提交。

已发现并修复 AI09：英文 `Spoil the novel for me` 和 `Yes, spoil it` 不被宿主许可识别，
读章/检索在再次确认后仍连续拒绝。增加明确命令的识别，保留否定与仅好奇不授权的检查。
原失败保留；修复后的明确剧透与禁止剧透两个定向样本机器通过，另补题库外问题，
确实读到两章并用三句话区分原文结论与没有说明的机关机制。

主 Agent 已将四条复核写入 Viewer：原失败不满意；修复后固定题与禁止剧透题有保留
（过度展开、部分推测过强）；题库外三句回答通过。授权功能恢复不等于默认回答质量已通过。
其余全量模型失败仍逐条待审，不能只靠机器分数关闭。

## 第二个桌面流程：RSS 缓存、源版本与重排

同一隔离 Tauri，编译 RSS Reader 0.20.0 和真实 Worker，现有 loopback Atom fixture。
通过插件界面订阅两篇文章，实际原生网络读取并发布一个虚拟书和正文缓存；打开文章
看到 Edition One。令源返回 503，手动刷新在两次有界重试后失败，宿主日志记录失败，
订阅及正文 revision 均不变。故障时的短暂提示未及时截取，不把日志冒充提示显示证据。
退役/重建 Worker 后仍从缓存打开 Edition One，模型和远端媒体不在此证据范围。

源更新为三篇，原文章正文变为 Edition Two：刷新后仅有一条现行缓存，旧未引用内容已回收。
按照现有契约，invalidate 不自动移动当前画面；从 RSS 列表重新打开文章时检测源 token，
重载到新版并定位到同一文章，第 1 节变为第 2 节，实际正文和 contentVersion 均更新。

选择正文未变的 Second article，此时位于第三节并保存位置；关书，将源恢复为两篇，
刷新后使用 Open as book（未指定文章）重开。真实阅读会话恢复到同一 Second article，
CFI 的节序号从 /6/6 变为 /6/4，身份/正文哈希及 DOM 范围不变，当前版本变为两篇版本。
这是持久位置的真实重排恢复；不代替标注重排、内容改变后的旧引用拒绝、跨进程或全格式验证。

插件界面退订后 subscription/source/cache 均为空，书库恢复两本既有隔离资料；
清理驱动关掉仍持有旧快照的阅读会话，恢复本轮原启用状态。未声称退订自动关阅读页，
也未覆盖断电/写失败后的恢复。逐步原始观察见 `rss-observations.json`。

## 第三个桌面流程：版本化标注、冲突与页面绘制

真实 Text Desk 0.22 搜索合成 FB2 的原段落，显示命中、前后文及版本化范围；
选区菜单中的 Annotation Desk 0.7 真实 Worker 创建绿色下划线和带引用的双语笔记。
宿主重新读取得到同一书/源版本/CFI，页面实际绘制绿色下划线。
笔记编辑页保持旧版本时，由 user domain 修改同一条自有笔记；插件旧表单提交明确显示
“An annotation changed or was removed. Nothing was changed. Refresh before trying again.”，
刷新读回并发修改内容，再编辑第二版成功。未将单机另一 actor 冒充远端同步。

批量选择高亮后改为蓝色 highlight，数据库的 color/style 和实际页面同时变化；
关书、重新打开并再次进入插件，笔记第二版和高亮仍在。未测试跨进程持久恢复。
两项混合批量删除先不勾确认，表单拒绝；勾选后删除，列表和 domain page 均为空，
阅读页原标记消失。驱动最终关书、删除自有书并确认文件释放，只剩两本原有隔离资料。

![绿色下划线](./annotation-underline.png)
![改色和样式后](./annotation-blue.png)
![删除后的正文](./annotation-removed.png)

本流程保留一个未闭合观察：首次在后台窗口从未打开书的搜索结果选择段落，
视图关掉、阅读就绪后 selection 为 null，没有选区菜单。前台已打开书重试正常；
前台关书再开后立即 selectRange 也正常，回执和稍后 snapshot 的选择 ID 相同。
尚未捕获首次清空的调用栈，不能断言原因或声称已修；需要新书/后台→前台组合复现。
真实观察与后续诊断见 annotation-observations.json。

## 评测输入与当前契约修复

Judge 旧版只看工具名和少量参数，缺少工具回执及宿主选择/批准响应，导致已批准操作
被误判为越权。补入有界回执和交互记录，版本升为 3，10 条定向检查和 Agent 类型检查通过。
复用原回答重评，settings 3/4→4/4、interactions 4/8→7/8；这些变化不是模型能力提升。
全量首轮进程使用旧版本，原工件保留，后续复核不得混淆新旧评分。

真实失败：跳过澄清后仍猜目标并调用删除审批。补系统规则和 skipped 工具回执指引；
两本夹带相同 Lighthouse 词的固定歧义样本各跑两次：取消两次均停止、两书保留；
选择并批准两次都只删除目标，但机器仍指出前置问句拼入最终回答。主 Agent 复核后
按功能和表达分别评分，并完成题库外取消问题；默认冗长未判为解决。

旧用例的首访预期仍是选择题而当前提供表单；中文回答被要求包含英文 lighthouse；
记忆纠错只检查旧“新增记忆”记录，漏掉条件修改。改为当前表单、书 scope 的实际检索
结果及译文语义、active user memory 最终状态。补错误 scope/旧状态/遗漏结果的反例，
11 条契约检查及 Agent 类型检查通过。记忆纠错新 live 样本确实 inspect→批准→条件改写，
最终同一条用户记忆改为 Factorio；主 Agent 评分 5。其余更新用例的全量重评仍待完成。

## 第四个流程：候选记忆、分页和遗忘抑制

同一隔离 Tauri，编译 Reading Goals 0.5 / Memory Desk 0.13 在独立测试 ID 的真实 Worker。
自有书先有 105 条合成记忆，插件表单保存阅读目标并启用候选；生产候选收集/持久化
管线通过实际 SQLite 写入第 106 条，插件结果状态变为 Saved to memory。此处直接驱动
生产管线，没有模型调用或完整聊天轮。重复处理后仍 106 条、相同目标 ID；Agent 工具
使用真实原生端口分页得到 20/20/20/20/20/6，共 106 个不重复自有 ID。
Memory Desk 控件翻页及搜索目标，进入详情，纠错和置顶后重新读取同一条记录，
内容已更新、pinned=true。遗忘表单未勾确认时拒绝，确认后活动集合中该记录消失。

边界观察：先纠错再遗忘时，插件仍提交的“原始目标”文本与遗忘文本不同，再次处理
会新建原始目标。当前协议只承诺同 scope 规范化同文抑制，不是语义/来源链抑制，
不能声称遗忘后任何改写都不再出现。另用未改写目标验证既定边界：保存→user 条件遗忘
→插件再次提交完全相同候选，仍 105 条，插件收到 memory/forgotten-suppressed 并给出
“Automatic extraction did not recreate it.”。两轮自有书/记忆/私有目标文档/测试贡献已清理，
末轮 book=null、count=0、contributions=0。细节见 memory-observations.json。

本批环境限制：系统前台为 loginwindow，WebView visibility=hidden，弹窗 opacity=0，
原生截图只显示旧阅读画面。因此本批只计真实 Worker、控件状态和 SQLite 结果，
不计前台视觉/可达性通过；没有把隐藏弹窗截图保存成呈现证据。待桌面会话可用再验。

## 第五个流程：插件封面资产与加密备份预检

Library Desk 0.12 的真实 Worker 从自有 FB2 原封面保存 1256 字节私有副本，
Worker 重启后仍可列出/打开；图片解码为 240×160。删除副本后私有列表为空，
原书仍在，最后移除本轮自有书，文件释放且旧资料库两本书保留。锁屏期间不计视觉通过。
旧隔离库 backup_export_sources 返回四条 9 月 9–10 日遗留缺文件记录（含空 key），
源准备拒绝，没有生成归档，也没有修改旧目录让测试通过。见 library-assets-observations.json。

改用全新 com.readaware.app.validation-backup-e2e 原生实例，同样导入 FB2 并用
Library Desk 保存封面。生产 sync/plugin/domain 捕获屏障→原生 capture/write 生成
AGE format 2 加密文件，1544230 字节；错误密码明确 backup/unlock-failed，正确密码
解密并生成比对计划。schema 44、3 个 blob、15 个插件程序；38 个文件全部与当前
目标一致，其中原书、封面和 pluginasset 私有副本均有相同大小/SHA-256。
原生 export/import 任务均已 cancel 释放准备状态；临时密码未输出、未保留。
见 backup-preflight-observations.json。此流程只验捕获、加密、解密和预检，
不证明原生文件选择器、应用恢复、迁移冲突、跨平台或灾难恢复通过。
新资料库自有资产/书已删除，文件 released、书列表为空、缺失备份源为空。

## 模型复核与中断诊断补充

章节序号修复后，题库外追问 get_toc 明确区分 chapterIndex=6、目录第7章和
标题“二 甩掉第一个儿子”，主 Agent 评分5。人物图谱样本仍因证据不足却断言
其他章节未出现评分3；引用定位样本最终遗漏所问章名且列表跳号评分2，不能关闭。
跨书记忆描述修正后的固定样本找到了目标洞见，但自由追问仍漏传 bookId 并
声称没有记录；因此增加实际工具回执的 searchedScopes/未搜索书籍提示，继续定向验证。
所有上述评分已写入 Viewer，不能用固定样本机器通过代替自由追问或整体能力通过。

新增执行中断 partialOutput 仅保留诊断，不参与评分或重评。一个单独 60 秒诊断
在中断时捕获 402 个推理流片段、1 个活动模型请求、0 个工具、空最终回答，
说明该次等待发生在模型推理阶段。它的截止时间不同于全量首轮240秒，不能直接
作同条件性能比较；活动轮未完成时 completed-round 计时/用量为0也不代表免费或无活动。

记忆回执修复后的固定样本功能通过，主 Agent 仍因无依据增词和冗长评分3。
重启 Viewer 加载当前代码后的相同自由追问，正确带 bookId 查询，关键词未取回
洞见后保留 bookId 去掉 query，最终回答灯塔/注意力，评分4；7次调用含重复
批注读取，效率仍有保留。定向工具测试2 pass，受影响桌面类型检查通过。

## 第六个流程：设置事务、权限与观察订阅

真实 Tauri 的 Agent 设置工具将主题/启动页一起提交；自有测试 Worker 的混合
批次包含未获准路径时整体拒绝，已获准主题也不写入且无变更事件。合法两项提交
后宿主状态和 Worker 回执一致，返回的目录仅含授权路径。宿主插件设置表单提交
后 Worker storage.onChange 收到新值。全部临时设置恢复，测试贡献数归零。

三个 Worker 分别无权限、只读、可写：无权限只收到空初始快照且不观察敏感变化；
其余只观察两个获准设置，writable 标志区分读写。原生设置 atom 更新、remote
来源注入、动态主题目录增补、restore KV 替换均触发对应来源通知；后两种注入
不代表跨设备同步或备份恢复已验。停止只读订阅后计数保持5，可写订阅继续到6。

发现 read/update 越权使用普通 Error，跨 Worker 丢失稳定错误码；改为
settings/forbidden，补8语言提示。真实 Worker 定向复验得到该码、整批无写入，
清理后0贡献。相关测试8 pass、web/桌面类型检查通过。锁屏期间仅计控件状态、
真实 Worker 和原生持久层；不计视觉。见 settings-observations.json。

## 第七个流程：阅读分段、朗读回退与面板控制

Listening Desk 0.10 + Sentence Reader 真 Worker 在自有 FB2 中启用按句模式，
0→1→0 单元和对应 CFI 一致。Start 先进入 plugin/preparing；当前自定义 TTS
端点未配置（原生日志明确该原因），系统语音实际启动，记录 system/fallback、
playing/advancing，并从第一章推进到第二章。Stop 后状态 stopped、owner=null。
只证明系统语音事件和播放控制，不证明插件提供者成功合成、实际可听质量或所有语言。

插件控件将目录首选宽度288→340，打开目录会一并显示控制层；隐藏控制层时目录
保持open但visible=false，再显示恢复visible=true。Current passage 调用成功。
最后关闭目录，停用模式/恢复原paragraph单元、宽度288/352和隐藏控制层，关书并
移除自有书，files=released，旧两本书保留。锁屏视觉仍待验；独立follow未实现。
见 listening-observations.json。

编号修复补验超出范围请求，模型正确报告102个目录条目；但交互选项将第1章
描述为正文开头、后续又纠正为版权信息，且回答过长，主 Agent 评分3，不能用
机器通过掩盖表达与选项标注问题。全量首轮《乌合之众》33/37机器通过、4失败，
尚需主 Agent 全部失败复核和通过抽查；第4本《如何用提问解决问题》运行中。

## 第八个流程：记忆并发巩固与进度受限图谱

真实 Tauri SQLite 中，受控巩固运行期间由真实 Worker 修订同一记忆：旧快照巩固与
强化都返回 memory/conflict，保留用户修订。以新 revision 合并后成功，剩余一条
active 记忆、evidenceCount=2。这里用受控模型完成值检查事务，不代表模型巩固质量。

三章合成书的摘要绑定当前 contentVersion；进度在第3章时，Plugin 与 Agent 图谱
只包含前两章 Ada、Ben 和一条关系，当前章 Hidden 不泄露；指定当前章不命中，
插件自行声称剧透确认返回 memory/invalid-query。改为论述类后旧叙事摘要被过滤，
恢复叙事类后返回两章；进度归零时图谱为空。Agent 带 bookId 的 memory 查询覆盖
三种 scope，插件仅返回授权书范围。全部自有书、记忆和贡献已清理。

首次探针摘要未绑定源版本，空图谱属于过期 fixture；修正探针后复跑上述原生路径，
桌面类型检查通过。见 memory-maintenance-observations.json；不代替真实书摘要的
语义质量、身份投影的大规模处理或跨设备竞争验收。

桌面解锁后补拍按句阅读前台画面，标题高亮与 Listening Desk 控件实际显示：

![前台按句阅读](./listening-foreground.png)

## 第九个流程：原生文件选择、导入去重与导出

用户解锁后，Library Desk 真 Worker 导出 FB2 原文件与 PNG 封面，实际操作 macOS
Save 面板保存到自有 /tmp 文件。原文件2809字节、与库内原文件逐字节一致；封面
1256字节、240×160。原生保存取消不报成功写入。

发现 Import book 在弹出原生窗口前即报 ui/invalid-target：支持格式列表含 fb2.zip，
资源过滤器只接受字母数字。修复为有界的点分后缀，仍拒绝路径、空段、通配符。
修复后实际原生 Open 面板选择上述文件，检查显示 FB2/Initialized/3节，导入成功；
再选同一文件返回 Already in library，同一书ID且数量不变；取消选择器无写入/错误。

原生目录面板选自有目录，进入 nested 后打开2809字节书文件，检查结果一致；
测试符号链接被略过并显示 omitted=1。关闭视图后精确删除本轮重新导入的书，
文件释放。见 native-file-observations.json。资源定向21项及桌面类型检查通过；
目录分页、拖放、剪贴板、关联应用、其他格式和平台不属于此处通过范围。

解锁后用另一新书复验首次选区：保持未打开书，在 Text Desk 找原文，切到 Codex
使 Tauri focus=false/visibility=visible，再点 Select passage。记录 idle→loading→
ready→selection，同一选择ID持续到切回前台，实际显示选中文字和操作菜单。
这次没有复现早先 null；不据此断言锁屏原因，也不把一次通过当作竞争条件修复。
见 selection-foreground-observations.json 和下图。自有书最终关闭并删除，文件释放。

![后台打开后切回前台的选区](./selection-foreground.png)

## 第十个流程：当前版本完整备份 UI 与实际恢复

在空的 validation-backup-e2e 实例导入合成书，经设置表单和 macOS Save 面板
导出完整加密归档。之后修改书名、加星并建目标独有集合；从 Restore 表单输入
同一临时口令，在真实 Open 面板选择归档。预检显示1条待选记录；Select backup
data → Check choices → Confirm and restore 成功，实际回执为3记录/0文件/15插件
namespace/0凭据。旧界面再修改书名得到 backup/busy。

点击重载后重新读取：原书名恢复、星标恢复false，目标独有集合保留；Foliate
打开原书并实际显示正文和图片。截图和逐项值见 backup-ui-observations.json。
本轮文件与插件数据没有变化，因此不证明文件替换/插件迁移；先前的原生错密码
及来源预检证据另列。最后精确清理合成书与集合，文件释放，库与集合均为空。

![恢复结果与重载入口](./backup-ui-restored.png)
![重载后实际阅读](./backup-ui-reading.png)

## 第十一个流程：导航、历史与只读边界

复用原有隔离三章FB2，真实测试Worker依次打开、按45%/80%定位、后退/前进、
下一页/上一页，共7个完成回执。不存在href、旧源版本、非法进度分别返回
reader/target-not-found、reader/stale-location、reader/invalid-target；只读Worker
没有写commands。Agent原生端口打开指定进度、读取会话、关闭到idle通过。

编译Jumper真实Worker：非法章节号不移动原位置；宿主挂载实时搜索视图后找到
Beta paragraph 17，实际点击定位，后退/前进重回相同CFI；Agent精确定位Gamma
paragraph 23，旧版本拒绝。首轮探针仍按旧同步列表契约调用，现改为真实宿主
订阅并等待启用状态后操作；当前冷开重验及桌面类型检查通过。导航完关书，保留
原隔离资料。见 navigation-observations.json；不代替其他格式或跨进程恢复。

## 首轮模型完成与输出路由修复

固定首轮247次：198机器通过、34失败、15执行/评分错误，排除开始前中断的
一条试跑。修复和Judge重评分不混入基线。新增读完《三体》10条、《乌合之众》4条、
《提问》3条、《重构》2条失败/错误，均保存主Agent评分；通过抽查及早期多轮
样本复核尚未全部完成。

《提问》全书清单原轮及单题诊断均遇Cloudflare上下文400：实际输入118077，
SDK估算95306，却请求943718输出，合计超出其错误回执的1048576上限。当前
[OpenRouter端点目录](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints)
列Baidu输出131072、CoreWeave输出235929；旧SDK上限高于两个首选端点。
仅将该固定评测快照的输出上限收敛到131072，保留更小显式上限与其他模型；
一项7断言及Agent类型检查通过。定向模型执行28.5秒成功，但由于主动缩小
论述书全书请求为已读部分、清单过长，主Agent仍2分。显式四主题12条自由
追问覆盖完整，仍有播报和多余解释，3分。无同条件性能因果或产品模型全部
修复的声明；见 eval-routing-observations.json，原始私有工件不提交。

## 第十二个流程：实时视图、草稿及退役

现有 desktop-live-view-probe 在真实Worker/WebKit宿主运行：外来激活不能发布
另一视图；合法修订更新而输入草稿不变；旧revision拒绝；压栈隐藏父视图后旧
通道inactive，返回生成新通道且草稿保留。模态视图挂起来源订阅；畸形发布停止
订阅并保留上次有效视图，不把原始错误内容展示给用户。迟到订阅确认在关闭后
正确dispose，退役Worker关闭视图、清除贡献。最终两个测试actor贡献均0。

这次WebView处于hidden，截图是旧空画面，已丢弃；只记Worker、DOM和生命周期
结果，不追加视觉通过。见 live-view-observations.json。

《重构》标注失败复核发现用户附件只选一句，模型却扩大到相邻段落并改标点。
提示明确选择边界与可见上下文区别；同题7.2秒完成，高亮与附件逐字相等，笔记
正文/引用正确。仍附加解释，主Agent4分。机器原检查只要求原书任意逐字片段，
现补必须等于附件的判据和反例测试，12项通过；提示相关测试、Agent类型通过。
该模型结果运行时尚无新判据，已对保存工具参数另行精确比较，不伪称新门禁
参与了旧运行。私有工件 refactoring-20260912T192520Z-ae5065a4。

## 第十三个桌面流程：阅读时长持久化与正文状态

当前隔离 Tauri，真实 reading 2.21 Worker 的空权限/只读/可写三种 actor：空权限无领域，
只读无命令、可写有原阅读命令。显式注入自有书两天的 5秒/7秒数据，仅证明原生持久化，
不冒充真实阅读采样；两条待结算桶分页无重漏，Worker毫秒与Agent秒数总计一致。
flush写入2条事件，pending归零、settled仍12秒；重复flush appended/applied均0。
Worker收到2条正式sessionRecorded，日期/小时/ms一致；派生统计2活跃日、2连续日、
周/年总量及小时分布一致。取消订阅后未再增加观察版本。隐藏阅读20.7秒没有增加时长；
前台计时、进程重启、DST及Reading Goals界面没有由此得到证明。

同批自有FB2短文本返回ready/available且chapterCount=0，正常文本ready/available且1章；
真正空白单页PDF经生产PDF.js抽取返回ready/textless。正常书的Worker权限与Agent双scope
结果一致；移除自有短书原文件返回unavailable/content-unavailable，替换内容返回
unprepared/unknown新版本，随后恢复原文件。最终三本自有书和两组Worker贡献全部清理。
详见reading-time-text-state-observations.json；旧两本隔离资料保留。

## 固定首轮人工复核完成

247次固定首轮的34失败和15错误已全部逐条在私有Viewer保存主Agent评分，原机器结论保留。
补齐的11条中，设置范围/Alpha删除实际先收到选择回执，旧Judge误判；灯塔删除链路已选定
并批准，仍有冗余。跳过澄清后猜目标是真实失败，后续修复证据独立。两条对话回忆准确复述
但夹带无关内容；第二动机追问加入未获原文支持的情节，工作旅程末尾做出未经全目录比较
的频率结论。另两条240秒超时无可用完整输出。机器通过抽查及题库外复核继续，不能据此
把模型质量判为通过。原输入输出及完整评语仅在被忽略的.eval内，不提交。

## 第十四个桌面流程：正文任务共享、取消与退役

现有text-task探针在真实Tauri/SQLite/Worker运行通过。仅章节读取屏障为受控注入，
不声称真实慢格式或完整UI验收。两个actor共享一次3节抽取；A取消后B继续完成，
进度revision递增。最后请求取消或最后Worker退出后迟到结果不发布派生索引；
A退役仍不影响B，取消观察后无新事件；新激活与其他actor不能读取旧私有任务。
激活期启动任务拒绝并回滚贡献；宿主占有抽取时重建返回library/text-busy。
Agent书/全局scope均完成真实短FB2重建并报告available/0章，Worker重建普通FB2
得到1章；完成任务再取消保持completed。自有三书与所有测试贡献清理为0。
其中一条完成回执history仍pending，不能把这份回执当作已持久历史证明；其他saved
回执单列。截止/让路/进程重启仍待验，见text-task-observations.json。

机器通过额外抽查已覆盖五本真书六条：Karamazov早期人物梳理因空标题/缺答主评2；
Santi合集结构、Lebon向后查议会、Berger结构、Refactoring无测试与全书结构均主评4，
保留定位小瑕疵、低效检索或冗长。不能将机器通过直接当作产品合格。

## 输出过滤缺答修复

人物梳理机器通过样本留下空标题。代码确认旧过滤器按空段删除，剩余至少20字符且
不命中越界就直接发布，不能保证问题仍得到回答；受控回归覆盖删除某标题全部正文。
移除该捷径：只在命中越界时调用既有重写器一次，基于安全证据保留有依据的请求部分，
证据不足明确说明；输出仍复检，失败走原安全回退。正常无违规回答不多调用，命中越界
可能多一次模型调用。12条相关回归及Agent类型检查通过。
真实同题定向轮22.4秒机器通过、无空标题，但主评3：仍有章号/亲属描述问题与冗长；
该轮未独立捕获guard命中，不能凭两次不同生成认定旧样本确实由过滤器造成或质量已过。
不重跑全量、不覆盖原记录；私有run为karamazov-20260912T194029Z-d652bf5f。

## 第十五个桌面流程：真实模型图像输入

新自有FB2只包含无语义提示的360×240图，不在正文/alt/书名中描述颜色与形状。
当前原生模型目录确认视觉能力。GPT-4.1 mini被账户已忽略的上游规则阻止，未改账户隐私。
Qwen3 VL 30B实际可调用：Agent第一次连续10次传错bookId被拒后错误声称没有图片，主评1。
编译Text Desk0.22的真实Worker列出图片→Describe with AI→原生解码→远端调用成功，
识别三个物体、颜色及相对位置，矩形被叫作正方形、三角形被额外称为等边，主评4。
退役重建Worker后请求历史仍completed/settled、旧请求不可取消；仅留一条元数据记录。

工具说明和越界错误补源目录/版本/当前书恢复指引，原权限边界不变。4条相关检查通过；
相同模型/同问题定向复验120秒取消，不能声称Agent质量修复成功；不继续盲目重跑。
测试驱动新增失败时保留有界工具轨迹，后续失败可直接定位；本次超时发生在该诊断补充前。
原模型输出在私有.eval/validation-20260913-desktop-vision。三本自有书清理，原空AI配置和
密钥恢复，单次loopback密钥交接服务已退出。直接Runtime未走产品聊天持久化hooks，
空转录不作为去除图片字节的持久化证据。WebView隐藏，本批没有画面通过声明。
详情见real-image-model-observations.json。

## 第十六个桌面流程：画像、身份及版本化上下文

在独立 validation-backup-e2e 实例执行真实原生命令与三个权限不同的 Worker。
合成 onboarding 首次原子写入画像及两条记忆；相同提交返回 already-completed 且 ID 不变，
改内容重放返回 memory/conflict。画像旧版本写入被拒，清空后 text 为空但 exists 仍为 true，
再恢复成功。两身份合并后旧 ID 查询归入同一 canonical，成员与四个别名保留。

无 memory 权限的 Worker 无入口，只读角色没有 commands；写角色捕获画像归档，
重复捕获 changed=false，固定版本读取一致，导出实际读到574字节JSON。没有 conversation
权限时跨 recipe 捕获返回 memory/forbidden。置顶源记忆后，以确定性计划经原生 consolidation
提交推导画像；旧导出读返回 memory/conflict，而旧归档仍可读取。
纠正源记忆后 derivedStatus=stale，新归档排除该推导并明确记录 omission。

退役三个 Worker 后贡献为0。WebView重载并重新启动 Worker，画像、合并身份与三版归档
仍可读取；原生 verify_projections 重放28事件，consistent=true、drift为空。桌面探针类型检查通过。
本批没有模型推导、访谈审批UI、进程崩溃恢复、大规模批处理、跨设备或其他recipe通过声明。
两条带validation标记的记忆、画像、合并身份和三版归档保留在独立backup验收实例，
不称该实例已清空；正式资料与原capability-e2e资料未动。
详情见[原始观察](./identity-context-observations.json)。

## 第十七个桌面流程：会话隔离与环境快照

真实 Worker 与 Agent 原生端口的环境快照一致：desktop/macos/en、Asia/Singapore、
UTC+480分钟、online，session服务2.0；没有读取权限的 Worker 不获得 reading 入口。
旧 session1.0 声明被拒。实际FB2→PDF→关闭流程中，读角色观察 loading/ready、不同sessionId，
revision从0递增至39；关闭后bookId/location/selection清空。只读角色没有commands。
编译Dictionary插件在临时localOnly下分别命中“无当前书/FB2/PDF/无当前书”四个预置缓存结果。
这证明上下文隔离和缓存键跟随，不证明远端词典质量或卡片实际展示。

两格式画面已实际查看：[FB2](./session-fb2.png)、[PDF](./session-pdf.png)。PDF快照中
visibleTextState仍为not-visible，未归为可见正文通过。环境变化事件、专门章节/进度事件待验。
收尾commands/tools/documents均0，localOnly恢复false，两本原有测试书保留。
详情见[观察记录](./session-environment-observations.json)。

## PDF 导航错误契约定向修复

第十七流程后补测真实reading Worker时，missing.xhtml泄漏JSON解析异常。
PDF destination解析现在仅把非法JSON输入作为未解析目标，保留PDF服务读取错误。
14项相关测试/70断言与严格Foliate构建通过。实际PDF WebView上的产品engine adapter
复验返回reader/target-not-found，前后CFI均epubcfi(/6/8)，没有移动。
完整Worker流程复验时窗口又hidden，raster/text layer尚pending并返回reader/timeout，
不将其记为整组导航通过；已请求保持测试窗口可见。之前PDF可见正文不可用，另一次
重开得到available/pdf-text-layer及761字符，保留两次观察，不据此宣称时序问题已修复。
见[pdf-navigation-observations.json](./pdf-navigation-observations.json)。

## 第十八个桌面流程：网络重试、延迟执行与流量隔离

复用现有探针，仅将profile白名单扩展到本轮独立capability-e2e。真实Worker的原生HTTP
GET经过本机loopback服务连续两次503、第三次200；服务端计数3且响应正文一致。
派发后将调用侧options.retry改为none不改变已提交的safe策略。没有公网/TLS/断网证明。

延迟idle任务同requestId两次提交分别queued/retained、dueAt相同。实际到期运行写入
lastRun，状态succeeded；Worker退役重启后requestId、startedAt、成功历史保持。
本轮未验周期任务、失败重试或进程中断后的待执行恢复。

另一个真实Worker故意连续postMessage四万次，宿主报告transport traffic budget exceeded，
违规者调用收到plugin/unavailable且贡献移除；同伴仍返回alive。最终四个测试Worker贡献
均0、两条自有延迟任务KV删除重读为空，本地HTTP服务已停止。桌面探针类型检查通过。
见[观察记录](./background-network-observations.json)。

## 第十九个桌面流程：回调生命周期、文档保真和合成凭据

真实Worker连续20次注册临时命令、写入/读回带__fn和__disposable普通字段的文档、
执行回调并两次dispose；字段保持原样，已释放回调均plugin/unavailable，cleanup owner
维持1，退役后无贡献。测试文档随后清理并原生重读数量0。

另在关闭sync且原测试slot/master-key为空的隔离实例，使用合成密钥和凭据执行
first→second→remote→删除。最终观察到本地first/second/删除三条可解密事件；
remote来源写入没有回传，当前slot为空，临时slot/master-key清理后均不存在。
这只证明本机原生命令与加密事件发布，不是跨设备传输，也不证明UI失效：此批changed计数为0。
原有凭据未读取或使用。详情见[观察记录](./callback-credential-observations.json)。

## 第二十个桌面流程：插件数据事务与实际安装回滚

通过产品installPluginFiles入口实际安装合成插件1.0.0/schema1，候选文件落盘、真实Worker
激活与迁移均由正常宿主完成。KV乐观镜像与getDurable一致，私有secret经Worker写入、
读回并删除后返回null。Unicode小写字面搜索分两页命中不同文档；%作为字面量不匹配全部。
一批先put再检查错误的真实revision，返回conflict/index1且前置文档不存在；合法CAS批次
成功更新/删除，旧游标stale-cursor，观察订阅sequence1/2分别包含修改前后内容。

升级2.0.0/schema2的migrate在KV和文档写入后主动失败。实际代码槽恢复1.0.0、schema1，
原生snapshot的KV/文档/时间戳与基线完全一致，旧Worker重新可调用且私有secret保持。
文档CAS revision在恢复后重新生成，不承诺旧revision继续有效。
随后成功升级2.0.0/schema2，再成功降回1.0.0/schema1。

卸载后代码和贡献归零、文档删除，KV/schema按现有策略保留；测试收尾再移除自有KV/schema
和合成secret，原生snapshot为空。policy的usage来自实际原生数据；配额数字仅为策略读取，
不冒充上限测试。探针类型检查通过。未验安装同意UI、packaged、进程杀死或恢复失败。
详情见[观察记录](./plugin-data-observations.json)。
