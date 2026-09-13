# 第二轮有界全量验证

基线 `467397bd`。本轮有界 goal 已完成验证与证据收口，用户指定子代理 GPT-5.6 Luna / max，主代理 medium。**执行完成，不是全部通过；当前模型体验不满足全面验收通过条件。**

## 冻结范围与剩余交付

- [x] 修复上一轮 26 个 JS/TS 与 3 个 Rust 首轮失败，保持实际契约；能力库存生成门禁恢复。
- [x] 以 [597 文件 manifest](../2026-09-13-luna-parallel-trial/manifest.json) 执行修后全量回归，类型与生成契约检查；复验和原首轮分开。
- [x] 核对既有 88 流程与 B01–B16 证据；补验本次改动影响的真实 Tauri 路径。未受影响证据复用，外部条件缺失如实标注。
- [x] 当前 eval:all 场景冻结一遍、并发 4；主代理按 evals 流程审阅失败/error、相关场景和代表 pass。产品行为至多一轮集中修复及定向复验，不循环采样。
- [x] 清理自有资料、恢复状态、统一报告并本地提交，不推送、不自动下一 goal。

5 个首批子代理处理独立诊断/有限修复，另有 2 个模型诊断代理及 1 个最后修复代理；最后修复由主代理接管收口。主代理独占物理桌面、整合及机械测试调度。原始日志放 `.eval/full-validation-2/`，模型原文不提交。通过、失败和外部阻塞分别报告；执行完成不等于全部通过。

## 已完成的确定性回归

| 边界 | 本轮结果 | 证据 |
| --- | --- | --- |
| 固定 597 个 JS/TS 文件，4 个机械进程 | 2996 pass / 0 fail / 1 skip，21.69 秒 | 本地 `regression/runs.json`、`regression/counts.json` 与分组日志 |
| Cargo lib | 474 pass / 0 fail / 2 ignored，测试阶段 60.29 秒 | 本地 `native-full.log` |
| 工作区类型检查 | 28/28 tasks，通过；25 缓存，29.80 秒 | 本地 `typecheck.log` |
| matrix/model 生成一致性 | 两项通过，243 行、129 验收项 | `build-host-capability-matrix.ts --check` 与 `build-host-capability-model.ts --check` |

这里的耗时不含修复、构建、模型、桌面和主代理审阅，不能当作整个 goal 耗时或相对单代理的加速倍数。图片测试变为一个外层子进程包装，内部原有两条断言用例保留，因此外层总数减少一条；Relay stress 仍跳过。

已提交：`8bce2c40` 补 LIB06 导入生命周期库存映射；`168d355f` 修正过期 fixture 和挂载 UI 测试隔离；`c2cf4e28` 修复 wipe 最后清理的事务恢复、备份期间摘要写入准入、Windows 卸载遗漏及相关契约测试。没有通过删除凭据尾部检查或放宽清空屏障来消除失败。

## 本次真实桌面补验

新构建、独立 synthetic profile `com.readaware.app.validation-full2-e2e`，macOS debug Tauri：

- [正常清空](wipe-normal.json)：实际设置 UI 确认后自动重载，自有标记消失，旧 source-clock 代际失效；重启初始化的新代际不误判为旧行残留。
- [最后清理故障](wipe-finalize-failure.json)与[解除故障后恢复](wipe-recovery.json)：注入时钟退休 SQL 故障，native 返回 `data/wipe-incomplete` 且保留 pending；解除后 native 重试成功，重载前时钟行为 0。此处是重试证据，不冒称真实断电验收。
- [备份门禁](backup-runtime.json)：生产 sync/plugin/domain 包装下两次 native capture → cancel → 普通写入 → recapture 均成功；capture 中摘要写入先返回 `backup/busy`。不重复原生选择器、加密和完整恢复。
- [快捷键](shortcut-runtime.json)：原生保存自定义值、重载读取、恢复默认。未新增 OS 物理焦点派发证据。
- [清理](cleanup.json)：自有标记、快捷键与注入 trigger 已恢复，9225 会话断开，自有进程退出；原 9224、release 与 Vite 保留。隔离合成资料库保留供诊断。

既有 [88 流程](../2026-09-13-full-validation/README.md)和[有界验收](../2026-09-13-bounded-validation/final-report.md)按原边界复用，不将 88 整体归类为通过。B01 语音端点、B08 剪贴板权限、B10 隔离桌面模型配置、B12 升级工件、B13 测试账户、B14 账单资格仍阻塞；B16 原笔记标点失败仍保留。Windows 安装/卸载仍缺实际设备；本机 Rust 脚本契约检查不替代它。远程市场兼容问题未发布修复。

## 全量模型首轮

[逐项状态与主代理评语](model-first-run.json)：247 场景一次，**220 pass / 26 fail / 1 timeout**。被测产品模型为 OpenRouter `deepseek/deepseek-v4-flash-0731` / medium，与执行验收的 Luna/max 子代理分开。

主代理审阅了全部 27 个非通过记录及五本真书各一条代表 pass，32 条四维评分已写入本地 Viewer。未调用 LLM judge。机器 pass 抽查仍发现仅答当前视口、忽略已有早期人物资料，以及引用依据不完整；未审的 215 条 pass 不宣称读者体验通过。

首轮模型工件从 09:21:19Z 到 09:50:19Z，约 29 分钟。16 个套件记录的 runtime safety hash 相同；期间测试/原生提交不同，完整 provenance 保留在逐项 JSON，不能只凭最终 HEAD 声称全部在相同提交下执行。

失败包括空完成、宿主 narrative guard 误伤及修复回答丢失证据、未完成高亮却声称完成、精确选区被 fixture 围栏拒绝、版本用词与语言偏离、检索调用超预算、一次超时。三步成功高亮超两次预算与真正未写入必须分开；说明文“没有剧透顾虑”被正则判成顾虑的误判也保留原始首轮结果。原始模型文本只在 `.eval/full-validation-2/model/`，Viewer 地址为 `http://127.0.0.1:5199`。

## 唯一一轮运行时修复

本轮补丁范围冻结为：无工具活动的空完成返回标准可重试 `ai/provider`，不自动重放；避免取到前一轮 assistant 文本；将当前书实际返回的目录元数据及已过现有围栏的 graph 投影传给安全重写器；排除已证实的四个普通词人名误报。没有把未裁剪原始 digests、任意历史用户话语或被拦下的草稿加入安全证据。

原有会话恢复只保留最后一轮、复杂 recap 重写丢失上下文、有工具活动后的空答、精确选区定位和虚假成功仍是已知残留。本次四词排除不等于通用命名识别已解决。主代理拒绝手写 mutation 工具大名单，避免遗漏插件工具后错误开放重试。

相关确定性检查：runtime/guard 34 pass；TOC/graph/text-status 19 pass；Agent 包类型检查通过。全量 597 文件结果属于此前回归修复阶段；此处仅按实际影响定向检查，没有再次重复全库测试。

运行时补丁提交 `ca8f0a69`。唯一一次[定向复验](targeted-results.json)固定 10 场景，**8 pass / 2 fail / 0 error**；主代理全部复核：5 满意、2 有保留、3 不满意。人物别名和合集目录恢复作答；六轮 recap 与未授权 `confirmSpoiler` 尝试仍失败。`early-cursor-no-spoiler` 虽机器 pass，最终只有拒答，主代理判不满意。不能将此次选择性 8/10 与全量 220/247 合并为新通过率。

固定题库外增加两轮自由问题，保存在定向 journeys 同一 bundle 的 `manual-sessions.json`，评分 3/5、4/5：当前页阅读问题及紧邻两句回顾可以完成；首答带未经证实的推断，且不覆盖发生 guard 重建的长旅程。无工具空完成由确定性故障用例证明会报错；一次 live 有答案不证明随机空完成已消失。

## 收口与后续优先级

本轮停止调用模型，不做第二轮补丁、重采样或下一 goal。未通过项已完整保留在首轮与定向 JSON；外部阻塞继续沿原 B 项证据。后续若另行授权，优先处理：

1. 安全重写与会话恢复的证据连续性：`get_recent_turns` 已返回，最终仍变成当前章摘要。
2. 精确选区的安全定位与写入回执：区分 fixture 围栏缺口、旧 chapterHref 和没有写入却声称完成。
3. 模型工具纪律与回答质量：无授权剧透尝试、工具后空答、引用版本与语言偏离；调用预算断言误判另行处理，不改写本轮原始失败。

并行模式确实让独立回归修复、覆盖核对和机械运行同时推进；主代理仍负责识别不合适补丁、真实桌面与模型质评。本轮不是同任务串行/并行对照实验，不能给出质量相等或固定加速倍数，也没有证据支持堆满 50 个代理更快。
