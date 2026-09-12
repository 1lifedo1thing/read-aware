# 全量能力验证

起点：main b3b2097a；2026-09-13 开始。当前共 243 行，表中的待验是排队状态，不是通过。
按行记录实际范围；一个场景通过不能自动证明整行的所有 actor、格式和平台。
机器评测工件保存在私有 .eval/validation-20260913，不提交、不外发。

## 组合流程与验收依据

| 流程 | 用户操作及结果 |
| --- | --- |
| F1 | Library Desk 导入、查原书/封面、集合与删除；检查 SQLite 和自有文件释放 |
| F2 | Text Desk 准备/暂停/恢复/历史、搜索、定位、脚注和图片；真实 Worker 和源书结果 |
| F3 | Jumper/Annotation/Listening Desk 阅读导航、模式与朗读、版本化标注、时长；观察页面和持久状态 |
| F4 | 真实 AgentThread 问答、批准、图像输入、取消与持久历史；机器评分及主 Agent 逐条复核，另验 Tauri |
| F5 | Memory Desk 记住/纠错/遗忘/巩固、身份与画像、摘要及 bundle；条件写和重新读取 |
| F6 | Settings Desk 与实际设置界面修改/继承/重置；观察受影响 UI、授权与重启结果 |
| F7 | RSS/Dictionary 和插件安装/升级/撤权/故障恢复；数据、Worker 生命周期和真实消费者 |
| F8 | 文件/目录/拖放/外部应用、网络、备份恢复/诊断/同步；原生回执及重读，外部环境单列 |

支持边界：macOS aarch64 debug Tauri。跨平台、全格式、打包 CSP、跨设备及远端服务必须各有证据。
CON11/CON12 等明确不开放的能力和 SYS18 遗留移动桥依据现有产品边界审定不适用，不作为新增产品要求。
READ16 独立跟随、EXT06 富文本编辑、MORE02 跨插件因果防环及 MORE06 任意跨插件调用语义仍未实现/未定义；已有子能力继续验证。

## 逐行覆盖

| ID | 能力 | 主流程 | 当前结果与证据 |
| --- | --- | --- | --- |
| LIB01 | 枚举/查询书籍与书目元数据 | F1 | 待验 |
| LIB02 | 修改标题/作者 | F1 | 待验 |
| LIB03 | 收藏/取消收藏 | F1 | 待验 |
| LIB04 | 删除单本书 | F1 | 待验 |
| LIB05 | 批量删除书籍 | F1 | 待验 |
| LIB06 | 导入已有支持格式的书籍字节 | F1 | 本机 FB2 导入通过；其他格式/各 actor 待验 |
| LIB07 | 识别格式/DRM/损坏文件并报告 | F1 | 待验 |
| LIB08 | 查询/读取书籍原文件与本地可用性 | F1 | 待验 |
| LIB09 | 提取/显示封面与封面可用状态 | F1 | 待验 |
| LIB10 | 缺失封面/元数据后台补齐 | F1 | 待验 |
| LIB11 | 重复检测、同源书合并和 ID 重定向 | F1 | 待验 |
| LIB12 | 创建/幂等绑定虚拟书并更新标题 | F1 | 待验 |
| LIB13 | 移除插件自有虚拟书 | F1 | 待验 |
| LIB14 | 虚拟内容修订/离线缓存/当前书刷新 | F1 | 待验 |
| LIB15 | 列出集合及其成员 | F1 | 待验 |
| LIB16 | 创建/重命名集合 | F1 | 待验 |
| LIB17 | 删除集合 | F1 | 待验 |
| LIB18 | 批量分配/移出集合 | F1 | 待验 |
| TXT01 | 读取抽取章节目录 | F2 | 待验 |
| TXT02 | 读取原书分层导航目录及 href | F2 | 待验 |
| TXT03 | 按抽取章节读正文/分段 | F2 | 待验 |
| TXT04 | 查询本地正文准备状态与文本存在性 | F2 | 本机 Text Desk 未准备→ready/2章通过；其他状态待验 |
| TXT05 | 启动、重建、暂停让路正文抽取 | F2 | 本机准备→完成→Worker重启后持久历史通过；暂停/恢复/截止等待验 |
| TXT06 | 当前书及跨书多查询正文检索 | F2 | 待验 |
| TXT07 | 引擎全文精确搜索并返回 CFI | F2 | 待验 |
| TXT08 | 搜索分页、取消、背压和过期查询淘汰 | F2 | 待验 |
| TXT09 | 读取当前可见文本/阅读游标 | F2 | 待验 |
| TXT10 | 选区附近句段上下文 | F2 | 待验 |
| TXT11 | 书内脚注/链接目标解析与预览 | F2 | 本机 FB2 真实Worker列举/读脚注/宿主浮层通过；其他格式待验 |
| TXT12 | 书内图片读取与灯箱缩放预览 | F2 | 本机 FB2 插件图像及宿主缩放/旋转通过；模型/其他格式待验 |
| TXT13 | 统一位置/范围解析、校验、版本与失效 | F2 | 待验 |
| READ01 | 打开书/恢复保存位置 | F3 | 本机从图片查看动作打开对应书并就绪通过；恢复/其他入口待验 |
| READ02 | 关闭当前书并返回书架 | F3 | 本机guard关书通过；各actor消费者待验 |
| READ03 | 按章节/标注/href/CFI 跳转 | F3 | 待验 |
| READ04 | 前后翻页、章节、书首书尾 | F3 | 待验 |
| READ05 | 按进度/固定版式页索引定位 | F3 | 待验 |
| READ06 | 导航历史 back/forward 及可用性 | F3 | 待验 |
| READ07 | 统一当前书/位置/加载/历史快照 | F3 | 本机ready会话/版本/可见正文观察通过；跨书变化待验 |
| READ08 | 会话开关/章节/进度事件 | F3 | 待验 |
| READ09 | 阅读沉浸/显示隐藏控制层 | F3 | 待验 |
| READ10 | 目录/注释/外观/聊天面板开关 | F3 | 待验 |
| READ11 | 阅读面板尺寸/布局与焦点恢复 | F3 | 待验 |
| READ12 | 固定版式自动适配；图片缩放/平移/旋转 | F3 | 待验 |
| READ13 | 读取/建立/清除文本选区 | F3 | 待验 |
| READ14 | 临时范围强调/搜索标记及释放 | F3 | 待验 |
| READ15 | 贡献句子/段落等分段模式 | F3 | 待验 |
| READ16 | 启停模式/上下一单元/跟随/回当前 | F3 | 待验 |
| READ17 | 列声音并合成音频的提供者 | F3 | 待验 |
| READ18 | 开始/停止朗读、播放位置与 fallback 状态 | F3 | 待验 |
| READ19 | 完成页、标记读完/撤销读完 | F3 | 待验 |
| READ20 | 跨书/并发导航的取消、序列化与回执 | F3 | 待验 |
| ANN01 | 列出/按书按词按类型检索标注 | F3 | 待验 |
| ANN02 | 创建高亮 | F3 | 待验 |
| ANN03 | 创建下划线样式 | F3 | 待验 |
| ANN04 | 高亮改色/删除 | F3 | 待验 |
| ANN05 | 创建/编辑/删除笔记 | F3 | 待验 |
| ANN06 | 读取/删除 ask 问题轨迹 | F3 | 待验 |
| ANN07 | 自动记录书内问题轨迹 | F3 | 待验 |
| ANN08 | 按 ID 读取、分页、批量/版本冲突标注操作 | F3 | 待验 |
| ANN09 | 标注变化与远端失效观察 | F3 | 待验 |
| STAT01 | 单书/全库/总览已结算阅读统计 | F3 | 待验 |
| STAT02 | 周月年/连续阅读/热图/时段/成就派生 | F3 | 待验 |
| STAT03 | 已持久的未结算时长/会话与采样时钟 | F3 | 待验 |
| STAT04 | 计时/位置累积、小时结算和重启恢复 | F3 | 待验 |
| STAT05 | book.sessionRecorded 正式事件 | F3 | 待验 |
| UI01 | 书架/Agent/统计/设置与集合页面导航 | F6 | 待验 |
| UI02 | 命令面板搜索/书架布局/排序/分组/多选 | F6 | 待验 |
| UI03 | 发现/执行宿主命令与可用条件 | F6 | 待验 |
| UI04 | 快捷键查询、重绑、冲突与重置 | F6 | 待验 |
| UI05 | 菜单可见/溢出位置及自定义重排 | F6 | 待验 |
| CFG01 | 设置 discover/read/update 与动态选项 | F6 | 待验 |
| CFG02 | 全局/本书/全书阅读设置覆盖 | F6 | 待验 |
| CFG03 | 清除覆盖/恢复默认/查询值来源 | F6 | 待验 |
| CFG04 | 阅读对齐 reading.textAlign | F6 | 待验 |
| CFG05 | 固定版式颜色 reading.fixedLayoutColor | F6 | 待验 |
| CFG06 | 更新内容弹窗 general.whatsNewDialog | F6 | 待验 |
| CFG07 | AI 提供商/端点/密钥配置 | F6 | 待验 |
| CFG08 | 模型目录刷新、连接测试与模型能力 | F6 | 待验 |
| CFG09 | 插件非敏感设置的动态路径 | F6 | 待验 |
| CFG10 | 设置变化事件/外部写入刷新 | F6 | 待验 |
| CFG11 | 聊天/笔记内容字体：跟随阅读或独立字号/字体/行距 | F6 | 待验 |
| CFG12 | 新标注默认颜色 | F6 | 待验 |
| CFG13 | 软件更新通道 stable/beta | F6 | 待验 |
| SET01 | general.startView | F6 | 待验 |
| SET02 | general.language | F6 | 待验 |
| SET03 | general.crashPrompt | F6 | 待验 |
| SET04 | general.launchAtStartup | F6 | 待验 |
| SET05 | general.fileAssociations | F6 | 待验 |
| SET06 | general.autoUpdate | F6 | 待验 |
| SET07 | appearance.theme | F6 | 待验 |
| SET08 | appearance.motion | F6 | 待验 |
| SET09 | reading.theme | F6 | 待验 |
| SET10 | reading.fontFamily | F6 | 待验 |
| SET11 | reading.fontSize | F6 | 待验 |
| SET12 | reading.fontWeight | F6 | 待验 |
| SET13 | reading.lineSpacing | F6 | 待验 |
| SET14 | reading.paragraphSpacing | F6 | 待验 |
| SET15 | reading.pageMargins | F6 | 待验 |
| SET16 | reading.readingMode | F6 | 待验 |
| SET17 | reading.fixedLayoutReadingMode | F6 | 待验 |
| SET18 | ai.preferences.features.explainSelection | F6 | 待验 |
| SET19 | ai.preferences.features.defineTerm | F6 | 待验 |
| SET20 | ai.preferences.features.translate | F6 | 待验 |
| SET21 | ai.preferences.features.summarizeChapter | F6 | 待验 |
| SET22 | ai.preferences.features.askConversation | F6 | 待验 |
| SET23 | ai.preferences.buildMemory | F6 | 待验 |
| SET24 | ai.preferences.sendHighlightedText | F6 | 待验 |
| SET25 | ai.preferences.sendSurroundingContext | F6 | 待验 |
| SET26 | ai.preferences.localOnly | F6 | 待验 |
| SET27 | ai.preferences.followStreaming | F6 | 待验 |
| SET28 | ai.connection.configured | F6 | 待验 |
| SET29 | ai.connection.credentialConfigured | F6 | 待验 |
| SET30 | menus.primaryNav.visible | F6 | 待验 |
| SET31 | menus.primaryNav.overflow | F6 | 待验 |
| SET32 | menus.shelfHeader.visible | F6 | 待验 |
| SET33 | menus.shelfHeader.overflow | F6 | 待验 |
| SET34 | menus.readerHeader.visible | F6 | 待验 |
| SET35 | menus.readerHeader.overflow | F6 | 待验 |
| SET36 | menus.selection.visible | F6 | 待验 |
| SET37 | menus.selection.overflow | F6 | 待验 |
| SET38 | ai.connection.provider | F6 | 待验 |
| SET39 | ai.connection.primaryModel | F6 | 待验 |
| SET40 | ai.connection.fastModel | F6 | 待验 |
| SET41 | ai.connection.thinkingLevel | F6 | 待验 |
| SET42 | ai.connection.fastThinkingLevel | F6 | 待验 |
| SET43 | ai.connection.custom.endpointConfigured | F6 | 待验 |
| SET44 | ai.connection.custom.api | F6 | 待验 |
| SET45 | ai.connection.custom.supportsThinking | F6 | 待验 |
| SET46 | ai.connection.custom.maxOutputTokens | F6 | 待验 |
| SET47 | reading.textAlign | F6 | 待验 |
| SET48 | reading.fixedLayoutColor | F6 | 待验 |
| SET49 | general.whatsNewDialog | F6 | 待验 |
| SET50 | appearance.contentTypography.followReader | F6 | 待验 |
| SET51 | appearance.contentTypography.fontFamily | F6 | 待验 |
| SET52 | appearance.contentTypography.fontSize | F6 | 待验 |
| SET53 | appearance.contentTypography.lineSpacing | F6 | 待验 |
| SET54 | annotations.defaultColor | F6 | 待验 |
| SET55 | general.updateChannel | F6 | 待验 |
| SET56 | shelf.layout | F6 | 待验 |
| SET57 | shelf.group | F6 | 待验 |
| SET58 | shelf.sort | F6 | 待验 |
| SET59 | shortcuts.search | F6 | 待验 |
| SET60 | shortcuts.settings | F6 | 待验 |
| SET61 | shortcuts.new-conversation | F6 | 待验 |
| SET62 | shortcuts.next-page | F6 | 待验 |
| SET63 | shortcuts.prev-page | F6 | 待验 |
| SET64 | shortcuts.next-chapter | F6 | 待验 |
| SET65 | shortcuts.prev-chapter | F6 | 待验 |
| SET66 | shortcuts.toggle-controls | F6 | 待验 |
| SET67 | shortcuts.reader-mode-next-unit | F6 | 待验 |
| SET68 | shortcuts.reader-mode-prev-unit | F6 | 待验 |
| SET69 | shortcuts.selection-copy | F6 | 待验 |
| SET70 | shortcuts.selection-highlight | F6 | 待验 |
| SET71 | shortcuts.selection-underline | F6 | 待验 |
| SET72 | shortcuts.selection-add-note | F6 | 待验 |
| SET73 | shortcuts.selection-look-up | F6 | 待验 |
| SET74 | shortcuts.selection-ask-ai | F6 | 待验 |
| AI01 | 读取书内/全局对话及搜索历史 | F4 | 待验 |
| AI02 | 创建/切换/清空全局线程和书内聊天 | F4 | 待验 |
| AI03 | 发送/流式生成/停止/重试聊天回合 | F4 | 待验 |
| AI04 | 提问、选项澄清、批准/拒绝高风险动作 | F4 | 待验 |
| AI05 | Agent 展示可点击书卡与词典卡 | F4 | 待验 |
| AI06 | 一次性文本/结构化/流式 LLM 推理 | F4 | 待验 |
| AI07 | 推理取消、超时、用量/预算/成本可见性 | F4 | 待验 |
| AI08 | 书内 scope/游标/选区自动 grounding | F4 | 待验 |
| AI09 | 剧透边界、请求允许超前内容 | F4 | 首轮失败已修复；2个定向模型样本通过，产品复核仍有保留；Tauri待验 |
| AI10 | 注册供模型使用的插件工具 | F4 | 待验 |
| AI11 | 每轮上下文 provider | F4 | 待验 |
| AI12 | 按需插件检索 provider | F4 | 待验 |
| MEM01 | 查询长期记忆 | F5 | 待验 |
| MEM02 | 显式记住事实/偏好 | F5 | 待验 |
| MEM03 | 轮后抽取/去重/强化记忆 | F5 | 待验 |
| MEM04 | 记忆巩固、修订/替代/遗忘 | F5 | 待验 |
| MEM05 | 用户反馈记忆质量/纠错 | F5 | 待验 |
| MEM06 | 读取用户画像并注入上下文 | F5 | 待验 |
| MEM07 | Onboarding 访谈写入画像 | F5 | 待验 |
| MEM08 | profile.updated / entity.resolved / entity.merged 投影 | F5 | 待验 |
| MEM09 | 叙事性分类/重分类与图谱风格 | F5 | 待验 |
| MEM10 | 完成章节摘要、人物/概念图生成与补齐 | F5 | 待验 |
| MEM11 | 检索书内人物/关系/概念图 | F5 | 待验 |
| MEM12 | 跨对话 insights 与滚动摘要 | F5 | 待验 |
| MEM13 | 可版本化导出 context bundle | F5 | 待验 |
| EXT01 | 选择菜单动作/lookup/标注入口 | F7 | 待验 |
| EXT02 | 书架与阅读 header menu 入口 | F7 | 待验 |
| EXT03 | 插件页面/对话框/视图结果与栈导航 | F7 | 待验 |
| EXT04 | 列表、搜索、详情、Markdown、blocks 组合 | F7 | 待验 |
| EXT05 | 表单输入、动态选项、验证与提交 | F7 | 待验 |
| EXT06 | 大列表分页/虚拟化、Tree/Table/编辑器/图像资源 | F7 | 待验 |
| EXT07 | Toast、持久错误、进度/取消/确认交互 | F7 | 待验 |
| EXT08 | 应用/阅读主题和字体贡献 | F7 | 待验 |
| EXT09 | 词典查询/收藏/复习列表/CSV 导出 | F7 | 待验 |
| EXT10 | RSS 订阅/刷新/退订/OPML/阅读文章 | F7 | 待验 |
| EXT11 | 本地 marketplace 插件清单与启用状态 | F7 | 待验 |
| EXT12 | 安装/授权/启停/更新/回滚/卸载插件 | F7 | 待验 |
| SYS01 | 插件隔离 KV 同步读与异步持久写 | F8 | 待验 |
| SYS02 | 插件私有文档 CRUD/搜索/分页/条件事务 | F8 | 待验 |
| SYS03 | 插件 schema 迁移/快照/更新回滚 | F8 | 待验 |
| SYS04 | 插件自有 secret get/set/remove | F8 | 待验 |
| SYS05 | 插件数据导入导出/配额/同步策略 | F8 | 待验 |
| SYS06 | 原生网络 HTTP 请求与响应 | F8 | 待验 |
| SYS07 | 网络域名授权、预算、下载流和离线重试 | F8 | 待验 |
| SYS08 | 剪贴板写文本 | F8 | 待验 |
| SYS09 | 图片复制/导出原生图片资源 | F8 | 待验 |
| SYS10 | 保存文本/二进制文件与取消回执 | F8 | 待验 |
| SYS11 | 用户选文件/目录、拖放和流式文件句柄 | F8 | 待验 |
| SYS12 | 打开外部 URL/系统关联打开/深链接路由 | F8 | 待验 |
| SYS13 | Blob 范围读取/流式读写/提交/中止 | F8 | 待验 |
| SYS14 | 系统字体枚举和字体资产加载 | F8 | 待验 |
| SYS15 | 原生日志/诊断包/崩溃报告导出与发送 | F8 | 待验 |
| SYS16 | 检查/下载/安装更新与重启 | F8 | 待验 |
| SYS17 | 窗口最小化/最大化/全屏/关闭/标题栏 | F8 | 待验 |
| SYS18 | Android/iOS 遗留桥：状态栏/安全区/音量键/商店 | F8 | 待验 |
| OPS01 | 同步连接/断开/立即同步/状态与积压 | F8 | 待验 |
| OPS02 | 事件/Blob E2E 加解密、游标、去重/确认与重试 | F8 | 待验 |
| OPS03 | 检查点/投影恢复/事件历史回填 | F8 | 待验 |
| OPS04 | WebDAV 等自定义密文 transport | F8 | 待验 |
| OPS05 | 偏好漫游/远端合并后的 UI 失效 | F8 | 待验 |
| OPS06 | 账号登录、连接 token、退出、删除账号 | F8 | 待验 |
| OPS07 | 套餐/用量/购买/账单管理 | F8 | 待验 |
| OPS08 | 备份导出与合并导入 | F8 | 待验 |
| OPS09 | 删除本地全部数据 | F8 | 待验 |
| OPS10 | 数据目录显示/Reveal | F8 | 待验 |
| OPS11 | 事件写入、重建/验证投影、历史 genesis | F8 | 待验 |
| CON01 | 能力发现/版本/权限/依赖与安装同意 | F7 | 待验 |
| CON02 | 对象级授权/用户批准/来源与审计 | F7 | 待验 |
| CON03 | 生命周期 staging/activate/deactivate 与资源释放 | F7 | 待验 |
| CON04 | 跨 Worker RPC 的类型、错误与资源额度 | F7 | 待验 |
| CON05 | 稳定错误码/安全文案/可重试与降级状态 | F7 | 待验 |
| CON06 | 长任务进度、取消、超时、并发与幂等 | F7 | 待验 |
| CON07 | 领域事件的本地/远端/外部变化一致性 | F7 | 待验 |
| CON08 | 事务/CAS/撤销/跨对象一致回执 | F7 | 待验 |
| CON09 | 沙箱、权限撤销和 packaged CSP 验证 | F7 | 待验 |
| CON10 | 宿主-工具-插件覆盖门禁/契约测试 | F7 | 本机分阶段门禁、Web构建通过；packaged/CI跨平台另验 |
| CON11 | 任意 SQL/FS/shell/DOM、密钥、伪造历史 | F7 | 待验 |
| CON12 | 新格式/OCR/实时协作/向量/任意编辑与新平台 | F7 | 待验 |
| MORE01 | 周期调度/启动补跑/失败记录 | F7 | 待验 |
| MORE02 | 一次性延迟/短周期/空闲任务与自触发防环 | F7 | 待验 |
| MORE03 | 环境 locale/platform/timezone/在线/ready 快照 | F7 | 待验 |
| MORE04 | 书籍/集合上下文菜单与 Agent header 插槽 | F7 | 待验 |
| MORE05 | 贡献的动态 visible/enabled/checked 与自有视图刷新 | F7 | 待验 |
| MORE06 | 发现/复用类型化提供者与跨插件权限交集 | F7 | 待验 |
| MORE07 | 插件自有二进制资产与资源配额 | F7 | 待验 |
| MORE08 | 声明 UI 本地化、辅助技术、窄窗和输入焦点 | F7 | 待验 |

## 本轮证据

[第一批：真实 Text Desk 流程、门禁修复及模型复核](./evidence/2026-09-13-full-validation/README.md)。已有子流程通过仍保留本行剩余边界。
