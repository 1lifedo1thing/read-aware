# Luna / max 并行回归试跑

本阶段完成测试执行与失败收口，结果未全通过。没有创建 goal，没有修产品源码、启动新桌面验收、调用真实模型或推送。

基线：`6fb8bccc80eaf275cb17934ea399b65c779c87fa`。调度 11 个 GPT-5.6 Luna / max 子代理，主代理按用户要求保持 medium。10 个分组由子代理完成；`web_features_other` 子代理未产出日志且未回应进度询问，停止并确认无遗留测试进程后，由主代理接管。

## 冻结范围与完成条件

[manifest.json](./manifest.json) 固定 597 个现有 JS/TS 测试文件，无重复分配、无发现清单遗漏。10 个非空 JS 分组加 1 个 Rust 分组；空的 web_reading 桶不执行。验收条件是全部分组执行一次、保留首轮失败及退出码、复核失败原因、说明未验证边界后结束。失败不触发自动修复或下一 goal。

## 首轮结果

| 分组 | 文件 | pass | fail | skip |
| --- | ---: | ---: | ---: | ---: |
| agent_other | 41 | 243 | 0 | 0 |
| agent_runtime | 29 | 158 | 2 | 0 |
| agent_tools | 55 | 214 | 2 | 0 |
| web_plugins | 80 | 502 | 0 | 0 |
| web_ai | 19 | 73 | 0 | 0 |
| web_features_other | 93 | 427 | 1 | 0 |
| web_domain | 52 | 247 | 0 | 0 |
| web_platform_services | 121 | 499 | 5 | 0 |
| core_plugins_scripts | 95 | 469 | 16 | 0 |
| relay_landing | 12 | 139 | 0 | 1 |
| JS/TS 合计 | 597 | 2971 | 26 | 1 |

Rust `CARGO_NET_OFFLINE=true cargo test --lib`：470 pass、3 fail、2 ignored，Cargo 原始退出码 101（采集包装器因变量名错误返回 1，未混淆原始结果）。JS 计数使用每组外层 Bun 汇总，嵌套 proof 和定向复跑不重复计数。Relay stress 因 `RELAY_STRESS` 未设置而跳过；Rust ignored 未启用。

全仓 `bun run typecheck`：28/28 tasks 成功，1 个缓存命中，32.942 秒。
`check:capabilities` 在生成矩阵前失败，后续步骤未运行：`storage::library_begin_import` 未映射。
额外的 `check:marketplace` 读取默认远程市场源，发现插件要求 `services.storage ^1.0.0` 而宿主提供 `2.5.0`。此项是补充的远程读取证据，不属于确定性本地测试；在首个错误处停止，未证明全部市场条目状态。

## 失败及下一步

| 证据 | 判断与最小后续 |
| --- | --- |
| agent_runtime 2 fail | thread.test.ts:487、562 仍期待旧 `chapter #1` 文案，实现已明确 `zero-based chapterIndex`。校准断言。 |
| agent_tools 2 fail | tool-surface fixture 传入 `contentVersion=fixture`，reader 要求 `fixture:<sha256>`，抛 reader/stale-location。修 fixture 的真实版本绑定。 |
| Text Desk 3 fail | image-controls 期待版本 0.18.0，实际 0.22.0；两个 views fixture 缺 ctx.services.llm。补齐契约 fixture 后定向验证。 |
| scripts 13 fail / capability gate | host-capability-inventory.ts 的 nativeMap 漏 library_begin_import、library_finish_import；命令已注册实现并有前端调用，并非能力入口缺失。按 LIB06 补库存映射。 |
| plugin-contributions 1 fail | 实际贡献点包括 uriHandlers，旧期望目录遗漏。对齐目录断言。 |
| backup-domain / backup-migrations 各 1 fail | 独立复核仍出现 backup/busy reservation 冲突及嵌套 proof 超时。根因未定，需要沿写入门禁和测试清理定位；不能排除产品回归。 |
| toast / image-controls 各 1 fail | 分组执行失败、单文件各复核一次通过，分别观察到俄语文案与缺失 Zoom in 控件。存在顺序/共享状态干扰证据，不能把首轮改为通过。 |
| shortcut editor 1 fail | 隔离 proof 的 IPC stub 对启动状态读取返回 undefined；设置更新抛 settings/unavailable，未进入持久写断言。需核对 fixture 与设置更新对启动状态的依赖。 |
| Linux MIME 1 fail | 当前扩展名 16 个，测试仍硬编码 14。移除过时数量断言。 |
| Windows uninstall 1 fail | windows/file-associations.nsh 的清理宏漏 text、xhtml。这是实际脚本遗漏，需补齐并验证卸载清理。 |
| source clock wipe 1 fail | 清空后 post-commit app_kv 删除触发器重新创建 source-clock 行，期望 0 实际 1。需明确清空后的代际契约并验证，不能仅改数量断言。 |

优先处理 Windows 卸载遗漏、备份门禁和 wipe 时钟行为，再处理 fixture/目录断言及能力清单。修复范围留待下一阶段，本次未修改实现。

## 并行模式评价

第一条测试开始于 08:25:02Z，最后首轮测试结束于 08:32:11Z，执行窗口约 7 分 9 秒，另有此前准备和之后汇总时间。没有相同条件的串行基线，因此不声称加速倍数。

本轮证明分组执行、集中复核和主代理接管能形成完整结果；也暴露三个成本：多数测试本身仅几秒，代理准备/诊断远长于执行；一个子代理未推进，需要接管；各代理 JSON 字段不一致，增加汇总工作。实际没有 50 个同时运行的实测证据，不据此扩到 50。

下一次沿用 Luna / max 偏好，但任务单应预先给定命令、统一结果字段和明确停止条件；无日志/无进度的分组及时接管；主代理只复核失败及证据边界。独立复杂诊断适合代理并行，几秒的机械测试更适合主代理批量调度进程。该阶段结论不代表真实桌面、模型质量、Windows/Linux 设备或发布包验收通过。

## 原始证据

完整日志及各代理 JSON 保留在仓库本机 `.eval/parallel-luna-trial/`（忽略目录）；[summary.json](./summary.json) 保存首轮统一汇总及日志 SHA-256，[manifest.json](./manifest.json) 保存固定分组。未将复跑混入首轮，也未将历史桌面通过项计入本次结果。
