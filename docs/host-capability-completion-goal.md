# 缺失能力补全

2026-09-14，基线 `4657c3d0`。用户要求「把这些缺失的能力都补全」。
范围是紧邻该要求的九类实现缺口；包括此前 R9 排除的通用组合能力，
旧范围裁决不能用来缩减本次目标。只提供经过授权的语义操作，不开放原始 SQL、
文件系统、DOM、密钥或伪造历史。实现接通后集中运行真实桌面组合验收。

## 本批漫游来源交付

漫游写入/覆盖来源已补：KVWriteQueue的持久写监听传递实际mutation actor，普通偏好自动发布preference.changed及本机广播保留该来源。hydrate/refresh在入口捕获覆盖actor，远端普通KV与秘密值写入、删除和roaming-preferences-changed通知沿用；remote标志仍阻止回传，秘密值仅在密文槽落盘。修正旧注释为AES-GCM sealed app_kv。既有隔离检查覆盖失败回滚、远端不回传、本地未发布保护、秘密落盘/完成通知来源及普通偏好持久写到广播；受影响类型通过。覆盖来源只代表本机覆盖任务，不冒充远端原始写入者；秘密待发布队列跨重启来源、已接受插件偏好重试来源、真实Worker/Tauri及C04其余项仍待补。

## 本批启动句柄及迁移来源交付

启动/迁移阶段注册句柄与存储来源已补：宿主专用registrationForActor校验本激活持有的句柄，再给状态更新/显式释放传入已签发actor；普通dispose消息仍释放回调资源。host按实际lifecycle.migrating选择启动上下文，迁移完成后恢复独立普通调用，显式reaction仍优先；restoreStorage/serviceExecution保持原隔离绑定。既有定向RPC检查已覆盖迁移来源、后续普通调用独立、恢复隔离存储及反应凭证权限/过期/重复拒绝；受影响类型通过。真实Worker/Tauri仍待集中验收，致命错误具体归因及其余C04/C05缺口继续，完整目标未完成。

## 本批激活来源交付

Worker激活调用已接宿主activationOrigin：初始化/启用、授权后重启、安装候选和回滚重启把发起来源带入启动。host在ready之前接收的普通调用选择带来源的插件上下文，贡献注册及普通语义操作保留该因果；ready之后使用独立根上下文，不把后来用户操作绑到启动。带reaction的调用优先使用原有凭证；服务执行与恢复隔离存储不切换上下文。定向host RPC检查覆盖启动注册和后续普通注册来源分离，受影响类型通过。真实Worker/Tauri启动与用户交互仍待集中验收；显式注册句柄操作、迁移阶段及Worker致命错误具体归因等剩余来源继续保留，C04未闭合。

## 本批安装名册来源交付

安装名册发布已补宿主来源：初始化、启停、书域授权变更、安装接受/授权回滚及卸载在入口捕获actor，持久启用/授权设置与异步完成后的名册沿用同一来源。installedPluginsAtom数组包括空列表带来源，已有设置目录观察链可直接消费；无对象或无变化的patch不重新发布。无可归因调用的Worker致命错误由名册入口签发独立系统来源，不冒用旧安装actor。受影响类型、设置目录反应防环及现有授权持久化/排空检查通过；Worker错误到具体调用的因果归属、激活内部贡献来源及真实Tauri仍保留，完整C04未闭合。

## 本批环境观察交付

session2.7已接observeEnvironment反应凭证和可选稳定ruleId；环境快照及查询副本保留宿主来源。general.language的KV来源进入有序setLocale，实际languageChanged保留对应请求actor；未变化不重标，排队反向切换按请求顺序完成。环境仅语言变化沿用该来源，网络/时区等独立变化保留系统分支。Listening Desk0.13环境观察经withEvent发布并跳过循环凭证，用户按钮保持独立上下文。受影响类型/插件构建、真实JS语言切换来源和既有观察清理/消费者检查通过；真实Worker/Tauri及其他C04来源仍待完成。

## 本批阅读时长观察交付

reading2.24已接observeTime独立反应凭证及可选稳定ruleId；宿主采样保留订阅actor跨定时器的因果祖先，成功/错误均带来源，受限书域过滤后等待完整异步回调。Reading Goals0.6实时视图经withEvent发布，循环凭证不执行。保留原64订阅上限、背压和退休丢弃迟到结果。受影响类型、构建及定向书域/凭证释放/采样清理检查通过。这仅证明采样订阅来源，不代表数据库历史统计写入来源已追溯；真实Worker/Tauri仍待集中验收，完整C04保持未完成。

## 本批窗口条件交付

session2.6已补window.control只读条件：平台支持、32项队列和当前目标状态复用执行入口检查；无窗口派发/几何/原生输入信息，读取失败保留unknown。Agent嵌套request及插件生命周期接口已接，Workspace Profiles0.9在点击前查询，明确不可用显示错误，已满足目标则提示而不重复派发。受影响类型、插件构建和窗口关键检查通过；真实Tauri窗口状态/动画和公共Worker仍待集中验收。

## 完整交付清单

当前执行要求：用户要求重新开目标继续补全，并明确不要再铺大量无价值测试。
以实际可用的完整调用链推进，复用已有证据；只做受影响类型与关键权限、持久写、
取消/清理检查，不重复扩大回归，不用测试或文档数量代替能力交付。
新系统目标已创建并 active；复用既有实现，继续剩余能力交付。
代码交付范围保留，目标管理状态不改变以下能力的真实完成程度。

| ID | 交付 | 完成条件 | 当前状态 |
| --- | --- | --- | --- |
| C01 | 按书授权的记忆、图谱、上下文归档 | 当前书/指定书的查询、分页、观察、条件写、图谱任务及三种书域归档可用；其他书和用户全局资料不披露；切书/撤权淘汰旧结果并释放资源 | 接线完成，待集中桌面验收 |
| C02 | 按书授权的会话 | 读取本书会话/摘要/运行状态，提出一轮对话和停止/批准清空；事件及结果只含授权书，切书/撤权生效 | 接线完成，待集中桌面验收 |
| C03 | 受限插件的宿主命令和工作区 | 发现并执行范围内命令，查询/观察安全工作区状态并进行允许的导航；跨书对象不能经旁路泄露或修改 | 接线完成，待集中桌面验收 |
| C04 | 跨插件事件因果防环 | 跨领域写、Worker 回调及派生任务传递宿主签发的因果链；循环自动动作被明确拒绝，独立用户操作与合法后续任务不被误伤 | 实施中，事件/Worker、设置/文档/标注/记忆快照及投影通知已接，图谱任务和正文准备来源已接；阅读器开书/控件/播放/显式选区、导航、模式、面板开关/宽度和图片开关/变换及两者空快照观察已接，字体/CSS/正文宽度及固定页配色来源已接；同书布局切换重建及绑定生命周期已接；显式/自动焦点与原生选区反馈已接；贡献目录、公共注册/状态/退休句柄及异步语音/传输刷新已接，选中字体/主题/分段消费者和启动主题缓存来源已接；窗口请求的状态/尺寸采样及匹配的图片重排、外层阅读器viewport来源已接；动画后续帧、Foliate内部和面板响应式布局、其他派生消费者及其余观察来源仍缺 |
| C05 | 完整操作可用性 | Agent 与插件能查询操作需要的权限、阅读对象、账号、模型/端点和提供者条件；区分未配置、不可用、未知；执行前重验，不把注册或网络提示当健康 | 实施中：推理、书域朗读/模式及正文准备条件查询、实际执行重验及Text Desk消费者已接；library1.31正文任务接当前书授权的准入/执行围栏；sync.now连接/凭据/提供者条件及Maintenance Desk消费者已接；memory.graph.generate任务容量/持久章节边界/fast模型及Memory Desk批准前条件页已接；其余操作条件仍缺，集中桌面验收待执行 |
| C06 | 通用类型化跨插件调用 | 声明版本化输入/输出契约、发现与调用；双方授权和对象范围共同约束，取消/停用/更新/迟到结果受生命周期保护；真实消费者组合 | 实施中：plugins1.8宿主/Worker及Jumper→Text Desk书签服务已接；Agent逐次授权服务入口已接；集中Tauri组合验收待执行 |
| C07 | 跨领域提交与统一撤销 | 多个可事务化本地语义操作经冻结预览/版本校验在同一提交中全成全败，含设置、私有文档及领域变更；Agent/插件共用，撤销是新的受控条件提交；非事务性外部副作用在预览时明确拒绝纳入原子批次 | 实施中：原生同事务事件/设置/文档及条件检查已写；SQLite冲突回滚/成功提交/持久回执已验证；宿主、Agent逐次批准、transactions1.0插件权限/Worker及Workspace Profiles0.8消费者已接；真实Tauri组合/跨重启撤销待集中验收 |
| C08 | 统一长任务恢复 | 类型化多步骤工作有持久任务身份、进度、取消/暂停/恢复、幂等回执及跨重启续跑；接入现有任务消费者，失联结果必须先查证而非盲重放 | 实施中：类型化计划、schema47检查点/修订围栏和宿主恢复调度底座已写；暂停/取消意图先持久化，未知结果保留核对；事务/正文/图谱步骤已接统一宿主执行器，jobs1.0插件入口和Text Desk0.28消费者已接，Agent逐次批准入口及启动恢复已接，真实桌面验收待执行，真实重启验收待执行 |
| C09 | 可续读变化日志 | Agent/插件按授权范围分页读取变更、持久游标续读及补齐停用期间变更；本地/远端/恢复同源，过期游标明确报错；不得公开原始秘密或无权限数据 | 实施中：schema48原生事务内元数据日志、保留窗口及owner/查询绑定的持久游标已写；公共查询契约和宿主安全通知投影已写，权限绑定及Agent/插件接口已接，Text Desk0.29持久游标消费者已接，恢复边界已补，真实桌面验收待补 |

## 当前交接

- C04临时强调链：reading2.23 observeEmphasis带独立反应凭证，列表包含空快照的宿主来源。
  领域put/remove把每次调用actor交给共享owner控制器；提交、清除、阅读会话退休和渲染附着反馈
  保留来源，异步验证/取消与物理排空沿旧路径。Foliate create-overlay补透传context，固定页
  创建/预加载/PDF重绘显式传递上下文；强调适配器合并同批渲染通知来源后再发布实际状态变化。
  书域观察返回回调Promise以保持凭证；受限插件清除改走当前书围栏及既有owner/revision校验，
  修复能创建但不能清除自己临时标记的断点。Text Desk0.31用事件上下文更新实时标记列表，用户动作仍独立。
  控制器关键取消/失败/所有权与来源检查、公共受限创建→事件反应→清除→cycle及跨书拒绝通过；
  Text Desk类型/构建与既有视图流程、Foliate严格编译和Web/desktop类型通过。
  日志 `/tmp/readaware-emphasis-cause-check.log`、`/tmp/readaware-emphasis-public-check.log`、`/tmp/readaware-emphasis-cause-types.log`。
  实际Tauri强调覆盖层/Worker反馈仍待集中验收；observeTime、环境观察、安装状态和其余来源缺口继续保留。

- C04设置目录来源：settings observation现在直接订阅已签发来源的字体/主题/命令/菜单动作/
  阅读模式注册表数组，不再把shortcutEnvironment等派生对象的变化改为新系统来源。
  当前阅读模式选择增加宿主私有来源封装；模式控制器通知带入actor，清除选择保留阅读会话来源，
  旧owner清理不能覆盖新owner。设置仍走原授权目录读取，公共快照不增加宿主来源对象。
  真实注册表→设置观察的定向检查验证命令变化及选择/清除同因果、同规则反馈拒绝；
  Web/desktop类型通过，日志 `/tmp/readaware-catalog-source-types.log`、`/tmp/readaware-catalog-source-check.log`。
  阅读模式替换/外部偏好及卸载使用既有检查，日志 `/tmp/readaware-catalog-mode-check.log`。
  installedPluginsAtom的安装/Worker错误自动来源、其余观察及原生不确定来源仍保留，Tauri集中验收待执行。

- C04 macOS窗口输入来源：新增原生window_input_revision，仅返回main窗口可用性及单调输入序号，
  AppKit本地鼠标/拖拽/键盘/触控事件使序号前移；惯性滚动不作新输入。不收集键码、坐标或文本。
  安装失败和其他平台返回未知，不以固定零值冒充原生输入证据。监视器与既有wheel-phase一致按app生命周期持有。
  HostWindowService在真实命令派发前绑定输入序号和actor；后续原生采样序号一致时延续来源，
  新输入使关联失效；即使两次采样尺寸相同也替换旧几何来源。no-op不重新绑定旧效果。
  几何失败/与DOM动画帧不匹配时，独立重读原生输入序号后才允许沿用已知来源；
  resizeSource的Foliate/图片/viewport消费者及响应式面板共用这条路径，既有过期样本淘汰保持。
  Web/desktop类型及cargo check --lib --offline通过；窗口关键检查与响应式反转检查通过。
  日志 `/tmp/readaware-window-input-types.log`、`/tmp/readaware-window-input-native.log`、
  `/tmp/readaware-window-input-check.log`、`/tmp/readaware-window-input-responsive.log`。
  这是接线/本地检查，尚未实际观察AppKit监视器和Tauri动画。其他平台和未经过本app输入的外部
  窗口管理器/显示器变化仍不能证明来源；输入序号本身也读取失败时仍保留原回退边界，完整C04未闭合。

- C04阅读会话反应入口：reading2.22 observeSession新增独立delivery凭证和可选稳定ruleId，
  在既有授权过滤后签发；书域过滤现在返回回调Promise，凭证保持到异步回调结束。
  当前快照的宿主来源跨Worker通知进入withEvent，循环反馈标为cycle，退休/回调结束拒绝旧凭证。
  Jumper0.11用具名会话规则绑定按钮句柄状态更新；Text Desk0.30和Listening Desk0.12
  用事件上下文发布实时视图，后续用户动作仍保留原始上下文。三者类型/构建和既有受影响流程通过。
  受限宿主链检查覆盖跨await写入、同来源循环、凭证过期、新用户根及退订后具名规则复用，
  日志 `/tmp/readaware-session-reaction.log`；Web/desktop类型 `/tmp/readaware-session-web-types.log`。
  **入口接通不代表所有阅读来源闭合**：原生窗口动画/失败回退等尚会产生独立系统来源，
  这些路径仍可能切断祖先；需继续补齐后才能声称完整跨插件防环。observeTime/Emphasis和
  环境观察等其他未接来源仍保留，真实Worker/Tauri集中验收未执行。

- C08因果任务续接：新任务创建时将有界source与计划同事务保存，原生校验结构/配额，
  同id重试必须同source，所有检查点必须保持source完全一致。公共快照不返回来源或原始检查点。
  runner每次派发/恢复按保存source构造独立执行器；正文/图谱和事务事件/设置/私有文档观察
  共用恢复来源，权限、书域、旧版本及写入回执检查仍走原路径，不从来源取得权限。
  jobs1.1允许事件绑定上下文启动，祖先订阅必须全部具备稳定ruleId；未命名反应明确拒绝，
  服务Worker仍不能创建持久任务。激活根与Agent新任务也从创建开始保存独立来源。
  老的无source任务此前只允许激活根创建，继续按旧根执行，不声称恢复了不存在的历史来源。
  SQLite重开/来源删除拒绝、runner中断恢复同根/防重复与取消不启动后续步骤通过，
  Web/desktop类型通过；日志 `/tmp/readaware-c08-source-final-native.log`、`/tmp/readaware-c08-source-runner.log`、`/tmp/readaware-c08-source-final-types.log`。
  真实命名订阅→Worker→SQLite→重启后写入反馈仍待集中验收；C04其他来源与C05余项保持。

- C04/C08持久因果前置：发现原规则ID每激活随机变化，仅保存cause不能跨激活识别同规则。
  plugins1.9领域事件subscribe现支持可选ruleId，宿主按插件命名空间绑定，活动重名拒绝、退订释放，
  无ruleId仍为激活内身份。RSS Reader0.22删除书籍清理已采用稳定规则名。
  宿主saveActorSource/restoreActorSource保留有界独立分支、规则祖先和根身份；恢复只面向宿主存储，
  不暴露插件输入通道、不授予权限。序列化恢复/新激活同规则拒绝、独立事件与其他插件继续的关键检查通过。
  宿主类型与RSS类型/构建通过；修正RSS既有withEvent重载测试替身的类型以完成该消费者检查。
  **尚未接任务数据库及按任务执行器来源**，不能声称跨重启任务因果已实现；下一步继续这层，
  并要求派发保存可恢复来源、恢复重验权限，旧无来源任务与未命名规则不得冒充已闭合。

- C04 Foliate内部窗口重排：分页器和固定版式ResizeObserver现通过只在宿主设置的NativeInputBridge
  解析匹配viewport的窗口来源，不直接把窗口重排归给上次导航。固定滚动版式的排版、滚动锚点及位置通知
  共用该上下文；等待期间导航、渲染上下文、桥接对象、元素尺寸变化及销毁会淘汰旧结果。
  同一窗口重排引起后续元素尺寸变化时保留最初窗口样本并合并处理，重复相同通知不重置等待。
  生成静态Foliate模块、严格类型和Web/desktop类型通过；定向检查覆盖合并、导航及销毁失效。
  `renderer-resize-observer.test.ts`仅证明调度边界，真实Tauri分页/固定版式几何与事件仍待集中验收。
  元素自身重排仍沿已有显式渲染来源；原生动画后续帧/读取失败/无匹配及其他自动来源、任务因果继续保留。

- C04响应式面板：ReaderShellOverlay用宿主来源绑定的媒体查询选择窄屏/停靠布局，
  与当前viewport尺寸匹配的原生窗口来源和布局值一起交给useReaderPanels发布。
  窗口后续变化、断点反转、卸载使迟到读取失效；仅媒体查询变化而viewport未变时不复用旧窗口来源。
  React挂载定向检查验证面板通知保留原始因果链、同规则反应拒绝及断点反转保留新状态，
  日志 `/tmp/readaware-c04-responsive-check.log`；真实Tauri窗口链尚待集中验收。
  原生读取失败/不匹配仍降为独立系统来源以保持布局可用，不算完整防环；Foliate内部ResizeObserver、
  动画后续帧/同viewport变化、凭据与其他自动来源、持久任务因果和observeSession入口已有后续实现；上述窗口及其他自动来源仍保留。

- C05同步批次：session2.4新增sync.now无参数条件查询，插件先检查service:sync，未授权只返回权限条件。
  HostSyncService条件与执行共用桌面/连接管理/账号/启用/认证检查，真实profile、凭据和已注册传输
  复用同步源准入；查询不打开引擎/传输、不探测网络、不返回凭据/账号/地址。远端健康保持unknown。
  requestSync派发前再读条件并核对连接epoch，提供者退出或连接替换拒绝派发。
  Agent两种scope通过原get_operation_availability入口查询，Maintenance Desk0.6新增条件页和同步确认入口。
  宿主/Agent类型、插件类型构建及既有同步服务与能力契约定向检查通过；新增检查只覆盖查询不执行、
  提供者失效与连接替换拒绝派发。日志 `/tmp/readaware-c05-sync-types.log`、`/tmp/readaware-c05-sync-agent-types.log`、`/tmp/readaware-c05-sync-guards.log`。
  真实Tauri/Worker/传输条件与执行仍待集中验收；C05其他操作、C04因果来源缺口保留。

- C09：schema48通过SQLite触发器收集领域事件、插件文档及已知设置键的变化元数据，
  与原写入共用事务；不复制事件正文、文档值或设置值。文档移书同时记录旧书移除。
  保留最近100000条；游标是不透明持久凭据，每owner最多256个，绑定规范化selector和epoch。
  `open`取当前边界，调用方应先取游标再读基线；`read`沿插入顺序翻页，晚到HLC不漏读。
  事件历史删除重置epoch，过期或范围变化明确拒绝。插件清理同步清其游标与私有变化元数据。
  SQLite回滚/范围过滤/跨owner拒绝/重开续读/历史重置检查通过，日志 `/tmp/readaware-c09-native.log`。
  schema49补标注/会话/记忆历史归属、记忆移出书域、书合并双书及集合变化的相关书通知；
  全局阅读默认值与按书覆盖分别过滤，本地/远端设置同源通知，backup恢复事件使旧游标过期。
  公共ChangesQuery/ChangesPort及宿主通知投影已写，只输出授权领域/书籍和自有文档身份，
  原始事件类型、payload和KV键不输出；游标另绑定公开查询形状。
  定向SQLite路由/不跨书设置/正文不披露检查与Web/desktop类型通过，日志 `/tmp/readaware-c09-routes-complete.log`。
  changes1.0已接插件领域读/写授权、显式书域与当前书围栏、设置目录可读路径映射，
  原始存储键只在宿主内部使用；派发前和返回前重新检查生命周期、书域及设置目录。
  Agent open_change_cursor/read_changes按会话owner绑定，书会话必须指定本书，拒绝插件私有文档。
  Worker取消参数与退休排空已接。已纠正此前对凭据来源的误判：secrets.rs把密文写入SQLite app_kv。
  schema50在AI密钥新增/轮换/删除事务中仅记录AI设置失效，不存秘密键名、提供者槽、密文或明文；
  credentialConfigured现在经既有设置目录授权映射接入插件/Agent游标，非AI秘密不进入该通知。
  Agent/Web/desktop类型通过，日志 `/tmp/readaware-c09-agent-types.log`、`/tmp/readaware-c09-wired-web-types.log`。
  Text Desk0.29新增书籍更新页，按授权书域保存游标和已处理页面；先打开边界再读基线，
  当前授权书籍状态读取成功后同一KV写保存页面及位置，失败保留旧位置，重开显示已保存页，
  分页由显式动作推进，过期自动重载基线并说明；不把通知解释为精确编辑历史或重放写操作。
  插件类型/构建和失败不前移位置、重开页面、过期基线的定向检查通过；这是消费者本地检查。
  已审查完整备份的restore_rows/reconcile事件路径；现有backup.restoreChunk/restored在同事务使旧游标失效。
  补清空后的通知/游标清理与epoch重建，缺失epoch兼容自恢复；游标边界用SQLite自增高水位，
  防止清空后首次新通知因保留自增序号误判过期。首次同步checkpoint导入和显式投影重建同事务换epoch，
  普通增量同步不强制失效。SQLite实际wipe/新通知续读/回滚不失效/缺失epoch恢复定向检查通过，
  日志 `/tmp/readaware-c09-wipe-native.log`；四类变化日志错误已加八语言提示。
  实际权限/Worker/Tauri跨重启、完整备份与bootstrap运行验收仍待完成，不能算完成。


- C08 当前底座：不可变计划与步骤派发身份、结果回执、进度、控制意图以 owner 隔离写入 SQLite；
  修订 CAS 防止旧执行者覆盖状态。每个宿主 runner 最多四个在途任务；先写检查点再派发，
  暂停/取消等待在途工作结束，失联结果保留 needs-attention，取消意图在核对后仍阻止下一步。
  SQLite 关闭重开/旧版本拒绝、取消后失联再核对关键检查与 web/desktop 类型通过。
  已补事务步骤执行器：预先冻结事件身份、原始提交内容和 owner 回执身份，恢复先查回执；
  原授权、私有文档书域和版本条件仍复核，原始检查点不进入公共插件接口。
  正文/图谱步骤现已接既有任务 owner，终态快照先存检查点；正文最后租用取消可等待解析器
  真实排空，其他读者的共享任务仍继续。已知结束与未知派发分开，已结束的取消能收口。
  普通正文准备复用当前内容；图谱 catch-up 仅在已知终止后接受显式续跑。
  jobs1.0现接插件根上下文的启动/查询/分页/控制，逐步权限、书域和私有文档复核；
  激活后恢复，退出排空，候选激活及服务Worker不派发。任务保存到原生写队列后再次检查授权。
  Text Desk0.28可后台准备本页书籍，分页查看任务并暂停/恢复/取消；不增加内存写权限。
  Agent已接启动/查询/列表/控制，启动及恢复展示完整语义计划并逐次批准；书会话不能越书或访问插件私有文档。
  启动发现排队/运行任务、退出排空；工具目录构建不分配任务owner，模型配置变化复用owner。
  批准拒绝/参数隔离关键检查通过；真实批准UI/Worker/Tauri重启仍待集中验收。
  插件反应上下文暂不允许延长为后台任务，完整因果续接待补。
  图谱重建现已保存章节计划、已完成章节及在途生成结果，模型调用前等待计划落盘，
  生成结果在条件写派发前落盘。恢复按不可变事件回执核对，沿原图谱队列和内存写保护复用
  已生成结果；内容版本、分类、阅读边界改变时拒绝覆盖。已知 partial 需显式批准继续；
  缺少任何计划/结束证据时仍保留待核对。真实 Tauri 中断/重启验收待执行。
  显式恢复意图已写入检查点，在调度队列拥堵/重启后保留，并在下一次派发时消费。
  正文已有任务/仓库定向检查通过，新增最后租用排空检查通过；未运行真实解析器/Tauri。
  图谱计划先落盘/复用生成结果及已有冲突/取消检查通过，日志 `/tmp/readaware-c08-graph-pipeline.log`、`/tmp/readaware-c08-graph-native.log`。
  日志：`/tmp/readaware-c08-control-native.log`、`/tmp/readaware-c08-control-types.log`。

- 全目标 active。C01 已减少实际调用断点：memory2.8 替换整域拒绝，Memory Desk0.14
  受限安装直接打开授权书列表并消费原生分页/图谱/条件修改公共接口。
- 当前书/会话围栏覆盖在途读、观察投递、条件写派发、长期图谱任务和三种书域
  context 资源；图谱实际结束和资源释放回收围栏。全局画像/实体仍需 all 授权。
- C01 已通过 web 与桌面探针 TypeScript 检查、Memory Desk 编译入口/源码测试与类型、
  图谱任务回归、定向授权/取消/资源/观察测试、真实 Bun Worker 既有协议集，以及
  `bun run check:capabilities`（含插件构建/运行时契约与全工作区类型）及矩阵/模型生成校验。
  单测数据和图谱推理为受控 fixture，不等于此次书范围路径已在 Tauri/真实模型验收。
- C02 conversations1.5 已接本书转录/摘要、过滤运行状态/自有请求、事件、待批准
  回合与停止/清空。全局线程 ID 返回 null，可见版本不随外书会话变化；全局线程
  列表/创建/选择仍属于 all 授权。待批准请求保留围栏，切书后不能接受，宿主接受
  之后释放围栏，已接受的用户回合不追溯撤销。失效通知只是无对象载荷的重读提示。
- 清空复用原生 aiConversation.cleared 的单次原子事务（本来就删除所有消息及错误
  占位），移除随后重复清空投影的调用；信封准备后、原生派发前复核取消信号。
  已派发事务保留实际回执；若当前书变化阻止插件收到结果，应先查询，不能盲重试。
- C02 定向授权/延迟读/请求退休/运行状态/事件/清空派发检查、Memory Desk0.15
  编译入口的本书摘要→待批准发送及确认清空表单、插件类型/运行时契约、工作区
  类型及 `check:capabilities` 与生成校验通过；原生事务/完整UI与真实模型待集中验收。
- C02 已提交 `985a5a61`。C03 ui1.15 已接受限工作区快照/观察/导航和命令发现/观察/执行。
  宿主选择集先授权过滤再分页计数，实际导航提交回执也使用同一投影；集合和搜索
  字段显式标记未披露，版本绑定原生界面状态与当前阅读会话。跨书选择/开书拒绝，
  集合导航仍需全书授权；固定书授权不能关闭另一书的阅读器。读授权不开放写入口。
  Library Desk0.13 已消费受限工作区及命令对象范围状态。针对性宿主/授权/消费者
  检查通过；新增真实 Tauri/Worker/Agent 组合仍待集中验收。
- C03 已提交 `150cac8c`，完整 capability 检查（含工作区类型/插件构建）通过。
- C04 公共接线已推进：plugins1.2 `ctx.withEvent(event)` 接本地域/设置订阅的宿主
  不透明令牌及 Worker call envelope，逐次复核令牌和既有方法授权；同一步重复的
  因果路径拒绝，外来/过期令牌无副作用。自动回调必须显式使用绑定上下文，独立
  用户动作使用激活根上下文；禁止共享 mutable currentActor 或猜测并发归因。
- 各因果上下文复用一个激活的资源/正文任务/图谱任务/强调 owner、文档观察器、
  LLM/network/logging 配额以及受限工作区/会话 revision。已受理任务可在回调后
  继续，保留原 actor；新调用不能使用过期绑定。lifecycle对象在绑定上下文中保持
  同一激活身份；RSS0.21删除回调已消费公开接口，同源URL队列据此复用，避免
  事件清理与用户刷新并发破坏订阅。新激活仍使用新队列。
- 设置读授权过滤复制保留原因，并处理异步监听错误。导入任务按 start 捕获 actor；
  图谱共享 owner 按 start/retry 捕获调用者，真实摘要写及自动分类使用该 actor，
  继续沿既有 memory policy 与持久写围栏。Graph 任务快照不序列化 host context。
- 已有域/权限/Worker协议回归54项通过，新增宿主RPC重复链/外来/过期/未授权
  检查及真实Bun Worker跨await、嵌套存储调用通过；同realm真实阅读命令原因/资源
  owner保持、设置事件租期、图谱异步context及RSS消费者回归通过。完整
  `bun run check:capabilities`通过（含全域/Agent/插件运行时、构建和类型）；
  随后lifecycle身份与RSS串行队列修复的75项受影响检查、RSS类型/构建通过。
  两个真实公共settings上下文A→B→A与独立用户根已通过，最终web/desktop类型
  通过。日志/tmp/readaware-c04-capabilities.log、readaware-c04-consumers.log、
  readaware-c04-cycle-public.log和readaware-c04-final-types.log；以上使用受控
  native/模型或内存环境，不是新增Tauri验收。
- C04 plugins1.3 已接 settings.queries.observe、library/conversations.events.observeInvalidation
  和 storage.observeDocuments 的第二回调参数；withEvent 接此 delivery，首快照格式不变。
  设置授权投影保留原因并等待异步处理，受限会话合并原域及切书通知时保留原因。
  已有本地 library/book/conversation 派生通知传递发起 actor；清空会话的摘要删除也
  使用宿主本次 actor，不退回 Agent 根。
- 合并按原触发根保留因果分支，同根祖先合并、重复根退休，独立新根仍可执行；
  32 根/32 深度有界。私有文档各 actor API 共用激活观察 owner，匹配写未回执时
  不读新快照，跨提交样本重读；失败/冲突不发布变化，精确文档按集合/ID过滤，
  page 按集合合并后再比较结果。回调重试和持续读取错误后的恢复不丢原因。
- Jumper0.9 与 Workspace Profiles0.7 使用新公开绑定发布自动视图更新，后续用户
  操作仍用根上下文。基础宿主与真实 Bun Worker（含第二参数跨 await）检查通过；
  真实公共 settings 事件/快照 A→B→A 与独立用户根、私有文档观察→条件事务→循环
  拒绝通过。受控原生后端不等于 Tauri/SQLite 验收。插件构建及类型通过，受影响
  消费者与文档观察回归82项通过；另外14项书籍/摘要副作用检查通过。
- 本批 check:capabilities 所含检查全部通过：矩阵/模型生成、库存/Core/Agent/宿主
  域及网络检查复用已过结果；修正来源参数和原生文档事务回执的旧测试夹具后，
  从 Plugin runtime contracts 继续，运行时/真实Worker/迁移KV与完整类型检查
  通过（含web/desktop探针及依赖插件构建）。日志位于
  /tmp/readaware-c04-observations-capabilities.log（前半已过）、
  /tmp/readaware-c04-observations-capabilities-remaining.log（后半已过）、
  readaware-c04-observation-consumers.log及readaware-c04-observations-effects.log。
- C04 阅读器本批：开书请求捕获单一宿主 actor，装载 ready/fail、控件初始化和
  book.opened 写沿用它；手动开书与控件输入使用独立 user 根。控件按实际 React
  render revision 捕获来源，迟到/取消的渲染不能替换新来源。显式选区创建/清空
  已将 actor 传到 DOM 适配器及 selectionChanged；导航导致的清空仍待下批。
- 播放 start/stop、异步合成回退、音频开始/结束、错误、自动下一段请求保留来源。
  修复通知内重入启动新播放时，旧 onStart 误确认新请求；通知后重新检查 generation，
  防止旧 onEnd 派发下一段、旧错误覆盖新播放、同步回调返回的旧句柄替换新句柄。
  已发布实际变化的控件/播放/清空回执不再把新反应状态重标为旧来源；嵌套通知结束
  旧快照投递。reader-demand 从 app-event 继承原因，冷却计时器复用同一原因，
  但 Foliate 的导航/rendered 发出端仍需明确请求身份。
- 本批受影响宿主/控件/选区/播放/causal 检查70项、相邻播放/模式/公开读会话来源/
  selection barrier/事件租期检查25项通过；web及desktop探针类型与Foliate源校验
  通过。使用受控渲染确认、音频/引擎适配器，未新增真实Tauri/音频验收。
  日志/tmp/readaware-c04-reader-focused.log、readaware-c04-reader-adjacent.log、
  readaware-c04-reader-types-local.log。首次从根目录bunx tsc调用了不同的工具环境，
  不作有效类型证据；随后使用apps/web自身typecheck脚本通过。
- C04 导航本批：宿主授权后的导航创建不透明请求身份，Foliate View、流式/固定
  版式的装载、定位、翻页、初始位置回退和渲染完成沿用它；公开位置不序列化身份。
  定位引起的选区清空、忙碌状态及阅读器外壳收起使用同源 actor。程序滚动按实际
  坐标匹配反馈，宿主与 iframe 内独立键盘/触摸/滚轮输入清除关联。
- 固定版式区分请求页面和实际显示页面；同页在途装载复用数据但只有最新导航
  发布，旧异步目标/选区请求不能覆盖后来的导航，同一跨页切换左右页更新当前位置。
  编译后的实际 View/FixedLayout 在受控 DOM/iframe 装载事件下通过延迟竞争和
  来源协议检查；这不证明真实 iframe 装载、布局或绘制。已添加相应集中 Tauri
  场景，尚未执行。宿主51项、View协议1项、相邻Foliate契约6项通过，静态53模块
  构建、web/desktop类型通过。日志/tmp/readaware-c04-navigation-host.log、
  readaware-c04-navigation-view.log、readaware-c04-navigation-contracts.log、
  readaware-c04-navigation-types.log。修正新测试中的step参数位置后类型通过。
- 导航批次已提交 `a183b681`。C04 模式本批：开书初始化、Agent/插件配置、原生
  用户选项按请求捕获来源；配置、分段/迟到装载后的落点、步进导航、位置持久写
  及播放当前段输入沿用它，公开模式快照与存盘内容不序列化内部 actor。
  回滚仍属于被取消的请求；新用户接管后的模式状态不会被旧成功回执重标来源，
  重入发布停止旧轮通知。分段租期失效的结果既不能改变当前段，也不能覆盖来源。
- 模式与插件偏好的同一原生批次保留请求来源；外部偏好只从成功的 KV 提交驱动
  模式，读取该提交的值和来源，忽略当前书配置批次的自反馈。旧的乐观值/写失败
  回滚不再制造新意图。等待配置写入期间多个偏好按最新通知生效，较早通知退休。
- 本批宿主控制器、真实 React hooks/分段及受控 IPC 持久写组合检查通过，涵盖
  两种装载顺序、旧文档/源替换、原生用户与插件步进、取消/失败和外部设置来源。
  日志/tmp/readaware-c04-mode-integrated.log、readaware-c04-mode-adjacent.log、
  readaware-c04-mode-types.log；web/desktop类型通过。这些不是新增 Tauri/真实
  Worker 分段或音频验收，仍待集中运行。新增第7项持久写场景后同步了子进程
  包装测试中的场景计数；子场景本身均通过，没有放宽产品断言。
- C04 下一步：设置触发重排、原生选区/焦点、面板/图片及贡献注册/退休引起的
  派生快照继续接来源。全部阅读快照来源接好后再开放observeSession的reaction参数（当前未开放）。
  另余其他快照、设置目录/凭据失效和其余派生路径；继续迁移自动反应
  的第一方消费者并做跨插件组合检查。
  当前不能计整项完成。C05–C09仍未实施，C01–C03真实桌面组合验收仍待集中执行。
- C01–C09 全部保持交付范围；相关完整单位验证后本地提交，不推送。
- C04 标注观察已接：plugins1.4 为 annotations.events.observe 提供独立 delivery 参数；
  本地领域提交及远端/恢复投影失效保留宿主来源。授权查询等待短持久写回执，跨提交
  样本重读；回调失败重试、稳定读取错误及恢复保留原因。事件中已知书/ID先过滤，
  只含标注ID的编辑/删除保守失效页查询，由授权结果比较决定是否投递；不为归因越权读书。
  未变化的成功查询退休已消费原因，不把旧循环传给后续独立操作。
- 受限标注包装现在等待插件回调的实际完成，授权失败仍停止投递，处理失败由观察器
  重试。Annotation Desk0.8用绑定上下文发布自动列表更新，循环投递停止发布；用户编辑
  动作仍使用原激活上下文。原生标注集合也使用同一来源与短写入结算规则。
- 标注公开双插件 A→B→A 与独立用户根在全书/固定书授权下通过；真实 Bun Worker
  第二参数→跨await→条件修改协议通过。受控原生IPC/观察器/消费者和类型验证日志为
  /tmp/readaware-c04-annotation-focused.log、readaware-c04-annotation-public.log、
  readaware-c04-annotation-consumer.log和readaware-c04-annotation-types.log。
  此次不构成Tauri/SQLite/网络同步验收，仍待集中运行。记忆观察尚未接来源，下一批继续。
- 本批相邻授权/条件标注写/原生标记与既有事件反应44项通过；Annotation Desk编译入口
  及消费者33项通过，生成矩阵/模型及库存映射检查通过。初次类型检查发现测试夹具缺
  note.created.body及publishView回执，补齐后通过；编译清单版本断言已随0.8同步。
  补充日志/tmp/readaware-c04-annotation-adjacent.log及readaware-c04-annotation-contracts.log。
- 标注批次已提交 `50fb201c`。C04本批plugins1.5接memory.events.observe第二参数；
  记忆、画像/实体及书籍事件、远端/恢复失效、正文可用性和相关阅读位置为主机来源，
  保留原授权查询与串行轮询，短写入结算、跨提交重读、错误恢复/回调重试共用已过规则。
  图谱观察只订阅本owner及目标书/任务；初始环境快照不当作额外独立触发。
- 图谱任务的排队/执行/报告/终态、取消和淘汰通知携带私有调用context；取消后的反馈
  保留取消者，执行写端仍使用原发起者，重试使用新调用者。重入取消不递归，淘汰通知
  造成退休后不能继续创建任务；退出释放来源订阅并保留物理执行排空。
- 正文共享工作合并请求来源，最终可用性/最后租约取消保留同根祖先及独立分支；
  旧任务迟到结束不覆盖替换任务的来源。各次暂停/恢复持有自己的请求来源，公开任务
  控制与会隐式抽取正文的library查询传入当前actor；图谱runtime使用宿主绑定的正文
  读端，仍经过既有memory policy与取消保护。来源不进入任务/正文持久内容或Worker业务数据。
- Memory Desk0.16绑定自动页面发布，循环投递不再发布，页面里的后续用户动作仍用
  激活根上下文。公开记忆双插件A→B→A在all/book授权下拒绝循环，独立用户根可继续；
  公开图谱进度→跨await取消→终态保持同一原因；真实Bun Worker记忆条件修改协议通过。
  正文共享/取消/替换与图谱源通知、受限记忆围栏、消费者及Agent受保护正文读端检查通过。
  受控IPC/模型和Bun Worker不是Tauri/SQLite/真实模型语义证明，仍待集中验收。
- 本批日志/tmp/readaware-c04-memory-foundation.log、readaware-c04-memory-causes.log、
  readaware-c04-memory-public.log、readaware-c04-memory-adjacent.log、readaware-c04-memory-consumer.log，
  类型日志readaware-c04-memory-types.log与readaware-c04-memory-agent-types.log。
  新测试按Agent的ES库版本使用索引取末项并补齐通知bookId；Memory Desk旧夹具补withEvent。
  C04仍余阅读设置重排、原生选区/焦点、面板/图片、贡献注册/退休、设置目录/凭据等
  来源及其余自动消费者；reading-ai-actions的章节准备/openChat也尚未传actor，后续接此路径。
  observeSession的reaction仍未开放，C05–C09完整保留，C01–C03待集中桌面验收。
- 本批最终Agent/Web/桌面探针类型检查通过；补齐book-text-changed到正文任务、图谱
  和变化通知的能力库存映射，矩阵/模型生成及21项契约检查通过。日志
  /tmp/readaware-c04-memory-contracts.log；没有新增真实桌面或模型验收结论。


- 记忆/图谱批次已提交 `b6ced5ff`。C04本批接通显式面板开关/宽度调用来源：
  Agent与全书/受限插件传入actor，显示控件、KV补丁、瞬时面板和匹配渲染回执
  保留同一调用来源；React按本次实际变化的控件/布局/宽度/瞬时输入合并原因，
  不把未变化旧状态的循环原因带入后续用户动作。重入通知停止旧轮投递。
- KV队列每次写入在入队时捕获来源；乐观镜像、成功回执和失败回滚复用它。
  有更新的在途覆盖时使用更新请求的来源，旧提交不能重标该值；同键同步重入
  不再向剩余监听者投递旧通知。原生和Storybook镜像/提交一致，来源不序列化入KV。
  原生宽度拖动标记用户来源，后续保存保留它；此处不增加跨重启任务语义。
- reading-ai-actions在等待章节准备前捕获来源；章节抽取与打开聊天使用同一个actor，
  Agent端口显式绑定agent，原生用户动作使用user；既有隐私、当前书/选区围栏保留。
- 全书/固定书授权的实际公共插件绑定上下文→跨await→面板→真实React hooks及
  受控IPC组合通过，观察/持久通知保留循环祖先、后续独立用户根可执行；宽度失败
  回滚、临时面板/控件隐藏和同键重入来源通过。37项定向检查（含隔离18个React
  场景）及21项相邻设置/模式/KV/AI表面检查通过，web/desktop探针类型通过。
  日志/tmp/readaware-c04-panels-focused.log、readaware-c04-panels-adjacent.log、
  readaware-c04-panels-types.log。首次检查中的旧参数断言与Storybook示例已同步，
  修正宽度解析的无浏览器环境fallback；并未放宽权限/持久/取消断言。
- 本批未开放面板observe的公共reaction参数：null/解绑投递、自动chat焦点、窗口
  驱动的响应式布局来源还待统一；阅读observeSession也仍未开放reaction。下一步
  接原生选区/焦点/图片、阅读设置重排、贡献注册/退休与设置目录/凭据失效，然后
  迁移对应自动消费者。C04未完成，C05–C09未实施，全部范围保留；上述受控IPC/
  React/脚本Agent不是新增Tauri、真实SQLite或模型语义验收。

- 面板调用来源批次已提交 `1f6aaf2b`。本批plugins1.6接图片/面板observe第二参数，
  关闭null与解绑投递使用独立宿主来源对象；回调串行、在途触发合并、回调失败后
  下一次通知保留来源，初始快照继承注册调用。来源不序列化进业务快照。
- 图片打开在等待读取前捕获actor，Agent隐式章节准备也继承；实际挂载、缩放/
  平移/旋转/复位/关闭保留来源。原生点击和手势有独立来源，原生接管不确认旧
  控制；关闭生命周期标记实际关闭者，迟到clear/旧按钮不能关闭后来图片。
- Listening Desk0.11面板发布和Text Desk0.23图片发布使用withEvent，循环不再发布；
  视图中的后续用户动作保留激活根。公开all/book图片及面板A→B→A拒绝循环，
  独立用户根可再执行，空快照通过真实Bun Worker跨await控制协议。面板下一反应
  可在乐观渲染后取代旧请求，旧回执保持superseded；组合检查另核对最终界面和持久值。
- 受控IPC/React宿主检查、插件编译入口与类型、Web/桌面探针类型和Worker协议通过；
  日志/tmp/readaware-c04-image-focused-current.log、readaware-c04-image-panels-public.log、
  readaware-c04-image-worker-current.log、readaware-c04-image-consumer-current.log、
  readaware-c04-image-text-consumer.log和readaware-c04-image-types-current.log。
  这不是新增Tauri/SQLite/真实模型验收。图片ResizeObserver/窗口响应式布局、自动
  chat/灯箱焦点、原生选区、阅读设置重排、贡献注册/退休、目录/凭据等来源仍缺；
  observeSession的reaction仍未开放，C04保持部分，C05–C09未实施，C01–C03待集中验收。
- 本批相邻授权/插件目录/Worker host 68项、Listening Desk16项、Text Desk44项和
  生成/库存契约23项通过，Web及桌面探针最终类型通过。日志补充
  /tmp/readaware-c04-image-adjacent.log及readaware-c04-image-contracts.log。
  Text Desk编译版本断言随0.23更新；面板组合测试按既有superseded回执语义捕获
  被下一反应取代的请求，并保持循环拒绝、独立根、最终界面和持久值断言。

- 图片/面板观察批次已提交 `7494f0fb`。本批接阅读外观来源：普通UI保存捕获user，
  Agent/插件settings写的actor经KV镜像/回滚进入基础atom，全局/本书有效设置及
  auto配色只合并实际改变输出的输入；修改其他书/不生效设置不触发当前CSS重绘。
  切回全局使用scope变更的来源；本地新值不被后来的漫游汇总通知再次重标。
- 字体请求在await前捕获context，并按渲染器/调用身份淘汰旧结果；字体较早完成、
  阅读器替换或卸载不能覆盖当前CSS。StrictMode重放保留同一来源。正文宽度/
  间距用Foliate属性批次，延迟custom-element回调不会重复触发；样式展开与固定页
  配色/布局反馈携带不透明context，旧文档字体完成不展开新文档，相同CSS不重排。
- 公开插件withEvent→settings全局/本书/auto主题→实际React hooks及受控IPC通过，
  含其他书不重绘、原生切scope、写失败回滚来源、较早字体/替换阅读器/卸载淘汰。
  Foliate编译产物的属性回调协议、固定页异步配色绘制和布局重建context通过。
  已向现有Tauri paginator场景加入真实CSS/字体展开/宽度重排来源断言，尚未运行。
- 日志/tmp/readaware-c04-appearance-public.log、readaware-c04-appearance-engine.log、
  readaware-c04-appearance-build.log、readaware-c04-appearance-types.log；相邻领域/
  Agent设置/事件/KV检查仅旧UI origin=null断言失败，按实际user来源更新后定向
  durability通过，其他已过结果保留于readaware-c04-appearance-adjacent.log。
  最终来源/存储/漫游组合另见readaware-c04-appearance-final.log。
- 本批最终三个隔离来源/持久化组合、Web/desktop类型均终态通过；生成校验与23项
  库存/模型契约通过（readaware-c04-appearance-contracts.log）。未增加真实Tauri证据。
- 仍缺布局模式切换导致的整引擎重建来源、窗口响应式布局/图片ResizeObserver、
  自动chat/灯箱及显式焦点/原生选区、贡献注册/退休/字体主题换代、目录/凭据及
  其余观察来源。reading.observeSession reaction仍未开放。C04继续部分；
  C05–C09未实施、C01–C03真实桌面组合待集中验收，完整范围保留。

- 排版/字体批次已提交 `29f0e58a`。C04本批在React提交时捕获同书布局切换来源，
  旧引擎清理前更新，延迟解析/定位/就绪和失败使用该次actor；首开来源保持独立。
  相同输入/无关设置和StrictMode重放不生成新身份；选择绑定/退役、模式/朗读
  会话重绑也沿用触发来源，旧engine清理不能覆盖替代engine。
- 公开插件设置→真实React hooks/受控IPC→宿主engine适配器已验循环来源保持、
  重复反应拒绝和后续原生独立切换；同会话延迟ready/失败、选区绑定、正在播放的
  取消来源及模式hook重绑通过。集中真实Tauri整引擎布局/音频仍待验。
- 日志/tmp/readaware-c04-layout-source.log（其余44项通过，新播放夹具未产生状态
  变化的断言失败；改为真实controller播放后停止，定向11项通过）、
  readaware-c04-layout-causality.log、readaware-c04-layout-mode.log，31项相邻检查
  readaware-c04-layout-adjacent.log；最终Web/desktop类型终态通过，见
  readaware-c04-layout-types-final.log。未把无变化的通知改为强制发布来迎合测试。
- 本批生成结果校验及23项库存/模型契约终态通过，见readaware-c04-layout-contracts.log。
- 剩余C04断点为原生焦点/选区/窗口等派生反馈、贡献换代和设置目录/凭据来源；
  observeSession reaction仍未开放。C05–C09及集中桌面验收保持完整范围。

## 验收

接线阶段检查改动涉及的契约、授权、并发、持久写、取消/释放与类型。接通九类
后在隔离 macOS Tauri 中通过编译 Worker/Agent 实际端口及第一方消费者验证组合，
原生事务/日志/任务恢复须观察实际 SQLite 和进程重启。新增打包边界须验发布包。
模型工具选择和表述另按受影响真实模型场景验证，不用脚本模型替代语义结论。
不把旧的全量模型质量失败、市场发布或其他平台扩成这次九类能力之外的任务。

- C04 本批接通实际DOM焦点与原生选区来源：Agent/全书及受限插件的focus、聊天
  打开/AskAI与灯箱初始焦点沿发起actor；同一intent只签发一次来源，异步RAF保留它。
  Foliate导航光标写/deselect通知宿主，粗指针settle按实际DOM样本和输入代次确认；
  已发布样本不再生成重复选区ID，旧文档不能清理当前选区。内层焦点与浏览器迟到的
  外层光标默认动作按最终DOM变化区分，不把派生变化误标为独立用户输入。
- 焦点RAF、拖选延迟翻页同时校验新导航/输入/文档身份；释放引擎淘汰旧回调。
  同步焦点造成的滚动只按实际目标坐标匹配来源，新的滚轮/键盘/指针输入失效旧样本。
  自动焦点仍沿既有可见性/前台弹层/准确目标及授权检查，不增加插件DOM访问权限。
- 公开all/book双插件焦点A→B→A拒绝循环，独立用户操作可继续；真实JSDOM焦点、
  嵌套焦点/选区与受控滚动检查、React面板焦点请求来源及编译后的实际Foliate导航
  选区/deselect协议通过。相邻阅读来源/选区/渲染屏障21项通过；Web/desktop类型通过。
  日志为/tmp/readaware-c04-native-public.log、readaware-c04-native-panels.log、
  readaware-c04-native-engine.log、readaware-c04-native-adjacent.log和
  readaware-c04-native-types-complete.log。这些不是真实Tauri布局/焦点验收。
- 已在集中Tauri paginator候选场景加入真实iframe焦点→重排来源及新导航淘汰旧焦点
  RAF，尚未执行。剩余C04为窗口响应式布局/图片ResizeObserver、其他异步原生反馈、
  贡献注册/退休、设置目录/凭据与其余观察来源；observeSession reaction仍未开放。
  C05–C09完整保留未实施，C01–C03与新增路径待集中桌面组合验收。
- 本批最终生成校验及23项能力库存/模型契约检查通过；编译协议测试与Tauri候选
  场景单独类型检查通过（临时配置补用仓库现有Bun类型目录）。日志为
  /tmp/readaware-c04-native-generated.log、readaware-c04-native-contracts.log和
  readaware-c04-native-protocol-types.log。未启动新增桌面/模型验收。

- 原生焦点/选区批次已提交 `4d44a659`。C04本批plugins1.7接通贡献目录观察的
  独立delivery和公共注册来源，并提供ctx.withEvent(delivery,registration)绑定已存在
  的贡献句柄。更新/释放逐次复核本激活的真实句柄与事件租期，订阅/资源句柄拒绝；
  普通句柄供独立用户操作，绑定释放跨Worker等待宿主回执，错误不再仅写后台日志。
  回执表示注册退休，已开始的提供者清理仍按现有lifecycle drain排空。
- 注册表按最终实际条目/owner变化合并来源；更新无变化不通知，同一对象重新注册
  仍以新owner通知。失败嵌套注册/清理不会把来源带进成功父批次，回滚恢复原owner；
  新通知重入时停止投递旧样本。异步listVoices使用获胜设置版本的来源，旧结果不发布；
  sync transport配置/换代/关闭通知同源，仍保留旧会话排空和失败替换恢复。
- Maintenance Desk0.5贡献目录自动发布使用绑定上下文并等待，循环delivery不发布；
  渲染后的用户动作仍用原激活上下文。公开all/book A→B→A循环拒绝及独立用户根、
  事件中注册/释放、新旧/外来/资源句柄拒绝通过；实际Bun Worker跨await携带令牌及
  释放回执通过，生产host受控Worker验证过期/循环/外来令牌无副作用并释放回调。
- 本批相关记录：/tmp/readaware-c04-contributions-public.log、
  readaware-c04-contributions-registry.log、readaware-c04-contributions-providers.log、
  readaware-c04-contributions-worker.log、readaware-c04-contributions-consumer.log。
  它们是同realm/真实Bun Worker与受控IPC/提供者证据，不作新增Tauri/真实服务验收。
- C04下一步仍为窗口响应式布局/图片ResizeObserver、其他异步原生反馈、字体/主题/
  分段模式等贡献派生消费者、插件安装状态观察、设置目录/凭据及其他观察来源；
  observeSession reaction仍未开放。C05–C09全部保留未实施，C01–C03及新增路径
  的真实桌面/SQLite/模型组合留集中验收；本批不是整个C04完成。
- 本批最终Plugin runtime contracts为413通过/0失败；受影响注册表/激活回滚/公共
  目录21项、语音/传输28项、实际Worker/宿主边界95项、Maintenance Desk32项通过。
  Core/Agent/plugin-types/Web/desktop类型与相关插件构建通过，Maintenance Desk
  独立类型通过；生成校验及27项Core/库存/模型契约通过。日志为
  /tmp/readaware-c04-contributions-runtime-final.log、readaware-c04-contributions-types-complete.log、
  readaware-c04-contributions-consumer-types.log和readaware-c04-contributions-contracts.log。
  测试夹具为新增withEvent重载补了显式mock类型转换；没有放松产品类型或授权检查。
- 全类型检查重建了Jumper内联的Core能力目录（plugins1.3→1.7）；同步保留该生成
  产物，Jumper42项检查通过，日志/tmp/readaware-c04-contributions-jumper-build-sync.log。

- 贡献目录批次已提交 `b221a8cc`。C04本批接选中字体/主题与分段模式消费者：
  选中字体/主题与分段提供者换代后的消费者已接来源；注册表按key提供宿主私有快照，替换/移除在发布时更新，React批次中的后续无关注册不覆盖来源，同值换owner仍生效。阅读CSS/固定页配色与应用主题auto投影只采用实际改变的输入；启动主题缓存写入/清除同源。分段重建使用选中提供者的来源，目录变化不改当前请求；公开设置反应及React/受控IPC、替换/移除/回滚和独立用户根检查通过，真实字体、布局与Worker分段仍待集中Tauri验收。
- 本批使用宿主选中注册快照保留被移除项的来源；弱缓存随消费快照存活，无公开
  因果字段。失败激活不改变选中快照，精确值重新注册仍淘汰旧分段实现身份。
- 定向React/受控IPC与注册表检查31项通过，相邻模式持久写/选择、目录、交互
  注册和KV队列合计64项通过。主题测试补齐插件启动就绪状态，并按既有auto语义
  验证浅色应用对应warm阅读配色，没有改动产品回退规则。最终检查日志见账本。
- 下一步仍为窗口响应式布局/图片ResizeObserver、其他异步原生反馈、插件安装
  状态观察、设置目录/凭据及其余消费者来源；reading.observeSession reaction仍
  未开放。C05–C09未实施，C01–C03与新增路径真实桌面/SQLite/模型验收集中后置。
- 本批最终相邻消费者/目录/模式持久写/KV检查64项通过，注册回滚与选中来源/实际
  React组合15项通过，Web及desktop探针类型通过；矩阵/模型生成校验和21项库存/
  模型契约通过。日志：/tmp/readaware-c04-contribution-consumers-final.log、
  readaware-c04-contribution-consumers-activation.log、
  readaware-c04-contribution-consumers-types-final.log、
  readaware-c04-contribution-consumers-contracts.log。未改变Worker公共契约或版本。

- 字体/主题/分段消费者批次已提交 `223a3fc3`。C04本批：窗口命令在派发前读基线，原生请求后的实际状态/客户区尺寸变化保留Agent、插件事件或原生用户来源；无变化不重标，取消或中途失败仍保留已观察效果。布局读按已准入窗口命令隔离合并，不能复用命令前的在途样本；尺寸不进入公开窗口数据。图片ResizeObserver只接受匹配窗口尺寸的来源，重复尺寸不通知，父组件重绘不冒用旧pan/zoom来源；新变换、新尺寸或卸载退休旧异步反馈。受控原生/实际React与公开插件路径通过；未关联的动画后续帧、同viewport其他容器变化和OS读取失败仍无完整来源，C04不关闭，真实Tauri布局后置。
- 实际窗口读取使用既有core默认读权限的innerSize/scaleFactor，换算CSS客户区尺寸；
  没有修改原生权限或公共窗口契约。命令回执仍为requested，不证明动画完成。
- 本批21项窗口/图片/布局来源检查与9项Agent/Workspace Profiles消费者检查通过，
  Web和desktop探针类型通过。日志为/tmp/readaware-c04-window-layout-final.log、
  readaware-c04-window-layout-consumers.log、readaware-c04-window-layout-types-final.log。
- 当前具体下一步：将窗口布局来源接入FoliateReaderView的ResizeObserver、Foliate
  paginator/fixed-layout自己的ResizeObserver及useReaderPanels的窄窗口分支；处理
  请求后动画帧、同viewport容器重排、读取失败的归因，不能把未知变化当作已验证防环。
  其余安装状态、设置目录/凭据和自动消费者继续保留；reading.observeSession reaction
  仍未开放，C05–C09未实施，C01–C03及新增路径集中真实桌面验收待执行。
- 补充图片输入竞争验证：新缩放/平移/旋转/重置准入时立即递增意图代次，React提交前
  结束的旧窗口尺寸查询也不能发布旧来源。实际React组件观察序列检查通过，日志
  /tmp/readaware-c04-window-layout-input-race.log；不是原生动画验收。

- 窗口/图片批次已提交 `1157a05b`。C04本批：外层阅读器viewport的选区清除和正文宽度更新已接匹配窗口尺寸来源；新原生输入、选区或章节保护新选区，新尺寸/引擎替换/卸载退休旧反馈。公开插件窗口调用→宿主采样→实际React/受控几何及DOM选区检查通过，独立用户变化不继承旧循环。Foliate内部ResizeObserver与窄窗口面板分支仍待接，未覆盖后续原生动画或同viewport其他来源，真实Tauri布局留集中验收。
  定向React/DOM/原生适配器组合及相邻字体/选区检查6项通过，Web/desktop类型通过；日志/tmp/readaware-c04-reader-viewport.log与readaware-c04-reader-viewport-types.log。矩阵/模型生成校验及21项库存映射检查通过，日志readaware-c04-reader-viewport-contracts.log。
  下一步接paginator/fixed-layout自身ResizeObserver与useReaderPanels窄窗口分支；保留动画后续帧、同viewport其他变化、OS读失败和其余快照/设置目录/凭据/自动消费者来源。reading.observeSession reaction仍未开放；C05–C09未实施，C01–C03及新增路径待集中桌面验收。

- 外层阅读器重排已提交 `6465d8a1`。实施顺序调整：保留C04原生异步/响应式与其他来源断点，开始C05可用性完整调用链，避免其余能力一直等待防环前置工程。
- C05首条推理调用链已接：session2.1 operationAvailability与双scope Agent get_operation_availability共享llm.infer条件，按fast/smart和图像输入报告权限、账号凭据是否配置、模型选择、端点合法性与当前模型输入支持。无llm权限只返回权限缺失，不读取配置；返回无密钥/模型ID/端点地址，查询无网络探测或旧凭据迁移。配置读取失败为unknown并带错误码，注册/目录/网络提示不当健康，提供者健康明确unknown。插件ask/askDetailed在图片读取后重验本地条件并取当前runtime，unknown远端健康不阻断尝试；ReadAware订阅入口检查实际同步会话而非无关API key。Text Desk0.24新增Smart图像条件页，编译消费者和实际Bun Worker取消协议有受控验证。其他语义操作的阅读对象、提供者与执行条件、真实Tauri/模型验收仍待C05后续补齐，C04未完成，C06–C09未实施。
  检查：80项宿主/公共权限/推理/配置/实际Bun Worker/取消协议通过；Text Desk构建、类型与45项消费者检查通过；Web/desktop类型通过。日志/tmp/readaware-c05-preflight-verified.log、readaware-c05-textdesk.log和readaware-c05-inference-types-complete.log。
  Agent双scope/发现/工具输出与可用性16项及类型通过；Core/库存/模型22项与生成校验通过。日志readaware-c05-agent-contracts-final.log、readaware-c05-agent-types.log和readaware-c05-inventory.log。修正Text Desk旧withEvent测试替身的重载类型；无新增真实模型或Tauri证据。
  C01–C09全部保留；下一步扩展C05阅读对象与可调用提供者条件及其实际执行适配器。C04仍余Foliate内部ResizeObserver/面板响应式、原生动画后续帧/同viewport变化/读取失败及其余观察和自动消费者来源，reading.observeSession reaction未开放；C06–C09未实施，真实桌面组合验收集中后置。

- 推理条件批次已提交 `00919e14`。C05阅读操作条件已接：session2.2与Agent查询支持按bookId/可选sessionId检查reading.playback(start/stop)和reading.mode.configure(active/模式/单元)。先检查reading:write及书授权，拒绝时不读目标状态；未打开目标书不披露当前书和提供者。阅读器直接询问已绑定的实际模式/朗读控制器，模式注册/格式/单元校验与configure共用，朗读实时语音/单元条件与start共用；停止和关闭模式不被启动条件阻止。查询不播放、不分段、不探测提供者；注册/语音存在仅为本地条件，执行成功仍unknown。切书/会话替换、查询后语音或模式提供者失效在执行时拒绝。Text Desk0.25新增条件页及启用模式/开始/停止动作，刷新和执行固定用户查看的书与会话。受控控制器/真实React、公共权限/当前书围栏、Bun Worker协议、Agent及编译消费者通过；真实Tauri/音频/提供者验收仍待集中执行。C05其他操作条件、C04和C06–C09保持未完成范围。
  97项受控宿主/控制器/公共授权/实际Bun Worker检查、真实React模式绑定检查、9项Agent工具/输出与类型、2项Core检查通过；Text Desk构建/类型及46项编译消费者检查通过，Web/desktop类型通过。相邻检查首轮24过/1旧版本断言失败，更新到session2.2后单文件10项通过，不扩大重跑。日志/tmp/readaware-c05-reading-{host,mode-hook,adjacent,capabilities,textdesk,types-final}.log。
  下一步继续C05书籍正文准备/源提供者及其他语义操作条件；C04剩余来源、C06–C09和集中桌面组合验收均保留，目标仍active。
  矩阵/模型生成及21项库存映射检查通过，日志/tmp/readaware-c05-reading-inventory.log；此次增加的是READ16/READ18操作条件，不把READ15算法注册权限开放给Agent。

- C05 正文批次：C05正文准备条件已接：session2.3与Agent get_operation_availability接受library.text.prepare、bookId及rebuild/priority/timeoutMs，共用真实任务owner的16项容量、重建冲突与源检查。只读源元数据，不抽取、不下载、不打开书源/传输；缺本地文件时复用实际同步下载准入，缺凭据/关闭同步/提供者退休明确拒绝，网络与解析成功保持unknown。读取失败保留unknown/稳定错误码；实际start/prepare再次核对。library1.31允许当前书授权启动/调度正文任务：围栏覆盖准入、历史写结算、执行与暂停，切书取消该租约，终态释放；其他消费者及已派发写不追溯撤销。Text Desk0.26消费条件页，未知可尝试、已知缺项不提供执行，重建保留确认。新增路径已有受控宿主/源/同步/当前书/Agent及编译消费者证据；真实Tauri/下载/书源/SQLite仍待集中验收。
  当前未封闭C05全部操作；C04及C06–C09仍保留。接下来实施C06通用类型化跨插件调用，
  随后继续其余操作条件、跨领域提交/撤销、耐久任务、变化日志和集中桌面验收。

- 正文批次证据：Core3项（readaware-c05-text-core.log）、Agent3项与类型
  （readaware-c05-text-agent.log、readaware-c05-text-agent-types-final.log）、
  宿主源/任务/域41项及补充准入通知回归（readaware-c05-text-tasks.log、
  readaware-c05-text-task-final.log）、公开授权与当前书6项（readaware-c05-text-public.log）、
  同步准入/备份隔离子进程7项（readaware-c05-text-source-sync.log）、
  Worker/对象范围/能力/阅读相邻58项（readaware-c05-text-runtime.log）、
  Text Desk编译入口/源47项及类型构建（readaware-c05-text-consumer-release.log）、
  Web/desktop类型（readaware-c05-text-types-final.log、readaware-c05-text-desktop-types.log）、
  库存/模型21项与生成校验（readaware-c05-text-inventory.log）。日志均在/tmp。
  这些检查不替代新增Tauri/真实书源下载/SQLite/音频/模型验收。

- C06 本批 plugins1.8 接版本化 manifest.services 输入/输出契约，以及 listServices/callService。
  声明不执行提供者；引用绑定插件、服务、版本与激活代次，替换后旧引用拒绝。
  每次调用创建独立 Worker，跳过 activate/deactivate，仅执行声明的 services 导出。
  权限取服务声明且双方都须具备；设置路径和网络目的地取交集，书籍须双方授权。
  caller/provider切书、取消、停用、更新及120秒期限淘汰迟到结果；等待实际执行清理
  才释放并发槽。同提供者各导出共用4槽，调用者4槽、全局16槽，嵌套重复链拒绝。
- 书服务只能访问固定书索引的提供者私有文档；宿主强制分页过滤、读取/观察结果检查，
  修改先检查归属再以同一版本提交，竞争不越权覆盖。无书籍归属的KV/凭据/资产和
  用量查询留给双方全书授权的global服务；book服务不接收启动或广播的全局KV镜像。
  服务无法注册普通激活贡献，私有资源及观察/任务随本次调用结束清理。
- Jumper0.10声明bookmark-page，按宿主固定书分页并再次核对文档内target.bookId，
  不返回错索引的外书书签。Text Desk0.27书籍详情消费此服务：分页保留观察到的代次，
  服务变化/过期游标需用户刷新；无服务与空页分别显示，权限和执行失败不伪装为空。
- Core/schema与权限/书存储/容量回归通过；真实Bun caller Worker→host→独立provider
  Worker已验证根激活状态隔离、权限缩减、外书/私有KV拒绝、取消/停用与错误结果清理。
  运行时422项通过；Jumper42项与Text Desk受影响编译消费者回归通过，类型检查通过
  的具体日志为/tmp/readaware-c06-jumper.log、readaware-c06-textdesk-fixed.log、
  readaware-c06-runtime.log、readaware-c06-service-proof.log和readaware-c06-types-final.log。
  Bun异步matcher在发起取消之前等待promise曾使组合测试阻塞；改为先收实际结果再断言，
  没有放宽产品断言或延长超时。上述受控存储与Bun Worker不是Tauri/SQLite验收。
- C06通用Agent服务发现/调用已接：list_plugin_services与call_plugin_service通过实际宿主端口进入同一服务broker；书内越书提前拒绝，冻结参数/权限/设置路径/网络范围逐次批准。受限阅读上下文拒绝需reading或conversations权限的通用服务，策略收紧取消调用。批准后仅签发本次声明权限，拒绝则不执行；服务换代/撤权/取消继续复核。
  真实Bun Worker组合已验证Agent工具发现、拒绝/批准、隔离执行及越书拒绝；交互答案为受控端口，尚非真实桌面批准或模型语义验收。
  C04其余来源、C05其余条件、C07跨领域原子提交/撤销、C08耐久多步骤工作、C09变化续读
  全部仍在当前范围；C01–C03和新增C06路径真实桌面组合验收待集中执行。

- C06 Agent接线验证：Agent及Web/desktop类型通过，实际Agent工具→宿主→Bun Worker与库存映射通过；日志/tmp/readaware-c06-agent-service-types.log、readaware-c06-agent-host-final.log、readaware-c06-agent-worker.log、readaware-c06-agent-inventory.log。此前Core包类型检查被未改动的operation-availability.test.ts三处夹具类型错误阻断，未将其修复扩入本批；这不冒充Core全包类型通过。

- C07原生事务批次：新增宿主内部atomic_commit与aggregate revisions命令，复用commit_events_in_transaction、设置事务内写和插件文档事务内CAS。同一IMMEDIATE事务检查事件历史摘要/设置持久原值/文档revision，后段冲突回滚事件、投影及设置；重复事件拒绝盲重试，旧HLC合并也会改变历史摘要。总操作100/负载8MiB；一般设置内改变启动或文件关联的系统副作用拒绝纳入。单项SQLite组合检查已观察后段文档冲突全回滚、成功三域持久化、旧预览拒绝；cargo编译通过，日志/tmp/readaware-c07-native-final.log。首轮夹具漏book.imported必填format，补齐实际事件字段后通过。此为原生前置，不是C07完整能力：仍缺语义操作编译/冻结预览、所有影响对象授权与读围栏、提交后同源通知、持久回执/条件撤销、Agent/公共插件/消费者链路；Tauri验收未做。后续直接从这些断点接续，不重盘点、不扩大测试。

- C07宿主编译批次：core transactions契约只接受book.metadata、settings及自有document.put/delete，未知/外部操作拒绝；TransactionSession保留5分钟/最多16个冻结预览，原生最终比较版本/字节。复用bookMetadataPatch、设置catalog/编码与KV发布，宿主提交纳入领域/插件写屏障并于成功后发布领域/设置来源。schema46 atomic_receipts随原事务写owner/id/hash、逆向计划及提交后版本；相同请求身份返回旧回执，改参数复用身份拒绝。撤销编译使用提交后版本/设置字节/文档revision条件，精确恢复旧KV包括覆盖存在性，作为新事务写事件；不提供盲重放/redo。插件清私有数据同步删除plugin:<id>回执。原生编译与单项SQLite组合检查、既有设置durability检查、Web/desktop类型通过，日志/tmp/readaware-c07-receipts-final.log、readaware-c07-settings-check.log、readaware-c07-types-complete.log。类型首轮SettingsTarget含all-books不适用于快照查询，改为分global/各书展示先前值；无新增Tauri证据。
  仍缺：TransactionAuthority.acquire/assertDocumentBook/withDocumentWrite的实际Agent及插件适配（操作权限、书域/当前书、设置目标、生命周期与真实文档observer）；四个公开方法的Worker接线、Agent逐次批准工具、第一方消费者及集中Tauri验收。Session是宿主模块，尚无产品调用者，不计为C07闭合。接续应直接把这条链接到实际调用者，不重做原生事务或扩大测试。

- C07接线批次：transactions1.0公开preview/commit/previewUndo/receipt，实际context/Worker options及提交取消排空已接。插件书域/当前书围栏、library:write、设置路径/目标、自有文档归属与本激活来源逐次复核；预览限时、消费一次，每激活跨actor共享16份预览/在途提交额度，停用退休预览并排空已派发调用，空闲时解除生命周期订阅；check文档只加版本条件，不发布假写通知。Agent四工具接实际runtime port，书内只改本书元数据/本书设置，无插件私有数据权；批准弹窗用宿主冻结内容，拒绝无执行。Workspace Profiles0.8应用预设联合document.check和settings，杜绝读完预设后被替换仍应用；新增可见撤销及获批准undo_workspace_profile，返回事务ID供回执查询。
  派发前重验设置目录/提供者版本；本书或all-books阅读变更另外持有原生只读全局排版基线，避免撤销恢复继承后使用已变化的全局值却发布旧值。此基线不写入KV，若同批也修改全局排版，撤销改用该批提交后的基线。Workspace Profiles编译/类型与受影响检查通过，初轮两处旧工具数/版本断言已更新且定向复跑通过；Agent类型、Web/desktop类型、库存与统一模型检查通过，模型旧目录数39改为40；无新增全量回归。受控Agent批准与真实Bun Worker调用transactions.preview后拒绝只读插件写入通过；原生单项SQLite组合涵盖跨域回滚、持久回执与只读条件，仍不是Tauri组合成功证据。相关日志/tmp/readaware-c07-boundaries.log、readaware-c07-workspace-final.log、readaware-c07-workspace-rerun.log、readaware-c07-contracts.log、readaware-c07-model-final.log、readaware-c07-types-final.log、readaware-c07-native-complete.log。
  C07接线已推进到消费者；集中仍需真实Agent批准UI、全/书域插件三域正向与冲突、切书/停用取消、进程重启回执和条件撤销及Workspace Profiles可见动作。C04、C05余项与C08/C09继续，不把本批当全目标完成。

- C04/C09凭据来源补全：秘密队列持久成功通知保留宿主actor/cause，设置观察复制该来源；
  插件秘密set/remove从operationActor跨原生写入延续plugin-storage-changed来源。
  复用既有关键检查验证同规则反馈拒绝、失败不通知，以及SQLite回滚不留通知、秘密族隔离和不泄露值/槽名。
  日志 `/tmp/readaware-secret-cause-check.log`、`/tmp/readaware-secret-native.log`、`/tmp/readaware-secret-web-types.log`。
  凭据漫游自动发布/远端重放的完整因果、目录atom及其余C04/C05断点继续保留，真实Tauri仍待集中验收。

- C05图谱批次：session2.5新增memory.graph.generate，bookId/mode/maxChapters复用任务参数，
  插件先检查memory:write、service:llm及当前书授权，再读调用方图谱任务容量、持久章节边界与fast模型。
  只读现有本地来源；不启动正文提取/分类/模型或内容提供者。缺少可解析章节边界明确不可用，
  读取失败及远端健康保持unknown；不返回正文、模型ID、地址或凭据。实际任务准入复用容量检查，
  派发时重新核对对象/边界/模型，后续章节继续走已有授权、版本和阅读边界围栏。
  Agent get_operation_availability已接；Memory Desk0.17启动/重建/重试先显示条件，允许后仍进入批准表单。
  Web/desktop及Agent类型、Memory Desk类型/构建/既有任务流程，权限/跨书拒绝和容量关键检查通过。
  日志 `/tmp/readaware-graph-web-types.log`、`/tmp/readaware-graph-agent-types.log`、`/tmp/readaware-graph-permission.log`、`/tmp/readaware-graph-capacity.log`。
  顺带适配消费者旧withEvent测试替身的注册重载，不新增通用测试框架。真实Worker/Tauri及其他操作仍待补。
