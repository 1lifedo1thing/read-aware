# 同步引擎

同步把多台设备的阅读数据连接起来：本机保存业务数据，中继或传输插件保存和搬运
加密事件与文件。检索、记忆整理和业务状态合并仍在本机执行。
文档整理于 2026-09-15，依据下列源码；没有重新核验线上服务配置或跨设备运行。

## 代码按什么职责划分

| 职责 | 入口 |
| --- | --- |
| 编排事件推送、拉取、文件和检查点 | [sync-engine.ts](../../apps/web/src/platform/sync/sync-engine.ts) |
| 定时及唤醒调度 | [sync-scheduler.ts](../../apps/web/src/platform/sync/sync-scheduler.ts) |
| SQLite 与原生存储适配 | [sync-store.ts](../../apps/web/src/platform/sync/sync-store.ts)、[storage/sync.rs](../../apps/desktop/src-tauri/src/storage/sync.rs) |
| 默认中继协议访问 | [relay-client.ts](../../apps/web/src/platform/sync/relay-client.ts) |
| 传输提供者注册及会话 | [transport-registry.ts](../../apps/web/src/platform/sync/transport-registry.ts)、[transport-session.ts](../../apps/web/src/platform/sync/transport-session.ts) |
| 加密信封 | [sync-envelope.ts](../../apps/web/src/platform/sync-envelope.ts) |
| 登录、连接及密钥准备 | [connect.ts](../../apps/web/src/platform/sync/connect.ts) |
| 中继服务及部署说明 | [apps/relay](../../apps/relay/)、[relay 配置](../../apps/relay/wrangler.jsonc) |

## 一轮同步做什么

1. 从本机 outbox 取出待发送的事件，加密后交给传输层。
2. 分页拉取远端事件，观察远端时钟，解密后交给原生 `apply_remote_events`。
3. 原生存储去重并按事件顺序更新投影；遇到落在当前处理位置之前的事件，走既有重放
   或暂存后统一完成的路径。不能先推进游标再假装数据已落库。
4. 同步文件登记及必要字节；书籍文件可按需获取，本地缺文件和远端拒绝都必须显式处理。
5. 按现有策略验证远端记账、生成或发布检查点，并分批补齐新设备的旧日志。

引擎本身编排注入的存储和传输端口，计时器、原生调用和网络请求分别由外层负责。
插件传输复用这一套引擎，不在插件里另写一套业务合并规则。

调度节奏按后端区分：中继连接由调度器自动运行（启动一轮、聚焦拉取、本地写入后
延迟推送、定时轮询、失败退避）；插件传输（WebDAV 等）没有自动节奏，调度器只绑定
连接并报告状态，每一轮都来自用户或 Agent 的显式“立即同步”。传输的连接、状态、
立即同步与断开全部放在提供该传输的插件自己的设置页，“数据与同步”只保留指向
该页的一行（插件被停用或卸载时才在此处提供断开）。

## 身份、加密和新设备

登录会话用于访问服务；加密口令和密钥用于解开阅读数据。两者职责不同，WebDAV 等
传输的登录凭据也不能代替阅读数据的加密口令。事件与文件使用版本化加密信封，
算法和载荷以实现与 [共享同步协议](../../packages/core/src/sync.ts) 为准。

空设备可以使用兼容的远端检查点引导，再补充日志。检查点需要验证 schema、来源与
完整性，不能把任意数据库文件当作可信快照。不具备检查点能力的中继有明确兼容路径；
已有数据的合并与完整备份恢复遵守各自入口的前置条件。

## 失败、退出与恢复

网络故障、登录失效、额度限制、不可恢复的文件拒绝和用户取消是不同结果。
`unverified` 表示需要向远端核对是否已收到，不能一律当作必须重新上传。
同步暂停或取消不能声称撤销已经完成的远端写入；退出和恢复需协调已有持久工作。

同步不是完整备份。目标设备身份、会话、同步游标和运行队列在备份恢复中的处理见
[完整备份](../features/full-backup.md)。插件能发现和调用的同步控制见
[插件系统](../plugins/plugin-system.md)。

## 验证与历史

历次原生、桌面和同步观察保留在 Git 历史中；
单进程 loopback、测试端口和实际跨设备同步分别证明不同边界。
部署操作以 relay 配置、项目脚本和当次环境为准，不沿用旧文档中的 OAuth、邮件或线上状态。

[早期同步设计](../archive/designs/sync-engine.md) 保留协议演进、分阶段实施、旧部署
runbook 和历史性能数据，仅供追溯。
