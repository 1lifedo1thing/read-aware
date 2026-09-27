/**
 * Dependency-boundary ratchet around dependency-cruiser, run from a workspace directory:
 *
 *   bun ../../scripts/check-dependency-baseline.ts            # check (CI)
 *   bun ../../scripts/check-dependency-baseline.ts --update   # rewrite the baseline
 *
 * The workspace provides `.dependency-cruiser.cjs` (rules) and
 * `.dependency-cruiser-known-violations.json` (the recorded debt, in dependency-cruiser's
 * own `--output-type baseline` format, so `depcruise --ignore-known` understands it too).
 *
 * The check fails when a violation is not in the baseline (new debt) AND when a baseline
 * entry no longer occurs (fixed debt that must be removed from the file). The second half is
 * the ratchet `--ignore-known` alone lacks: without it a fixed violation could silently come
 * back later. `--update` is for recording fixes; adding debt to the baseline needs review.
 */
import { resolve } from "node:path";

type Violation = {
  type?: string;
  from: string;
  to: string;
  rule: { name: string; severity: string };
  cycle?: Array<string | { name: string }>;
};

const CONFIG = ".dependency-cruiser.cjs";
const BASELINE = ".dependency-cruiser-known-violations.json";
const cwd = process.cwd();
const update = process.argv.includes("--update");
const roots = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
const sources = roots.length ? roots : ["src"];
const depcruise = resolve(cwd, "node_modules/.bin/depcruise");

async function cruise(outputType: "json" | "baseline"): Promise<string> {
  const child = Bun.spawn([depcruise, ...sources, "--config", CONFIG, "--output-type", outputType],
    { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  // With json/baseline output depcruise exits non-zero only when it cannot run.
  if (code !== 0 || stderr.includes("ERROR")) throw new Error(`dependency-cruiser failed (exit ${code}):\n${stderr}`);
  return stdout;
}

/**
 * npm targets resolve to install-specific paths (bun's node_modules/.bun/<pkg>@<version>+<hash>/),
 * so compare them by package name; local modules compare by path.
 */
function moduleId(path: string): string {
  const at = path.lastIndexOf("node_modules/");
  if (at < 0) return path;
  const [first, second] = path.slice(at + "node_modules/".length).split("/");
  return `npm:${first?.startsWith("@") ? `${first}/${second}` : first}`;
}

function key(violation: Violation): string {
  const cycle = violation.cycle?.map(step => moduleId(typeof step === "string" ? step : step.name)).join(" -> ");
  return [violation.rule.name, moduleId(violation.from), moduleId(violation.to), cycle ?? ""].join(" | ");
}

function describe(violation: Violation): string {
  const cycle = violation.cycle?.map(step => typeof step === "string" ? step : step.name);
  return `  [${violation.rule.name}] ${violation.from} -> ${violation.to}${cycle ? `\n      cycle: ${[violation.from, ...cycle].join(" -> ")}` : ""}`;
}

if (update) {
  const baseline = JSON.parse(await cruise("baseline")) as Violation[];
  await Bun.write(resolve(cwd, BASELINE), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Recorded ${baseline.length} known violations in ${BASELINE}.`);
  process.exit(0);
}

const current = (JSON.parse(await cruise("json")) as { summary: { violations: Violation[] } }).summary.violations;
const baselineFile = Bun.file(resolve(cwd, BASELINE));
const known = await baselineFile.exists() ? await baselineFile.json() as Violation[] : [];
const knownKeys = new Set(known.map(key)), currentKeys = new Set(current.map(key));
const added = current.filter(violation => !knownKeys.has(key(violation)));
const fixed = known.filter(violation => !currentKeys.has(key(violation)));

const counts = new Map<string, number>();
for (const violation of current) counts.set(violation.rule.name, (counts.get(violation.rule.name) ?? 0) + 1);
console.log(`dependency boundaries: ${current.length} violations, ${known.length} recorded (${[...counts].map(([rule, count]) => `${rule} ${count}`).join(", ") || "none"})`);

if (added.length) {
  console.error(`\n${added.length} new dependency violation(s). Fix them; the rule comments in ${CONFIG} explain each boundary:`);
  for (const violation of added) console.error(describe(violation));
}
if (fixed.length) {
  console.error(`\n${fixed.length} recorded violation(s) no longer occur. Shrink the baseline with \`bun run lint:deps:baseline\` and commit it:`);
  for (const violation of fixed) console.error(describe(violation));
}
process.exit(added.length || fixed.length ? 1 : 0);
