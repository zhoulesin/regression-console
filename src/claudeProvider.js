import { parseAnalyzeResponse } from './parseAnalyze.js';
import { parseCatalogResponse } from './catalog.js';
import {
  buildCatalogContext,
  buildContext,
  buildRetrySection,
  IRON_RULES,
} from './contextPack.js';
import {
  buildDiagnosisConversation,
  buildFailureContext,
} from './failureContext.js';
import { runClaude } from './claudeRun.js';

/**
 * 让 Claude 产出 Maestro YAML（只出 Diff，写盘走 FileGate + 人工批准）。
 *
 * @param {{
 *   appRoot: string,
 *   flowRoot: string,
 *   feature: { code: string, title: string, criteria: string, precondition: string, chapter?: number },
 *   priorRun?: { failed_step?: string|null } | null,
 *   priorDiagnosis?: { response?: string|null } | null,
 *   bin?: string,
 *   onData?: (chunk: string) => void,
 *   registerChild?: (child: import('node:child_process').ChildProcess | null) => void,
 * }} opts
 * @returns {Promise<{ rationale: string, risks: string[], files: { path: string, content: string }[], raw: string, prompt: string }>}
 */
export async function analyzeWithClaude({
  appRoot,
  flowRoot,
  feature,
  priorRun,
  priorDiagnosis,
  bin,
  onData,
  registerChild,
}) {
  const prompt = [
    '你是 Maestro YAML 作者。只输出一个 JSON 对象，不要改仓库文件。',
    IRON_RULES,
    `功能点 ${feature.code} ${feature.title}`,
    `判定：${feature.criteria}`,
    `前提：${feature.precondition}`,
    feature.notes ? `功能备注：${feature.notes}` : '',
    buildContext(appRoot, feature, flowRoot),
    buildRetrySection({ run: priorRun, diagnosis: priorDiagnosis }),
    'JSON shape: {"rationale":"","risks":[],"files":[{"path":"maestro/...yaml","content":"完整文件"}]}',
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await runClaude({ prompt, cwd: appRoot, bin, onData, registerChild });
  return { ...parseAnalyzeResponse(raw, flowRoot), raw, prompt };
}

/** 根据项目代码增量提议功能点；只读、不写 YAML。 */
export async function catalogWithClaude({
  appRoot,
  flowRoot,
  module,
  hint,
  moduleNotes,
  existingFeatures,
  sourceDirs,
  bin,
  onData,
  registerChild,
}) {
  const existing = existingFeatures
    .map(
      (row) =>
        `${row.code} | ch${row.chapter} | ${row.title} | ${row.criteria} | ${row.precondition}`,
    )
    .join('\n');
  const prompt = [
    '你是 Android 真机回归功能清单分析员。只输出一个 JSON 对象；不要修改文件，不要输出 Maestro YAML。',
    `模块：${module}`,
    `用户要求补充的范围：${hint}`,
    moduleNotes ? `模块回归备注：\n${moduleNotes}` : '',
    `已有功能点（只提议新的；同编号或同标题放 skipped，禁止改旧条目）：\n${existing || '无'}`,
    buildCatalogContext(appRoot, module, flowRoot, sourceDirs),
    [
      '规则：',
      '1. 一个功能点只描述一个可独立验收的产品行为。',
      '2. code 必须是 章.序号（如 2.6），title 和 criteria 非空。',
      '3. criteria 必须描述 UI 上可观察的结果；涉及行/卡片时写清目标容器，不能“点了就算通过”。',
      '4. precondition 写清需要什么 List/Todo/成员/Display/Filter 状态。',
      '5. 控件 id 只能来自上面的参考内容或你实际 Read 到的候选文件；不要编造。',
      '6. 只覆盖用户点名范围，最多 15 条。',
      'JSON shape: {"rationale":"","skipped":[{"code":"","title":"","reason":"duplicate_code|duplicate_title","detail":""}],"features":[{"code":"2.6","chapter":2,"chapter_title":"","title":"","criteria":"","precondition":""}]}',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
  const raw = await runClaude({ prompt, cwd: appRoot, bin, onData, registerChild });
  return {
    ...parseCatalogResponse(raw, existingFeatures),
    raw,
    prompt,
  };
}

/**
 * 诊断一次失败的 Maestro run。只产出文字结论，不产 Diff、不写盘、不动状态机。
 *
 * @param {{
 *   flowRoot: string,
 *   feature: { code: string, title: string, criteria: string, precondition: string },
 *   run: { failed_step?: string|null, artifact_dir?: string|null, log_excerpt?: string|null, exit_code?: number|null },
 *   flowPath?: string | null,
 *   history?: { user_hint?: string|null, response?: string|null }[],
 *   hint?: string,
 *   bin?: string,
 *   onData?: (chunk: string) => void,
 *   registerChild?: (child: import('node:child_process').ChildProcess | null) => void,
 * }} opts
 * @returns {Promise<{ text: string, prompt: string }>}
 */
export async function diagnoseWithClaude({
  flowRoot,
  feature,
  run,
  flowPath,
  history,
  hint,
  bin,
  onData,
  registerChild,
}) {
  const prompt = [
    '你是 Maestro 真机回归的排障工程师。分析下面这次失败，只输出中文诊断结论，不要输出 YAML、不要输出 JSON、不要试图修改任何文件。',
    IRON_RULES,
    `功能点 ${feature.code} ${feature.title}`,
    `判定依据：${feature.criteria}`,
    `数据前提：${feature.precondition}`,
    feature.notes ? `功能备注：${feature.notes}` : '',
    buildFailureContext({ run, flowPath, flowRoot }),
    buildDiagnosisConversation(history, hint),
    [
      '按这个结构回答，简明扼要：',
      '1. 直接原因：哪一步失败、断言期望什么、实际 UI 是什么',
      '2. 归类：脚本问题 / App 真实缺陷 / 环境或时序问题（明确选一个并给依据）',
      '3. 建议改法：如果是脚本问题，指出该改哪个选择器或断言（说清用 childOf/containsChild 绑定，不要用 rightOf/below 定位）',
      '4. 存疑点：需要人工到设备上确认的地方',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');

  // 诊断读的是 Maestro 脚本与 run 日志，都在控制台侧
  const text = await runClaude({ prompt, cwd: flowRoot, bin, onData, registerChild });
  return { text, prompt };
}
