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
| F6 | 现有设置 Worker 与实际设置界面修改/继承/重置；观察受影响 UI、授权与重启结果 |
| F7 | RSS/Dictionary 和插件安装/升级/撤权/故障恢复；数据、Worker 生命周期和真实消费者 |
| F8 | 文件/目录/拖放/外部应用、网络、备份恢复/诊断/同步；原生回执及重读，外部环境单列 |

支持边界：macOS aarch64 debug Tauri。跨平台、全格式、打包 CSP、跨设备及远端服务必须各有证据。
CON11/CON12 等明确不开放的能力和 SYS18 遗留移动桥依据现有产品边界审定不适用，不作为新增产品要求。
READ16 独立跟随、EXT06 富文本编辑、MORE02 跨插件因果防环及 MORE06 任意跨插件调用语义仍未实现/未定义；已有子能力继续验证。

## 逐行覆盖

| ID | 能力 | 主流程 | 当前结果与证据 |
| --- | --- | --- | --- |
| LIB01 | 枚举/查询书籍与书目元数据 | F1 | 本机编译Library Desk列举/读取实际书目、编辑后刷新及Worker重启重读通过；其他查询/actor待验，见第二十四流程 |
| LIB02 | 修改标题/作者 | F1 | 本机编译Library Desk空白标题拒绝、改书名/中文作者、原生重读及Worker重启保持通过；其他actor待验，见第二十四流程 |
| LIB03 | 收藏/取消收藏 | F1 | 本机编译Library Desk收藏/取消收藏、刷新Yes/No及重启保持通过；其他actor待验，见第二十四流程 |
| LIB04 | 删除单本书 | F1 | 本机Library Desk单书复核前不删，明确删除后记录null/原文件不存在；其他actor/故障待验，见第二十四流程 |
| LIB05 | 批量删除书籍 | F1 | 本机Agent真实批准UI拒绝保留/批准两书删除，Worker正常批删及恢复后旧清理pending保护通过；文件故障/崩溃待验，见第二十四流程 |
| LIB06 | 导入已有支持格式的书籍字节 | F1 | 本机FB2 user/Worker选择器、EPUB/MOBI/AZW3/fb2.zip/CBZ/TXT/HTML原生字节导入与源解析通过；CBR/别名/其他actor待验；第38流程暂存残留已加设备本地意图，真实重载/进程重启回收、已提交书保持/重复导入/提交失败回收通过；release待验，见第二十一/三十九流程 |
| LIB07 | 识别格式/DRM/损坏文件并报告 | F1 | 部分通过：合成加密MOBI入库后源打开明确book/unsupported-encryption，未冒充可读；损坏文件/UI提示待验，见第二十一流程 |
| LIB08 | 查询/读取书籍原文件与本地可用性 | F1 | 本机 Library Desk 原文件状态、原生导出字节一致及取消通过；其他格式/actor待验 |
| LIB09 | 提取/显示封面与封面可用状态 | F1 | 本机 FB2 封面显示/解码、PNG原生保存及插件副本重读通过；其他格式待验 |
| LIB10 | 缺失封面/元数据后台补齐 | F1 | 待验 |
| LIB11 | 重复检测、同源书合并和 ID 重定向 | F1 | 本机同文件插件重复导入保留同ID通过；合并/重定向待验 |
| LIB12 | 创建/幂等绑定虚拟书并更新标题 | F1 | 本机 RSS 真 Worker 订阅创建虚拟书通过；幂等/改名其他路径待验 |
| LIB13 | 移除插件自有虚拟书 | F1 | 本机 RSS 退订后书/源/缓存删除通过；故障恢复待验 |
| LIB14 | 虚拟内容修订/离线缓存/当前书刷新 | F1 | 本机 RSS 离线重启缓存、新版本重开和文章重排位置恢复通过；标注/旧引用拒绝待验 |
| LIB15 | 列出集合及其成员 | F1 | 本机Library Desk列集合/详情成员数、原生booksIn同ID通过；分页/其他actor待验，见第二十四流程 |
| LIB16 | 创建/重命名集合 | F1 | 本机编译Library Desk创建/改名集合ID保持通过；其他actor待验，见第二十四流程 |
| LIB17 | 删除集合 | F1 | 本机编译Library Desk未确认不删、确认删集合且成员书保留/归属null通过；其他actor待验，见第二十四流程 |
| LIB18 | 批量分配/移出集合 | F1 | 本机Library Desk单成员确认移动及删除集合后解除归属通过；多成员批次由第23流程原生创建覆盖，插件批量移动仍待验，见第二十四流程 |
| TXT01 | 读取抽取章节目录 | F2 | 本机FB2宿主及book/global Agent真实Tauri端口返回两章index/number/字数一致，抽取目录无href；插件直接查询/其他格式待验，见第三十七流程 |
| TXT02 | 读取原书分层导航目录及 href | F2 | 本机FB2宿主及book Agent原书导航含两正文节和脚注节，ordinal/href/同源版本一致；嵌套目录/超大目录/其他格式待验，见第三十七流程 |
| TXT03 | 按抽取章节读正文/分段 | F2 | 本机book/global Agent真实Tauri端口读第二章原文相同、part0/totalParts1，未读章节围栏拒绝通过；长章分段/插件直接读取待验，见第三十七流程 |
| TXT04 | 查询本地正文准备状态与文本存在性 | F2 | 本机短/正常FB2及空白PDF、EPUB/MOBI/AZW3/fb2.zip/CBZ/TXT/HTML正文准备与available/textless一致；短章节另读源文本确认存在；Worker权限/Agent双scope和缺源/换源通过；CBR等待验 |
| TXT05 | 启动、重建、暂停让路正文抽取 | F2 | 本机准备/重建、共享取消/退役隔离、激活期禁止、宿主忙拒绝通过；Worker重启历史已有证据；让路/截止/进程重启待验 |
| TXT06 | 当前书及跨书多查询正文检索 | F2 | 编译Text Desk真实Worker三查询两章桶去重、两书索引搜索/详情/无命中/空输入拒绝通过，宿主重读及global Agent结果一致；取消/迟到结果不交付/明确重试已复验，完整负载/其他格式待验，见第三十七/三十八流程 |
| TXT07 | 引擎全文精确搜索并返回 CFI | F2 | 本机FB2真Worker跨三节精确搜索45条分页20/20/5及末项CFI打开原文通过；book/global Agent按12条续页一致；其他格式待验，见第四十流程 |
| TXT08 | 搜索分页、取消、背压和过期查询淘汰 | F2 | 本机FB2分页45条无重漏、取消/迟到隔离/换查询退役、真实Worker32读上限拒绝超额/释放后恢复、实际blob换源旧游标拒绝通过；读取中换源、其他格式/packaged/平台待验，见第三十八及四十至四十二流程 |
| TXT09 | 读取当前可见文本/阅读游标 | F2 | 本机FB2实际开书后会话ready返回正文及range/available/未截断状态；本轮窗口hidden，不计前台可见范围像素校验，PDF/自动游标边界待验，见第三十七流程 |
| TXT10 | 选区附近句段上下文 | F2 | 本机 Text Desk 命中段落与前后文显示通过；其他状态待验 |
| TXT11 | 书内脚注/链接目标解析与预览 | F2 | 本机 FB2 真实Worker列举/读脚注/宿主浮层通过；其他格式待验 |
| TXT12 | 书内图片读取与灯箱缩放预览 | F2 | 本机FB2图像/灯箱及Text Desk真实远端识图通过（精细几何有误）；Agent版本错误恢复已修，同题14.9秒真实读图完成，视觉主评3（矩形/位置错），旧51次超时保留；其他格式待验，见第十五/二十二流程 |
| TXT13 | 统一位置/范围解析、校验、版本与失效 | F2 | 本机原文范围→选区→标注使用相同源版本/CFI通过；失效等待验 |
| READ01 | 打开书/恢复保存位置 | F3 | 本机图片动作及Text Desk搜索详情打开精确书ID/ready，RSS重排后恢复同一文章；release正常退出重启恢复第二章CFI通过；其他入口待验，见第三十一/三十三/三十七流程 |
| READ02 | 关闭当前书并返回书架 | F3 | 本机guard关书通过；各actor消费者待验 |
| READ03 | 按章节/标注/href/CFI 跳转 | F3 | 本机FB2 Jumper/Agent原文CFI及PDF Worker跳转/缺失href/旧源拒绝通过；Text Desk末页命中打开第三节Row45并读回原文；其他目标/格式待验，见第二十二及四十流程 |
| READ04 | 前后翻页、章节、书首书尾 | F3 | 本机FB2/PDF真实Worker前后翻页通过；章/首尾/其他格式待验 |
| READ05 | 按进度/固定版式页索引定位 | F3 | 本机FB2/PDF Worker按进度及非法值拒绝通过；PDF四页CFI定位、页码顶部/滑条已修并核对；pageIndex入口待验，见第二十二流程 |
| READ06 | 导航历史 back/forward 及可用性 | F3 | 本机FB2 Worker/Jumper及PDF Worker前后历史通过；其他格式/跨书待验 |
| READ07 | 统一当前书/位置/加载/历史快照 | F3 | 本机FB2→PDF→关书快照/新会话ID/权限隔离及词典缓存跟随通过；PDF可见正文状态待核，见第十七流程 |
| READ08 | 会话开关/章节/进度事件 | F3 | 部分通过：真实Worker观察idle→loading→ready、跨书新会话、关闭清空及revision递增；章节/进度专门事件待验，见第十七流程 |
| READ09 | 阅读沉浸/显示隐藏控制层 | F3 | 本机Listening Desk显隐状态通过；release原生space显示、模式进入/退出实际绘制通过，见第三十一/三十四流程 |
| READ10 | 目录/注释/外观/聊天面板开关 | F3 | 本机真实Worker开关目录/聊天/外观通过，可见截图及弹窗DOM核实；release原生Notes列表/全文/定位通过；其他组合待验，见第二十二/三十二流程 |
| READ11 | 阅读面板尺寸/布局与焦点恢复 | F3 | 本机插件宽度设置/恢复已有证据；真实Worker内容/目录/聊天DOM焦点及隐藏/弹窗拒绝、Agent端口通过；窄窗/OS激活等未验，见第二十二流程 |
| READ12 | 固定版式自动适配；图片缩放/平移/旋转 | F3 | 待验 |
| READ13 | 读取/建立/清除文本选区 | F3 | 前台已开书/重开选择通过；首次后台打开后选区消失待定位 |
| READ14 | 临时范围强调/搜索标记及释放 | F3 | release模式当前句/段强调及退出清除真实绘制通过；公共putEmphasis及搜索标记待验，见第三十四流程 |
| READ15 | 贡献句子/段落等分段模式 | F3 | 本机Sentence Reader实际CFI通过；release句4单元/段3单元及两句整段强调真实绘制通过；其他格式待验，见第三十四流程 |
| READ16 | 启停模式/上下一单元/跟随/回当前 | F3 | 本机调用与release真实启停/上下句/下一段/跨章回当前/退出清除强调通过；独立follow未实现，跨进程模式恢复待验，见第三十四流程 |
| READ17 | 列声音并合成音频的提供者 | F3 | 待验 |
| READ18 | 开始/停止朗读、播放位置与 fallback 状态 | F3 | 本机插件TTS失败后系统fallback启动/逐句跨章推进/停止状态通过；音质/其他后端待验 |
| READ19 | 完成页、标记读完/撤销读完 | F3 | 待验 |
| READ20 | 跨书/并发导航的取消、序列化与回执 | F3 | 待验 |
| ANN01 | 列出/按书按词按类型检索标注 | F3 | 本机插件及 domain 列出两类自有标注通过；检索/分页待验 |
| ANN02 | 创建高亮 | F3 | 本机真实 Worker 改为高亮并绘制通过；release物理拖选/UI创建黄色高亮及进程重启绘制通过，见第三十二流程 |
| ANN03 | 创建下划线样式 | F3 | 本机插件创建绿色下划线且实际绘制通过；其他格式待验 |
| ANN04 | 高亮改色/删除 | F3 | 本机改色/样式并删除、绘制同步通过；其他 actor 待验 |
| ANN05 | 创建/编辑/删除笔记 | F3 | 本机插件创建引用笔记、冲突拒绝/刷新编辑/删除通过；release物理拖选创建笔记/焦点/列表定位/重启保留通过，远端待验，见第三十二流程 |
| ANN06 | 读取/删除 ask 问题轨迹 | F3 | 待验 |
| ANN07 | 自动记录书内问题轨迹 | F3 | 待验 |
| ANN08 | 按 ID 读取、分页、批量/版本冲突标注操作 | F3 | 本机两项混合条件删除与旧版本编辑冲突保护通过；大分页待验 |
| ANN09 | 标注变化与远端失效观察 | F3 | 本机另一 actor 修改/删除与读回通过；远端失效待验 |
| STAT01 | 单书/全库/总览已结算阅读统计 | F3 | 本机合成12秒Worker/Agent查询一致；release真实阅读1064030ms的单书/全库总览UI均18m并与原生投影一致，见第三十五流程 |
| STAT02 | 周月年/连续阅读/热图/时段/成就派生 | F3 | 本机合成两日记录经Worker/Agent得到12秒、2活跃日/连续日和时段分布通过；release真实周/月/年/全部、热图/时段/里程碑UI与单日原生记录一致；其他时间边界待验，见第三十五流程 |
| STAT03 | 已持久的未结算时长/会话与采样时钟 | F3 | 本机合成待结算2桶分页、12秒总计、订阅和落盘后清零通过；实际采样时钟待验 |
| STAT04 | 计时/位置累积、小时结算和重启恢复 | F3 | 本机合成两日两桶结算及重复flush不重复通过；隐藏阅读20.7秒未新增；release前台实际阅读/正常进程重启后持久投影和统计UI通过；独立计时校准/故障恢复待验，见第三十一/三十五流程 |
| STAT05 | book.sessionRecorded 正式事件 | F3 | 本机真实Worker收到2条事件，日/时段/ms正确；release实际阅读跨正常进程重启保留12条正式事件，见第三十五流程；跨设备待验 |
| UI01 | 书架/Agent/统计/设置与集合页面导航 | F6 | 本机真实Worker导航书架/集合/Agent/统计/阅读设置/预填搜索、Agent双scope导航回执通过；集合DOM核实，其他前台画面待验，见第二十三流程 |
| UI02 | 命令面板搜索/书架布局/排序/分组/多选 | F6 | 本机集合两书多选在列表/标题排序/作者分组后保持，DOM/原生持久值一致；搜索结果/多选续页等待验，见第二十三流程 |
| UI03 | 发现/执行宿主命令与可用条件 | F6 | 本机真实Worker按权限发现commands/checked/不可用原因，执行及缺失目标/旧revision/无阅读控制拒绝通过；完整命令集待验，见第二十三流程 |
| UI04 | 快捷键查询、重绑、冲突与重置 | F6 | 编译Workspace Profiles表单冲突拒绝、mod+alt+p绑定/实际WebView派发、默认恢复通过；其他快捷键/输入上下文待验，见第二十七流程 |
| UI05 | 菜单可见/溢出位置及自定义重排 | F6 | 真实Worker配置四表visible/overflow，书架/阅读器/选区菜单顺序与移动一致；溢出视图/外观入口可用；第47流程原生拖动收到dragstart但无目标drop且结束坐标偏离，编辑器仍未验过；无效候选修改已撤回；退役恢复/窄窗待验，见第二十九/四十七流程 |
| CFG01 | 设置 discover/read/update 与动态选项 | F6 | 本机Agent/Worker设置查询/原子修改/动态主题、编译Workspace Profiles v2十项预设保存/应用/确认删除、宿主批准与过期保护/真分页通过；字体实际翻页/搜索/应用、预设跨Worker重启/v1七项与v2十项应用/本书覆盖保留通过；完整目录及应用进程重启待验，见第二十六/二十八/三十流程 |
| CFG02 | 全局/本书/全书阅读设置覆盖 | F6 | 本机真实Worker全局/两书覆盖/全书修改及原生重读通过；FB2外观作用域切换及正文21px↔17px通过；其他呈现与进程重启待验，见第二十五流程 |
| CFG03 | 清除覆盖/恢复默认/查询值来源 | F6 | Worker三目标defaults、单书/全书inherit、值来源及非法global inherit拒绝；Agent当前书重置/继承通过，实际外观UI无独立重置按钮；双scope另一端及进程重启待验，见第二十五流程 |
| CFG04 | 阅读对齐 reading.textAlign | F6 | Worker三目标与实际设置UI Justified、预览computed justify、原生重读通过；FB2实际正文justify↔start通过；其他格式待验，见第二十五流程 |
| CFG05 | 固定版式颜色 reading.fixedLayoutColor | F6 | Worker theme/original三目标与重置、原生读写通过；PDF实际颜色与UI入口待验，见第二十五流程 |
| CFG06 | 更新内容弹窗 general.whatsNewDialog | F6 | 真实UI/Worker/Agent开关及启动合成版本变更：关闭消费提示、重开不补弹、新提示加载日志/关闭及原生重启不重弹通过；实际升级/packaged待验，见第四十四流程 |
| CFG07 | AI 提供商/端点/密钥配置 | F6 | 待验 |
| CFG08 | 模型目录刷新、连接测试与模型能力 | F6 | 本机原生刷新目录、视觉能力发现与Qwen实际调用通过；GPT模型被账户上游规则阻止；连接测试UI待验 |
| CFG09 | 插件非敏感设置的动态路径 | F6 | 待验 |
| CFG10 | 设置变化事件/外部写入刷新 | F6 | 本机真实 Worker 观察本地设置/目录变化、remote与restore来源注入、停止订阅通过；跨设备待验 |
| CFG11 | 聊天/笔记内容字体：跟随阅读或独立字号/字体/行距 | F6 | Workspace Profiles独立Menlo/跟随Lora应用、真实聊天输入框样式与应用字体加载通过；消息正文/笔记及独立字号/行距待验，见第二十八流程 |
| CFG12 | 新标注默认颜色 | F6 | 真实Worker设blue→阅读器新高亮blue，Agent改pink→新下划线pink，旧标注保持；原生记录及实际SVG填充/描边、关书重开通过；前台像素/packaged待验，见第四十五流程 |
| CFG13 | 软件更新通道 stable/beta | F6 | 实际UI stable→beta、Worker/Agent修改及原生进程重启保留通过；更新包选择/安装/签名待验，见第四十四流程 |
| SET01 | general.startView | F6 | 修复设置无启动消费者；真实macOS debug进程重启自动恢复最后FB2第二章/同CFI，手动关书不重开，shelf重载保持书架；虚拟书/外部冷启动/缺源/packaged及其他平台待验，见第四十三流程 |
| SET02 | general.language | F6 | 实际UI en→zh-Hans、Worker→ja、Agent→zh-Hans，页面/html语言同步且原生重启保持；其他语言/OS检测及完整翻译待验，见第四十四流程 |
| SET03 | general.crashPrompt | F6 | 真实启动消费合成崩溃标记，关闭不提示、开启新标记显示询问，动作进入诊断、重启不重弹通过；没有发送报告，实际崩溃全程待验，见第四十四流程 |
| SET04 | general.launchAtStartup | F6 | 待验 |
| SET05 | general.fileAssociations | F6 | 待验 |
| SET06 | general.autoUpdate | F6 | 待验 |
| SET07 | appearance.theme | F6 | 实际UI Dark、Worker Light、Agent Dark的根主题/正文背景computed一致，原生重启保持并恢复System；OS自动切换/插件皮肤及packaged待验，见第四十四流程 |
| SET08 | appearance.motion | F6 | 实际UI reduced使设置面板animation-name=none，Worker system移除强制标记，Agent修改/原生重启保持通过；其他动效/OS变化待验，见第四十四流程 |
| SET09 | reading.theme | F6 | 实际设置UI Warm→Dark及原生KV通过；后台预览内联暗色、computed颜色过渡未完成，实际正文颜色待验，见第二十五流程 |
| SET10 | reading.fontFamily | F6 | 实际设置UI及插件字体目录应用通过；Foliate FB2实际Lora样式/400与700 loaded通过，其他字体/格式待验，见第二十八流程 |
| SET11 | reading.fontSize | F6 | 实际设置UI Medium→Small、预览15px及原生KV通过；Worker三目标覆盖/重置、FB2正文21px↔17px通过；其他格式待验，见第二十五流程 |
| SET12 | reading.fontWeight | F6 | 实际设置UI Regular→Bold、预览600及原生KV通过；实际正文待验，见第二十五流程 |
| SET13 | reading.lineSpacing | F6 | 实际设置UI Comfortable→Compact、预览1.55行高及原生KV通过；实际正文待验，见第二十五流程 |
| SET14 | reading.paragraphSpacing | F6 | 实际设置UI Normal→Tight、预览段距0.6rem及原生KV通过；实际正文待验，见第二十五流程 |
| SET15 | reading.pageMargins | F6 | 实际设置UI Wide→Narrow及原生KV通过；实际正文页边距待验，见第二十五流程 |
| SET16 | reading.readingMode | F6 | 实际设置UI Two Pages→Scroll及原生KV通过；实际正文模式切换待验，见第二十五流程 |
| SET17 | reading.fixedLayoutReadingMode | F6 | 待验 |
| SET18 | ai.preferences.features.explainSelection | F6 | 实际Agent工具关闭/恢复开关，当前选区Explain selection入口随之消失/恢复；本项不宣称模型效果通过，见第二十九流程 |
| SET19 | ai.preferences.features.defineTerm | F6 | 实际Agent工具关闭/恢复开关，当前选区Define term入口随之消失/恢复；本项不宣称模型效果通过，见第二十九流程 |
| SET20 | ai.preferences.features.translate | F6 | 实际Agent工具关闭/恢复开关，当前选区Translate入口随之消失/恢复；本项不宣称模型效果通过，见第二十九流程 |
| SET21 | ai.preferences.features.summarizeChapter | F6 | 实际Agent工具关闭/恢复开关，当前选区Summarize chapter入口随之消失/恢复；本项不宣称模型效果通过，见第二十九流程 |
| SET22 | ai.preferences.features.askConversation | F6 | 实际Agent工具关闭/恢复开关，当前选区Ask AI入口随之消失/恢复；本项不宣称模型效果通过，见第二十九流程 |
| SET23 | ai.preferences.buildMemory | F6 | 本机真实Tauri关闭后聊天正常、无提炼/摘要和候选写入，remember拒绝；编译Reading Goals开启后目标记忆/摘要落盘；活动提炼关闭再开启取消且不复活，新轮恢复通过；空闲维护/进程中断/UI历史/真实模型质量待验，见第四十八流程 |
| SET24 | ai.preferences.sendHighlightedText | F6 | 真实Tauri Agent请求四种偏好组合按选区权限过滤标记，本地历史保留而Agent历史/会话读取去除；等待请求收紧后ai/context-changed并取消，见第四十六流程；受控响应不计模型质量 |
| SET25 | ai.preferences.sendSurroundingContext | F6 | 真实Tauri Agent关闭上下文后不发送viewport，仍可发送被允许的显式选区；两项全关均去除，Worker/Agent设置通过；受控端点/其他平台边界见第四十六流程 |
| SET26 | ai.preferences.localOnly | F6 | 真实Worker普通/流式/结构化、Agent ask/turn/connection六入口开启localOnly均ai/local-only且无新增推理请求；活动插件流取消/deltas空通过；受控端点非模型质量，见第四十六流程 |
| SET27 | ai.preferences.followStreaming | F6 | 发现真实聊天跟随落后一批文本，已观察实际内容高度补齐；本机8/16段底部gap0、原生上滚暂停/回底恢复、关闭固定起点、新段不抢滚、结束关书重开40段保留通过；回归/类型通过，发布包及其他内容/平台待验，见第四十九流程 |
| SET28 | ai.connection.configured | F6 | 待验 |
| SET29 | ai.connection.credentialConfigured | F6 | 待验 |
| SET30 | menus.primaryNav.visible | F6 | Worker主导航重排为Agent→统计→书架，实际DOM一致；编辑器/窄窗待验，见第二十九流程 |
| SET31 | menus.primaryNav.overflow | F6 | Worker反向排序及原生KV通过；隐藏目的地实际发现待验，见第二十九流程 |
| SET32 | menus.shelfHeader.visible | F6 | Worker页头Settings→Workspace Profiles→Search，实际DOM一致；编辑器待验，见第二十九流程 |
| SET33 | menus.shelfHeader.overflow | F6 | Worker溢出排序DOM一致，移入Shelf view仍可打开布局面板；其他动作待验，见第二十九流程 |
| SET34 | menus.readerHeader.visible | F6 | Worker阅读页头Chat→Jumper，实际DOM一致；固定左侧入口保持，见第二十九流程 |
| SET35 | menus.readerHeader.overflow | F6 | Worker外观/分句阅读移入溢出并重排，外观入口实际可打开；其他动作待验，见第二十九流程 |
| SET36 | menus.selection.visible | F6 | 真实FB2 DOM Range触发选区，Underline→Copy及More顺序一致；release物理拖选默认工具栏/高亮笔记通过；自定义物理拖选/窄窗待验，见第二十九/三十二流程 |
| SET37 | menus.selection.overflow | F6 | 真实选区溢出前七项按Worker配置排序；完整动作执行待验，见第二十九流程 |
| SET38 | ai.connection.provider | F6 | 待验 |
| SET39 | ai.connection.primaryModel | F6 | 待验 |
| SET40 | ai.connection.fastModel | F6 | 待验 |
| SET41 | ai.connection.thinkingLevel | F6 | 待验 |
| SET42 | ai.connection.fastThinkingLevel | F6 | 待验 |
| SET43 | ai.connection.custom.endpointConfigured | F6 | 待验 |
| SET44 | ai.connection.custom.api | F6 | 待验 |
| SET45 | ai.connection.custom.supportsThinking | F6 | 待验 |
| SET46 | ai.connection.custom.maxOutputTokens | F6 | 待验 |
| SET47 | reading.textAlign | F6 | Worker目标覆盖与实际设置UI Justified、预览及FB2正文computed justify、原生KV通过；其他格式待验，见第二十五流程 |
| SET48 | reading.fixedLayoutColor | F6 | Worker theme/original目标覆盖及重置通过；PDF实际颜色与UI入口待验，见第二十五流程 |
| SET49 | general.whatsNewDialog | F6 | 实际开关/Worker/Agent修改、合成版本变更的显示/静默消费/关闭及原生重启通过；实际升级/packaged待验，见第四十四流程 |
| SET50 | appearance.contentTypography.followReader | F6 | Workspace Profiles false→true切换及输入框字体通过；release实际UI关闭跟随、笔记列表独立字体及进程重启通过，消息/跟随笔记绘制待验，见第二十八/三十二流程 |
| SET51 | appearance.contentTypography.fontFamily | F6 | Workspace Profiles Menlo输入框样式通过；release设置Lora下载/预览/笔记列表实际字体及重启通过；消息和其他字形待验，见第二十八/三十二流程 |
| SET52 | appearance.contentTypography.fontSize | F6 | release实际UI medium→XL、预览/笔记列表呈现、原生持久与重启保留并恢复通过；其他字号/消息待验，见第三十二流程 |
| SET53 | appearance.contentTypography.lineSpacing | F6 | release实际UI comfortable→relaxed、预览/笔记列表呈现、原生持久与重启保留并恢复通过；其他行距/消息待验，见第三十二流程 |
| SET54 | annotations.defaultColor | F6 | 真实Worker/Agent修改默认色，新高亮blue/新下划线pink，旧色保持及关书重开记录/SVG一致通过；原生进程重启/packaged待验，见第四十五流程 |
| SET55 | general.updateChannel | F6 | 实际UI beta选择、Worker stable、Agent恢复及原生重启保留通过；更新安装链路待验，见第四十四流程 |
| SET56 | shelf.layout | F6 | 本机真实Worker grid→list，命令checked/列表DOM/原生KV一致并恢复；其他入口待验，见第二十三流程 |
| SET57 | shelf.group | F6 | 本机真实Worker none→author，作者分组DOM/原生KV一致并恢复；其他分组/入口待验，见第二十三流程 |
| SET58 | shelf.sort | F6 | 本机真实Worker recent→title，列表顺序/原生KV一致并恢复；其他排序/入口待验，见第二十三流程 |
| SET59 | shortcuts.search | F6 | 插件冲突写未改变mod+k，实际按键打开搜索通过；release自身UI冲突拒绝/重绑及物理按键打开搜索通过；已实际Reset/原生bindings清空/默认Command+K恢复；其余输入上下文待验，见第二十七/三十三流程 |
| SET60 | shortcuts.settings | F6 | release原生Command+comma打开设置通过；重绑/其他上下文待验，见第三十三流程 |
| SET61 | shortcuts.new-conversation | F6 | release原生Command+N打开Agent空白输入并聚焦，未发送模型请求；既有会话/重绑待验，见第三十三流程 |
| SET62 | shortcuts.next-page | F6 | release物理按键Right从第一章到第二章通过；聊天输入框内对应编辑键不导航通过；其他格式/重绑待验，见第三十三流程 |
| SET63 | shortcuts.prev-page | F6 | release物理按键Left从第二章到第一章通过；聊天输入框内对应编辑键不导航通过；其他格式/重绑待验，见第三十三流程 |
| SET64 | shortcuts.next-chapter | F6 | release物理按键]从第一章到第二章通过；聊天输入框内对应编辑键不导航通过；其他格式/重绑待验，见第三十三流程 |
| SET65 | shortcuts.prev-chapter | F6 | release物理按键[从第二章到第一章通过；聊天输入框内对应编辑键不导航通过；其他格式/重绑待验，见第三十三流程 |
| SET66 | shortcuts.toggle-controls | F6 | release物理按键space显示阅读工具栏通过；聊天输入框内对应编辑键不导航通过；其他格式/重绑待验，见第三十三流程 |
| SET67 | shortcuts.reader-mode-next-unit | F6 | release真实Sentence Reader物理Down推进句/段，计数及实际强调一致；其他格式/重绑待验，见第三十四流程 |
| SET68 | shortcuts.reader-mode-prev-unit | F6 | release真实Sentence Reader物理Up回前句，计数/强调正确；其他格式/重绑待验，见第三十四流程 |
| SET69 | shortcuts.selection-copy | F6 | 待验 |
| SET70 | shortcuts.selection-highlight | F6 | release物理拖选后按h创建黄色高亮，实际绘制/原生重读通过；重绑/其他格式待验，见第三十六流程 |
| SET71 | shortcuts.selection-underline | F6 | release物理拖选后按u创建黄色下划线，实际绘制/原生重读通过；重绑/其他格式待验，见第三十六流程 |
| SET72 | shortcuts.selection-add-note | F6 | release物理选区按n打开正确引用的笔记编辑器并聚焦，Cancel不留记录通过；快捷键路径保存/重绑待验，见第三十六流程 |
| SET73 | shortcuts.selection-look-up | F6 | release物理选词按l打开真实Dictionary及缺AI配置提示，Escape关闭通过；词义内容环境阻塞，重绑待验，见第三十六流程 |
| SET74 | shortcuts.selection-ask-ai | F6 | release物理选词按a打开Chat并带入精确引用/输入焦点，移除引用及关闭通过；未发送模型请求，重绑待验，见第三十六流程 |
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
| MEM01 | 查询长期记忆 | F5 | 本机真 Worker 目标候选落盘及 Agent 原生端口 106 条分页无重复通过；前台视觉待环境恢复 |
| MEM02 | 显式记住事实/偏好 | F5 | 第48流程真实Agent remember在buildMemory关闭时ai/memory-disabled通过；显式新建/重新记住待验；共享原生创建端的自动同文去重另记 MEM03 |
| MEM03 | 轮后抽取/去重/强化记忆 | F5 | 本机插件候选管线落盘/同文去重/遗忘同文抑制通过；模型抽取/强化待验 |
| MEM04 | 记忆巩固、修订/替代/遗忘 | F5 | 本机条件遗忘/同文抑制、并发旧巩固拒绝及新版本替代通过；模型巩固质量待验 |
| MEM05 | 用户反馈记忆质量/纠错 | F5 | 本机 Memory Desk 纠错/置顶/确认遗忘与 SQLite 重读通过；前台视觉/其他 scope 待验 |
| MEM06 | 读取用户画像并注入上下文 | F5 | 部分通过：真实 Worker 读取 curated/derived，来源纠正后 stale 推导从新归档排除；模型实际注入/访谈界面待验，见第十六流程 |
| MEM07 | Onboarding 访谈写入画像 | F5 | 部分通过：原生命令原子写画像及两记忆，完全重放幂等、改内容冲突；访谈/审批 UI 待验，见第十六流程 |
| MEM08 | profile.updated / entity.resolved / entity.merged 投影 | F5 | 部分通过：画像清空/恢复/CAS、身份合并及别名、重载保持且28事件投影一致；大批恢复/跨设备待验，见第十六流程 |
| MEM09 | 叙事性分类/重分类与图谱风格 | F5 | 本机重分类过滤旧摘要、改回恢复通过；模型分类质量待验 |
| MEM10 | 完成章节摘要、人物/概念图生成与补齐 | F5 | 待验 |
| MEM11 | 检索书内人物/关系/概念图 | F5 | 本机源版本绑定图谱、进度边界和越权拒绝通过；真实书摘要语义待验 |
| MEM12 | 跨对话 insights 与滚动摘要 | F5 | 待验 |
| MEM13 | 可版本化导出 context bundle | F5 | 部分通过：真实 Worker 画像归档/幂等/历史/574字节JSON导出、来源变更撤销资源、旧归档不变、重载三版保留；其他recipe及跨设备待验，见第十六流程 |
| EXT01 | 选择菜单动作/lookup/标注入口 | F7 | 待验 |
| EXT02 | 书架与阅读 header menu 入口 | F7 | 待验 |
| EXT03 | 插件页面/对话框/视图结果与栈导航 | F7 | 本机真实Worker实时发布/压栈返回/模态挂起/退役通过；此批视觉待验 |
| EXT04 | 列表、搜索、详情、Markdown、blocks 组合 | F7 | 待验 |
| EXT05 | 表单输入、动态选项、验证与提交 | F7 | 本机表单验证/提交及实时更新保留草稿通过；完整动态选项组合待验 |
| EXT06 | 大列表分页/虚拟化、Tree/Table/编辑器/图像资源 | F7 | 待验 |
| EXT07 | Toast、持久错误、进度/取消/确认交互 | F7 | 待验 |
| EXT08 | 应用/阅读主题和字体贡献 | F7 | 待验 |
| EXT09 | 词典查询/收藏/复习列表/CSV 导出 | F7 | 待验 |
| EXT10 | RSS 订阅/刷新/退订/OPML/阅读文章 | F7 | 本机 RSS 真实插件消费者订阅/更新/离线/退订通过；其他组合待验 |
| EXT11 | 本地 marketplace 插件清单与启用状态 | F7 | 待验 |
| EXT12 | 安装/授权/启停/更新/回滚/卸载插件 | F7 | 待验 |
| SYS01 | 插件隔离 KV 同步读与异步持久写 | F8 | 本机真实安装Worker同步镜像/持久读一致、升级回滚及卸载保留KV通过；跨进程/设备边界独立待验，见第二十流程 |
| SYS02 | 插件私有文档 CRUD/搜索/分页/条件事务 | F8 | 本机真实Worker Unicode字面搜索/不重复分页/写后旧游标失效/CAS整批拒绝无泄漏/更新删除/订阅通过，卸载文档归零；其他额度待验，见第十九/二十流程 |
| SYS03 | 插件 schema 迁移/快照/更新回滚 | F8 | 本机实际安装更新入口：失败迁移回滚代码/KV/文档/schema并重启旧Worker，成功升级2再降级1通过；物理崩溃/恢复失败待验，见第二十流程 |
| SYS04 | 插件自有 secret get/set/remove | F8 | 本机真实Worker合成私有secret写读/删除后null通过，未使用真实凭据；跨实例隔离待验，见第二十流程 |
| SYS05 | 插件数据导入导出/配额/同步策略 | F8 | 部分通过：真实Worker返回native usage/各store策略、卸载保留KV删除文档；完整导入导出/额度边界/远端同步待验，见第二十流程 |
| SYS06 | 原生网络 HTTP 请求与响应 | F8 | 部分通过：真实Worker经原生HTTP收到loopback两次503后200，三次GET服务端核实；公网/TLS等待验，见第十八流程 |
| SYS07 | 网络域名授权、预算、下载流和离线重试 | F8 | 部分通过：safe retry参数派发后改原对象不影响三次GET重试；下载流/其他预算/离线待验，见第十八流程 |
| SYS08 | 剪贴板写文本 | F8 | release选区复制按钮及debug真实Agent工具复制Unicode文本，经系统粘贴逐字核实通过；预先取消复制不覆盖原内容；插件写入/其他平台待验，见第四十七流程 |
| SYS09 | 图片复制/导出原生图片资源 | F8 | 本机真Worker封面PNG原生保存通过；剪贴板/其他来源待验 |
| SYS10 | 保存文本/二进制文件与取消回执 | F8 | 本机Agent工具实际原生保存46字节UTF-8逐字节一致；Cancel返回saved:false，面板打开后取消请求再Save返回AbortError且无文件；第9流程Worker原书/PNG二进制保存证据保留；磁盘故障/多窗口/其他平台待验，见第九/四十七流程 |
| SYS11 | 用户选文件/目录、拖放和流式文件句柄 | F8 | 本机选择/取消、子目录文件与链接略过通过；拖放/分页/其他actor待验 |
| SYS12 | 打开外部 URL/系统关联打开/深链接路由 | F8 | 待验 |
| SYS13 | Blob 范围读取/流式读写/提交/中止 | F8 | 待验 |
| SYS14 | 系统字体枚举和字体资产加载 | F8 | 待验 |
| SYS15 | 原生日志/诊断包/崩溃报告导出与发送 | F8 | 待验 |
| SYS16 | 检查/下载/安装更新与重启 | F8 | 待验 |
| SYS17 | 窗口最小化/最大化/全屏/关闭/标题栏 | F8 | 编译Workspace Profiles最大化/最小化/还原：原生flag与Worker实时显示通过；补destroy权限后debug正常关闭/重启、release包原生关闭按钮/退出通过；release原生菜单全屏/还原与沉浸标题栏显隐通过；插件全屏请求及其他标题栏动作待验，见第二十七/三十一流程 |
| SYS18 | Android/iOS 遗留桥：状态栏/安全区/音量键/商店 | F8 | 待验 |
| OPS01 | 同步连接/断开/立即同步/状态与积压 | F8 | 待验 |
| OPS02 | 事件/Blob E2E 加解密、游标、去重/确认与重试 | F8 | 待验 |
| OPS03 | 检查点/投影恢复/事件历史回填 | F8 | 待验 |
| OPS04 | WebDAV 等自定义密文 transport | F8 | 待验 |
| OPS05 | 偏好漫游/远端合并后的 UI 失效 | F8 | 部分通过：隔离合成凭据本地加密事件/远端来源不回传/删除；跨设备与UI失效待验，changed计数0，见第十九流程 |
| OPS06 | 账号登录、连接 token、退出、删除账号 | F8 | 待验 |
| OPS07 | 套餐/用量/购买/账单管理 | F8 | 待验 |
| OPS08 | 备份导出与合并导入 | F8 | 本机加密导出/错密码拒绝/预检及UI恢复书目、重载写屏障通过；旧库缺源拒绝；当前文件替换/迁移等边界待验 |
| OPS09 | 删除本地全部数据 | F8 | 待验 |
| OPS10 | 数据目录显示/Reveal | F8 | 待验 |
| OPS11 | 事件写入、重建/验证投影、历史 genesis | F8 | 待验 |
| CON01 | 能力发现/版本/权限/依赖与安装同意 | F7 | 待验 |
| CON02 | 对象级授权/用户批准/来源与审计 | F7 | 待验 |
| CON03 | 生命周期 staging/activate/deactivate 与资源释放 | F7 | 部分通过：真实Worker20次临时回调注册/重复释放/旧调用拒绝，cleanup owner不累积，退役贡献0；实际取消搜索误报关闭失败已修，复验shutdownErrors空/贡献0，源清理真错误仍保留；完整安装升级/packaged待验，见第十九/三十八流程 |
| CON04 | 跨 Worker RPC 的类型、错误与资源额度 | F7 | 部分通过：真实Worker四万消息洪泛被宿主终止、稳定plugin/unavailable，同伴ping成功，贡献收回；其他额度待验，见第十八流程 |
| CON05 | 稳定错误码/安全文案/可重试与降级状态 | F7 | 待验 |
| CON06 | 长任务进度、取消、超时、并发与幂等 | F7 | 待验 |
| CON07 | 领域事件的本地/远端/外部变化一致性 | F7 | 待验 |
| CON08 | 事务/CAS/撤销/跨对象一致回执 | F7 | 待验 |
| CON09 | 沙箱、权限撤销和 packaged CSP 验证 | F7 | 待验 |
| CON10 | 宿主-工具-插件覆盖门禁/契约测试 | F7 | 本机分阶段门禁、Web构建通过；packaged/CI跨平台另验 |
| CON11 | 任意 SQL/FS/shell/DOM、密钥、伪造历史 | F7 | 待验 |
| CON12 | 新格式/OCR/实时协作/向量/任意编辑与新平台 | F7 | 待验 |
| MORE01 | 周期调度/启动补跑/失败记录 | F7 | 部分通过：真实Worker延迟任务同ID幂等、idle实际执行、成功状态/lastRun在Worker重启后保留；周期/失败/进程恢复待验，见第十八流程 |
| MORE02 | 一次性延迟/短周期/空闲任务与自触发防环 | F7 | 待验 |
| MORE03 | 环境 locale/platform/timezone/在线/ready 快照 | F7 | 部分通过：真实Worker与Agent原生端口一致返回desktop/macos/en/Asia-Singapore/480/online，初始订阅可读；环境变化待验，见第十七流程 |
| MORE04 | 书籍/集合上下文菜单与 Agent header 插槽 | F7 | 待验 |
| MORE05 | 贡献的动态 visible/enabled/checked 与自有视图刷新 | F7 | 待验 |
| MORE06 | 发现/复用类型化提供者与跨插件权限交集 | F7 | 待验 |
| MORE07 | 插件自有二进制资产与资源配额 | F7 | 本机 Library Desk 保存/Worker重启读/删除私有封面及备份捕获通过；配额/冲突/卸载待验 |
| MORE08 | 声明 UI 本地化、辅助技术、窄窗和输入焦点 | F7 | 待验 |

## 本轮证据

[第一批：真实 Text Desk 流程、门禁修复及模型复核](./evidence/2026-09-13-full-validation/README.md)。已有子流程通过仍保留本行剩余边界。
