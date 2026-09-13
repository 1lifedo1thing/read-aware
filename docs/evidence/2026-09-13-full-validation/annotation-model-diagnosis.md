# 标注模型范围与标点偏差诊断

本轮只读检查当前工具契约、发送给模型的实际消息、全部工具参数/回执及最终状态；没有新增模型调用，也没有修改产品、fixture 或评分规则。

结论：**这批样本没有预先提供可直接使用的完整选区 CFI。** 它们测试的是“收到选区引文后重新查找范围”，尚不能代表“真实宿主已提供 selection.range 后直接复制”的路径。同时，模型确实违反了已有的范围保真契约；不能把全部失败归因于缺少提示。

## 输入与契约证据

- `packages/agent/src/evals/suites/realbook/real-book-common.ts:164` 的 `selectionCursor` 只有章节、进度和可见文字；`:304` 的附件只有 `{ text: sentence }`，没有 anchor/range。该标注场景没有把对应范围装入 reader 的 selection。
- `packages/agent/src/testing/reader.ts:15` 的初始 selection 是 null，`:97` 的 `getSession` 返回它。两固定题实际第一次工具回执均为 `selection:null`。修复阅读器版本后，Berger 的版本已与正文一致，但 selection 仍是 null。
- 实际工件的 `output.modelRequests[0].context.messages` 中，两个固定题均有完整引文和中文笔记要求，包括末尾标点，但没有任何 `epubcfi(`。题库外问题的第一轮实际消息同样如此。并非只从场景定义推测模型收到了什么。
- `packages/agent/src/ports.ts:61` 的附件契约包含 text、可选 anchor/chapter；`runtime/history.ts:10` 将 text 和 chapter 写入用户消息，不输出 anchor。真实前端 `apps/web/src/features/ai/agent/pi-chat-transport.ts:40` 会把 cfiRange 转成 attachment.anchor；这仍不同于模型已经得到带内容版本的完整 BookTextRange。真实宿主另有 `get_reading_session.selection.range` 路径，这批内存样本没有验证该路径。
- `packages/agent/src/tools/annotation-tools.ts:34` 已要求：从会话或查询复制 range，提交该范围的完整准确文本，范围与引用会被验证。`navigation-tools.ts` 的 `read_book_range` 描述明确禁止编造或改写 bookId/contentVersion/CFI，并要求失效范围重新查询。**上述描述也确实存在于固定题工件的第一轮 `context.tools`，并非仅当前代码事后补入。**
- `find_book_locations` 描述说返回精确匹配，但没有直接说明“range 只覆盖 query 命中的文字，excerpt.pre/post 不属于 range，textQuote 不能扩展范围”。`book-range-schema.ts:3` 的 CFI 和 textQuote 字段仅有类型/长度约束，没有补充该关系。
- `annotation-tools.ts:39` 的 body 仅描述为笔记正文，kind 描述为用户自己的话；没有明确区分“用户给定逐字笔记”与“要求模型组织笔记”。这比高亮文字的 exact 要求弱，但也没有授权删改用户给出的内容。

## 逐条轨迹

这里按 `output.tools` 数组编号，1 起算，不把模型轮次当工具次数。

| 样本 | 实际行为 | 可以归因的部分 |
| --- | --- | --- |
| 最新 Berger 固定题，9 次调用 | #1 会话没有选区。#2 只检索选句前 12 字，得到 `fixture:4:33:45`；#3–4 用该短范围提交完整 22 字选句及更长 exact，高亮和笔记均被拒。#5 读取短范围后，#6 改用含标点的完整选句查询，取得 `fixture:4:33:55`；#7 验文，#8–9 正确写入。 | 两次失败是把局部查询范围当完整选区；并未先拿到完整 CFI 再无故重算。最终通过完整查询获得新范围，没有自行拼 CFI；最终选区、笔记正文和附着均正确。机器仍受已有 noErrors 规则判失败，不等于最终操作失败。 |
| Lebon 固定题，11 次调用 | #2 只查询选段末尾 15 字，得到 `fixture:10:225:240`；#3 已明确读回 totalLength=15。#4–5 仍用它提交整段 53 字，引入更长 exact，均被拒。#6–7 查询其他短片段，#8 再用 `188:199` 提交整段，被拒。#9 自行将范围改成 `188:241` 后读取成功，#10–11 写入同一完整范围。两次 note 请求的 body 都已缺少用户给定的末尾句号。 | 模型在看见实际长度后仍混用范围，不能只归因于描述不够详细；#9 直接违背“不要改写 CFI”。笔记句号在工具输入中就缺失，不是存储、序列化或观察器删掉的。最终原文范围已正确，笔记正文有细微偏差，答案另夹英语过程文字。 |
| Berger 题库外，6 次调用 | 第一轮只有完整句子引文，没有 CFI。#1 查询时省掉末尾句号，得到 `fixture:4:15:32`。#2–3 提交带句号的文本，完整来源校验拒绝；#4 试图附加更长 textQuote，仍被拒。#5–6 改为不含句号的 text/quotedText，成功写入下划线和同范围笔记，最终只说完成。 | 错误恢复策略是缩短用户选区以迁就短范围，未重新查询完整句子。下划线 style 和笔记正文均正确；源选区被改变且未告知。这不是版本错误，本题未调用会话，也没有 stale 错误。 |

Lebon 的数字 CFI 是内存 fixture 的可读偏移编码。模型自行拼出的范围读回正确，只能证明该 fixture 上文本匹配，不能证明模型能可靠构造 Foliate DOM/PDF 定位。真实 CFI 不应让模型计算；现有工具契约已经禁止这种操作。

## 最小可修方向与验收边界

1. **先补齐“真实已选中”场景的输入一致性。** 如果该固定题意图验证宿主已有选区，应在场景 setup 中用实际正文范围初始化 reader selection，使 `get_reading_session` 返回与附件完全相同的文本及版本范围。同时保留明确命名的“只有历史引文、当前无选区”恢复场景。这样才能分清直接使用宿主范围与从引文重新定位的能力；本次不能声称模型忽略了宿主已有的完整选区 CFI。这里只建议有界场景修正，不建议新增通用选区框架。
2. **补充当前两处工具描述中的具体关系。** 在查询/标注描述中明确：范围只覆盖精确 query 命中；前后文不在范围内；textQuote 仅验证，不能扩展；当用户要求整段标注而命中只有部分时，用完整原文（包含标点）重新查询，不改 CFI，也不缩短选区。三个被查选区都远低于 500 字查询上限，现有工具已可完成，不需要为这些样本新增扩选 API。Berger 的成功恢复就是现有可用路径。
3. **对逐字笔记要求补一句窄约束。** 用户明确给出笔记正文时，保留其文字和标点；不要将该约束泛化到用户要求总结或润色的笔记。Lebon 偏差在模型参数生成处，应针对这里验收，不调整持久化语义。
4. 现有完整范围验证必须保留；不接受错误范围自动重定位，不把 textQuote 当扩选指令，也不以放宽 noErrors 或选区边界断言来宣称修好。是否接受工具内部恢复后的最终结果，应独立报告机器门禁和最终读者任务结果。

以上是证据支持的最小改动候选，**没有实测证明提示补充会消除模型错误**。已有“不得改写 CFI”仍被 Lebon 忽略，表明提示缺失不是唯一原因；不能承诺再加一句说明便可靠。

## 不能从本轮归因或推断的事项

- 不能把最初 Berger 的版本错误当纯模型失败：它受 fixture 会话固定版本与正文哈希版本不一致影响，已另行修复，保留原失败；本报告主要依据修复后的 Berger。
- 不能说完整选区文字或标点没有给模型：实际发送消息中都存在。缺失的是可直接使用的版本范围；正文偏差来自模型生成的工具参数。
- 不能说模型“必须计算 CFI 才能完成”：完整原文查询可返回所需范围，Berger 已实际走通。
- 不能把最终同范围写入成功等同于完整任务：题库外的两个标注虽然同范围，却比用户选区少一个句号。
- 不能由单次轨迹确定模型内部为何选择局部查询，或量化该问题在其他模型/书籍中的发生率；这里识别的是可观察决策和契约违反。
- 没有真实 Tauri 选区、绘制、滚动定位或重启持久化证据；不归因于生产 renderer、SQLite 或宿主 range 捕获错误。

## 私有证据定位

完整书文和模型输出保留在本地 `.eval`，本报告仅包含行为摘要与定位信息。

| 工件（仓库根目录相对路径） | 重点 JSON 路径 | SHA-256 |
| --- | --- | --- |
| `packages/agent/.eval/berger-20260913T070639Z-9a80dd98/runs.jsonl`，唯一一行 | `output.modelRequests[0].context.messages/tools`；`output.tools[0..8]`；`output.state`；`output.answer` | `892555aaaf949191b60fe4fb194fcfac77d48d59d54503e7968082ebcd48f14d` |
| `packages/agent/.eval/lebon-20260913T070333Z-12f410fc/runs.jsonl`，唯一一行 | `output.modelRequests[0].context.messages/tools`；`output.tools[0..10]`；`output.state`；`output.answer` | `a0e992f326558840d1f8496bda3b2e01a92a2c701ec7247f6d0231af074792ed` |
| `packages/agent/.eval/berger-20260913T070305Z-798993c5/annotation-followup-observation.json` | `selection`；`observation.modelRequests[0].context.messages`；`observation.tools[0..5]`；`observation.state` | `f41c97480a4393f5315b9e84192b338c58f340211b3032e03949bcca8862c73a` |

对应目录中的 `human-reviews.json` 保留四维人工评分；题库外的可读会话在关联 run 的 `manual-sessions.json`。复核更正：此前评语文字将最新 Berger/Lebon 的工具调用次数分别写成 10/12，数组实数为 **9/11**；本报告按数组重新逐项核对。该计数勘误不改变错误调用数、最终状态或评分。本次不改写历史评语或共享汇总。
