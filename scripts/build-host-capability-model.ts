import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { baselineCoverage, sources } from "../docs/capabilities/host-capability-matrix.data";
import { evidence, refinements, scenarioCoverage, scenarios, units } from "../docs/capabilities/host-capability-model.data";
import { validateModel } from "./host-capability-model-check";

const { rows, owners, catalog } = validateModel();
const title = "ReadAware 宿主能力统一模型";
const status = "目标模型与现状映射；不是 API 已实现声明";
const date = "2026-09-15";
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const md = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const links = (ids: string[]) => ids.map(id => `[${id}](#${id})`).join(" · ");
const evidenceLinks = (ids: string[]) => ids.map(id => `[${id}](./host-capability-matrix.md#${id})`).join(" · ");
const baseline = readFileSync("docs/archive/capabilities/plugin-capability-baseline.md", "utf8");
const legacy = [...baseline.matchAll(/^\| (W\d{2}) \| (.*?) \| (.*?) \| (.*?) \|$/gm)];
if (JSON.stringify(legacy.map(m => m[1]).sort()) !== JSON.stringify(Object.keys(scenarioCoverage).sort())) throw new Error("Scenario roster drift");
const acceptanceIds = [...baseline.matchAll(/^\| ([A-R]\d{2}) \| [EPMB] \|/gm)].map(m => m[1]);
if (JSON.stringify(acceptanceIds.sort()) !== JSON.stringify(Object.keys(baselineCoverage).sort())) throw new Error("Baseline roster drift");

const conclusions = [
  "Domain 是宿主拥有的业务状态与行为，Contribution 是插件提供的实现，Service 是有边界的平台操作。Agent 与插件按各自授权消费这些能力。",
  "本页描述责任与设计边界，当前接线由能力矩阵记录。目标操作、历史裁决和候选场景都不能代替当前验收清单。",
];
let markdown = `# ${title}\n\n人读版：[统一模型](./host-capability-model.html)。现状：[能力矩阵](./host-capability-matrix.md)。\n\n- 状态：**${status}**。\n- 文档整理日期：${date}（不代表本日重新验收所有行为）。\n- 责任源：[host-capability-model.data.ts](./host-capability-model.data.ts)；接线源：[host-capability-matrix.data.ts](./host-capability-matrix.data.ts)。\n- ${rows.length} 条证据映射到 ${units.length} 个责任单元，${catalog.size} 个当前 catalog 成员、129 个旧验收项及 ${legacy.length} 个旧场景保留反查。\n\n## 结论\n\n${conclusions.join("\n\n")}\n\n当前工作只看 [C01–C09 集中验收](./host-capability-acceptance.md)，运行结果看 [证据索引](./host-capability-delivery.md)。历史 GAP 不自动判定仍缺或已关闭，也不自动产生工作项。\n\n## 统一责任模型\n\n每个单元的目标、限制和通过条件是设计契约；行级源码接线与实际验收分别核对。Schema 和 Contract 约束表达及执行，不增加系统权限。\n`;
for (const u of units) {
  markdown += `\n### <a id="${u.id}"></a>${u.id} · ${u.family} · ${u.owner}\n\n**${u.title}**\n\n- 当前 catalog 身份：${u.catalog.map(c => `\`${c}\``).join("、") || "责任或边界，没有独立 catalog 身份"}。\n- [设计] 操作：${u.operations}\n- [设计] Agent：${u.agent}\n- [设计] 插件：${u.plugin}\n- [设计] 限制：${u.limits}\n- [设计] 通过条件：${u.acceptance}\n- [代码] 现状证据：${evidenceLinks(u.refs)}。\n`;
}
markdown += `\n## 历史设计裁决\n\n以下保留早期审计的取舍和定位线索，其中的“缺口”“本轮”属于记录当时；当前状态以行级矩阵及源码为准。它们不是当前待办。\n\n| 裁决 | 分类 | 来源 | 当时的取舍 |\n| --- | --- | --- | --- |\n${refinements.map(([id, kind, refs, text]) => `| ${id} | ${kind} | ${evidenceLinks(refs.split(" "))} | ${md(text)} |`).join("\n")}\n\n相关源码入口：\n\n${evidence.map(path => `- [${path}](../../${path})`).join("\n")}\n\n## 组合场景\n\n以下是设计阶段收集的候选场景，包含当时的缺口描述；执行范围与当前验收判断只由集中验收清单和证据索引确定。\n\n| 场景 | 责任单元 | 设计阶段记录 |\n| --- | --- | --- |\n${scenarios.map(([name, ids, text]) => `| ${name} | ${links(ids.split(" "))} | ${md(text)} |`).join("\n")}\n\n### 旧 32 场景反查\n\n| 场景 | 名称 | 模型归属 | 原验收条件 |\n| --- | --- | --- | --- |\n${legacy.map(m => `| ${m[1]} | ${m[2]} | ${links(scenarioCoverage[m[1]])} | ${md(m[4])} |`).join("\n")}\n\n## 旧基线反查\n\n[历史基线](../archive/capabilities/plugin-capability-baseline.md) 保留原 129 项；其 E/P/M/B 是当时的接口分类。\n\n| 旧项 | 当前证据 | 模型归属 |\n| --- | --- | --- |\n${Object.entries(baselineCoverage).map(([id, refs]) => `| ${id} | ${evidenceLinks(refs)} | ${links([...new Set(refs.flatMap(ref => owners.get(ref)!))])} |`).join("\n")}\n\n## 双端现状反查\n\n下表与能力矩阵共用数据源；源码接通不能代替真实验收。\n\n| 证据 | 能力/宿主 | Agent 当前 | 插件当前 | 消费者/边界 | 模型 | 来源 |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.map(r => `| ${r.id} | ${md(r.name)} / ${r.host} | ${r.agent.state}：${md(r.agent.via)} | ${r.plugin.state}：${md(r.plugin.via)} | ${md(r.consumers)}；${md(r.gap)} | ${links(owners.get(r.id)!)} | ${r.sources.map(key => `[${key}](../../${sources[key]})`).join(" ")} |`).join("\n")}\n\n## 验证与维护\n\n生成器检查映射、目录身份、来源路径和生成一致性；不证明模型语义、真实桌面、打包、跨设备或外部服务行为。HTML 的固定 CDN 字体和图标资源需要网络。\n\n修改对应数据源后生成，再运行：\n\n\`\`\`sh\nbun run check:capabilities\nbun run check:docs\n\`\`\`\n`;

const detail = (id: string, label: string, body: string, terms = "") => `<details class="ep" id="${esc(id)}" data-search-section="${esc(terms)}"><summary>${esc(label)}</summary><div class="ep-body">${body}</div></details>`;
const sections = [
  ["model", "统一模型"], ["findings", "历史设计裁决"], ["scenarios", "组合场景"], ["priorities", "当前执行范围"], ["boundaries", "验证边界"],
];
const body = `<section id="model"><h2>统一模型</h2><p>Agent 与插件共用业务所有权，不共用所有权限。Schema 只描述呈现，Contract 只约束执行；两者都不是新增权力。</p>${["Domain", "Contribution", "Service", "Schema", "Contract", "Boundary"].map(family => `<h3>${family}</h3>${units.filter(u => u.family === family).map(u => detail(u.id, `${u.id} · ${u.title}`, `<p><strong>目标：</strong>${esc(u.operations)}</p><p><strong>边界：</strong>${esc(u.limits)}</p><p><a href="./host-capability-model.md#${u.id}">双端接入与通过条件</a></p>`, `${u.owner} ${u.agent} ${u.plugin} ${u.refs.join(" ")}`)).join("\n")}`).join("\n")}</section>
<section id="findings"><h2>历史设计裁决</h2><p>以下是设计阶段的取舍记录，缺口描述属于记录当时；当前状态查矩阵，执行范围查集中验收清单。</p>${refinements.map(([id, kind, refs, text]) => detail(id, `${kind} · ${text.split("；")[0].split("。")[0]}`, `<p>${esc(text)}</p><p><a href="./host-capability-matrix.html">现状证据：${esc(refs)}</a></p>`, `${kind} ${refs}`)).join("\n")}</section>
<section id="scenarios"><h2>组合场景</h2><p>以下为设计阶段候选场景及当时缺口，不作为当前待办或验收结论。</p>${scenarios.map(([name, refs, text], i) => detail(`scenario-${i}`, name, `<p>${esc(text)}</p><p>${refs.split(" ").map(id => `<a href="#${id}" data-unit-link>${id}</a>`).join(" · ")}</p>`, `${name} ${refs}`)).join("\n")}</section>
<section id="priorities"><h2>当前执行范围</h2><p>仅按 <a href="./host-capability-acceptance.md">C01–C09 集中验收</a> 执行。当前阶段和真实结果见 <a href="./host-capability-delivery.md">交接与证据索引</a>。本页不维护第二份优先级列表。</p></section>
<section id="boundaries"><h2>验证边界</h2><p>${rows.length} 条证据、${catalog.size} 个当前 catalog 成员、129 个旧验收项、32 个旧场景都有模型归属；不等于所有未知行为零遗漏。</p><p>已陆续实现共享能力和 Jumper 等组合插件，局部桌面证据见执行账本；尚未完成全能力 Tauri、完整打包 CSP、跨设备同步、外部服务和用户插件安装态验收。</p><p>历史 GAP 不自动判定仍缺或已关闭，需对应源码和实际证据。静态文档浏览器检查不能替代产品验收；固定 CDN 字体/图标资源需要网络。本页无 Mermaid 图。</p></section>`;
const replacements: Record<string, string> = {
  TITLE: esc(title), STATUS: esc(status), DATE: date, BODY: body,
  NAV: sections.map(([id, label]) => `<a href="#${id}">${label}</a>`).join("\n"),
  CONCLUSION: esc(conclusions[0]),
};
let html = readFileSync("scripts/templates/host-capability-model.html", "utf8");
html = html.replace(/\{\{([A-Z]+)\}\}/g, (_, key) => {
  if (!(key in replacements)) throw new Error(`Unknown template token ${key}`);
  return replacements[key];
});
if (html.split("\n").length > 600) throw new Error("HTML line budget exceeded");
for (const [path, text] of Object.entries({ "docs/capabilities/host-capability-model.md": markdown, "docs/capabilities/host-capability-model.html": html })) {
  if (process.argv.includes("--check")) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) throw new Error(`Generated document drift: ${path}`);
  } else writeFileSync(path, text);
}
console.log(`${process.argv.includes("--check") ? "Verified" : "Generated"}: ${units.length} ownership units, ${rows.length} evidence rows, ${catalog.size} catalog members, 129 acceptance items, ${legacy.length} scenarios.`);
