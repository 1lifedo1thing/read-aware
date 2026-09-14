# 宿主延迟任务

Schedules 2.0 继续承载周期任务，并增加声明 `mode: deferred` 的具名一次性任务。插件先 bind 已声明 ID，激活后从实际命令/事件调用 defer；不接受任意脚本、跨插件任务或在 activate/migrate 阶段创建后台副作用。RSS 0.13 协调升级到新契约，周期声明和回调保持原行为。

## 调度与状态

- defer 接受 requestId、1000..604800000 毫秒 delayMs、when=any/idle。ID 为1..64位ASCII字母/数字/_/-。输入同步复制，持久排队后才回 queued。
- 每声明仅保留最新请求。相同ID/相同参数返回 retained 和原 dueAt，不顺延；同ID改参数报 ui/superseded，另一个ID仍排队时报 plugin/busy。已结束请求可用新ID重新排队；旧ID被后续请求替换后不再有幂等保证，不盲重试过期回执。
- cancelDeferred 只取消精确匹配的 queued ID；运行中、旧ID或已经结束返回 not-queued，不取消替换请求，不回滚副作用。pause/resume持久化；经批准的手动run越过暂停/截止/idle一次，消费当时排队的请求。
- 宿主每秒检查，idle明确指主窗口5秒无 pointerdown/keydown/wheel/touchstart/focus 输入，不代表CPU空闲、用户离席或系统后台执行。系统休眠/关App时不运行，重启同版本并重新bind后检查到期请求，不补跑错过的多轮。
- 开始记录和 queued→running 在同一次KV持久写里完成后才派发回调。回调接 trigger/requestId/startedAt，业务需要幂等时自行使用requestId。完成记录保存后才报 succeeded；失败不推进成功时间。开始记录后进程退出可能尚未调用业务，也可能已产生副作用，重启显示interrupted，绝不自动重放。
- 回调可以用新ID安排下一轮，实现短周期；新请求不会被前一轮完成记录覆盖。同一声明跨换代不并行。插件版本变化或声明不再deferred时，旧排队请求显示cancelled/ui-superseded，不送给新代码；新版本需明确新ID重新安排。

## 所有权与限额

任务隐含owner为已验证manifest的plugin ID，无调用者指定origin字段。状态保留在原宿主调度KV，与周期记录共用写队列、查询、串行观察、插件卸载和漫游排除。schedule-state/schedule-runs禁止通过插件普通KV set/remove伪造，但允许查询自己的状态。每插件最多64声明/绑定，全App最多1024保留绑定；同插件最多2个、全App最多8个执行中的回调，实际settle之前不释放。自动扫描轮转，短任务不能永远挤掉后面的插件。无权限新增，也不开放原生路径或存储键。

取消在持久写派发前拒绝；写已开始则回真实结果并参与插件退休排空。退休移除绑定和新触发，已派发效果不假装回滚。最后绑定退出释放周期计时器和输入监听。Worker使用统一版本化RPC、参数取消槽和持久写排空语义。

卸载先退休并排空，再持久清空宿主调度状态；失败时卸载拒绝，不能假称旧任务已删除。普通设置仍按既有策略保留，但同版本重新安装不会复活旧排队任务，也不会回落读取旧周期尝试时间。

## 原生验证

隔离 macOS debug Tauri 中，真实模块 Worker 排队并重复相同 ID 得 queued/retained 和同一 dueAt。到期执行前退出进程，重启同版本重新绑定后，idle 扫描执行原 requestId，实际 SQLite 私有 KV 中的业务回执与 succeeded 对应；再次绑定未重复执行。RSS 内置编译清单已升级到0.13与 schedules2.0。不是自主模型、packaged或跨平台验收。

本组不是完整任务历史或跨插件事件因果防环；回调仍须避免互相触发无穷业务写。每秒下限和并发额度不等于防环证明。此项继续按MORE02的剩余要求补齐，不能以已有延迟入口替代完整能力验收。
