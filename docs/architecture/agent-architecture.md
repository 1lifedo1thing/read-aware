# Agent 架构

ReadAware 使用一个核心阅读 Agent，配合确定性的检索、存储与后台整理流程。
运行时已实现；本页说明当前结构，不把模型回答质量或全部桌面场景视为已经验收。
文档整理于 2026-09-15，依据下列源码入口。

## 会话与记忆

- 每本书有自己的持久对话；全局 Context 页面允许用户创建多个对话。
- 会话决定本轮关注哪本书、读取哪些上下文；用户记忆和全局记忆不随对话拆成多份。
- 聊天记录保存原始交流。长期连续性由记忆、画像、书籍摘要与图谱支持，不能依靠
  无限回放完整聊天记录。
- 书内运行时保留当前章节会话；跨章节发送、权限或策略变化时按运行时规则重建或
  刷新上下文。全局对话按轮装配上下文。近期转录窗口仍可参与对话，这不等于把转录
  当成长期记忆。

入口：[ThreadScope](../../packages/agent/src/thread-scope.ts)、
[AgentThread](../../packages/agent/src/runtime/thread.ts)、
[上下文装配](../../packages/agent/src/context/system-prompt.ts)。

## 一轮请求怎样执行

1. 桌面聊天适配器把用户输入、附件和当前阅读位置交给 `AgentRuntime`。
2. `AgentThread` 按书籍范围、阅读进度和隐私设置装配上下文，并解析本轮可用工具。
3. 主聊天模型生成回答，必要时通过工具查询正文、记忆或请求宿主动作。
4. 宿主负责实际授权、需要用户确认的操作、持久写入和真实结果；工具不能绕过它。
5. 运行时流式返回文字与界面事件，持久化对话，并在策略允许时排队提炼记忆或更新摘要。

入口：[桌面适配器](../../apps/web/src/features/ai/agent/pi-chat-transport.ts)、
[宿主运行时装配](../../apps/web/src/features/ai/agent/agent-runtime.ts)、
[核心运行时](../../packages/agent/src/runtime/runtime.ts)、
[工具注册](../../packages/agent/src/tools/registry.ts)。

## 检索、整理与模型

检索以本地 SQLite、全文索引和结构化范围为基础。Agent 可以继续查目录、搜索正文、
读取章节；默认架构不引入 embedding 或向量数据库。

主聊天使用 `smart` 模型角色，提炼、摘要等后台流程使用 `fast` 角色；实际模型和
账号由配置解析。推理通过宿主提供的网络传输访问远端服务，数据与检索留在本机。
取消、权限收紧、模型失败和后台排空由既有运行时处理，不能把请求受理当成保存成功。

画像和实体整理见 [画像与身份](./identity-and-profile.md)，上下文输出见
[上下文包](./context-bundles.md)，阅读快捷动作见
[阅读 AI 动作](../features/reading-ai-actions.md)，读者访谈见
[阅读建档](../features/onboarding.md)。

## 宿主与插件的边界

Agent 和插件消费同一套宿主业务能力，各自拥有独立权限和作用域。插件可以提供
工具、上下文和记忆候选，但不能直接访问数据库、操作系统或其他插件私有数据。
详细规则见 [插件系统](../plugins/plugin-system.md) 与
[能力模型](../capabilities/host-capability-model.md)。

## 验证与历史

当前能力接线查 [能力矩阵](../capabilities/host-capability-matrix.md)；剩余真实组合
场景查 [集中验收](../capabilities/host-capability-acceptance.md)。模型行为评测和桌面
操作验收是不同证据，任何一个都不能代替另一个。

[早期设计](../archive/designs/agent-architecture.md) 保留 SDK 选型、初始方案和迁移讨论；
其中“实现未开始”等状态只属于当时，不作为现在的待办。
