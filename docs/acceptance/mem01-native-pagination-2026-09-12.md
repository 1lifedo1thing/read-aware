# MEM01 原生记忆分页验收

2026-09-12，macOS debug Tauri，独立 identifier `com.readaware.app.memory-page-e2e`，前端 5186、桥接 9225。生产资料库未用于夹具。

## 本次交付

Agent `search_memory`、旧 `searchMemories`、插件 `memory.queries.page/search` 与 Memory Desk 共用 `memories_page`。SQLite 在一次读事务内筛选 scope 并排序，Rust 按原有整句/词元语义匹配，流式计算完整结果身份，只收集所请求的至多 100 条记录返回 IPC；不再将完整记忆集合送进 WebView 后排序和散列。

原生身份为 `mpg2`，旧 `mpg1` 续页得到 `memory/conflict`，刷新首页恢复；令牌仍是完整匹配结果身份，不能用于单条修改 CAS。页外内容变化会使旧页失效；无关 scope 不使当前页失效。fixture 内存端口继续使用 mpg1；两个版本都通过公共参数验证，跨实现令牌不保证相同。

## 观察结果

[归档结果](../evidence/memory-page-native-2026-09-12.json)。清理后插件贡献为 0、合成 active 记忆为 0。

验收入口：`apps/web/tests/desktop/desktop-memory-page-probe.ts`。

1. 经生产 `commitDomainEvents` 写入 105 条合成记忆，启动由当前源码构建的 Memory Desk，使用真实 WebKit Worker。
2. 经插件已注册命令及返回的分页回调遍历六页：`20,20,20,20,20,5`，合计 105、唯一 ID 105。
3. 真实 Agent `search_memory` 工具经生产端口取得 100＋5 条，版本一致、唯一 ID 105，末页 nextOffset 为 null。没有调用模型，不称为自主检索语义验收。
4. 实际桌面显示第 6/6 页，Next 禁用；点击宿主 Previous 按钮进入第 5/6 页。
5. 经生产事件修改第一条低优先级记忆（位于第一页之外）。旧版本原生续页返回 `memory/conflict`；Memory Desk 的真实观察回调将旧内容和分页控件替换为错误及 Refresh。
6. 点击实际 Refresh 按钮，恢复第 1/6 页；旧错误清除，记忆列表重新显示。检查了桌面截图 `/tmp/readaware-memory-page-refreshed.png`。

## 定向验证

- 原生 4 项测试：1,005 条完整遍历、稳定优先级、页外修改/遗忘、无关 scope、大小写/中日文匹配、无效输入、旧令牌、末尾/越界、数据库失败。
- TS 9 项测试：已有算法、编译插件翻页、生产 domain 权限/退休/错误，以及 Agent 工具续页/书籍 scope。
- Web 与桌面验收代码类型检查通过；Memory Desk 构建通过；实际 debug Tauri 构建与运行通过。

## 边界

仍扫描匹配内容以计算精确身份；SQLite 排序也有成本，本次不声称固定 CPU/内存/字节预算、SQL LIMIT 索引直达或耐久快照。`listMemories` 和巩固快照不是本轮分页入口，仍可读取完整集合。memory:read 仍是领域授权，不是按书/字段授权。因此 MEM01 仍标部分，本轮关闭“前端全量分页”和“新分页真实 Worker/Tauri 未验”两个具体缺口。未验发布包、其他操作系统或真实模型自主多轮行为。
