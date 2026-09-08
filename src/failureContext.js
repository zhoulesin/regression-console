import fs from 'node:fs';
import path from 'node:path';

/**
 * 从 maestro stdout 里取失败步骤名。
 * 实际输出形如 `  Assert that "X", id: ... is visible... FAILED`（可能带缩进）。
 * @param {string} log
 * @returns {string | null}
 */
export function parseFailedStep(log) {
  if (!log) return null;
  let hit = null;
  for (const line of String(log).split('\n')) {
    const m = line.match(/^\s*(.+?)\.\.\.\s*FAILED\s*$/);
    if (m) hit = m[1].trim();
  }
  return hit;
}

/**
 * 从 maestro stdout 里取产物目录。
 * 比按 mtime 猜最新目录可靠：并发或手动跑过 maestro 时 mtime 会指错。
 * @param {string} log
 * @returns {string | null}
 */
export function parseArtifactDir(log) {
  if (!log) return null;
  const text = String(log);

  const inline = text.match(/Debug output path:\s*(\S+)/);
  if (inline) return inline[1];

  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.includes('==== Debug output'));
  if (idx >= 0) {
    for (let i = idx + 1; i < Math.min(idx + 5, lines.length); i += 1) {
      const candidate = lines[i].trim();
      if (candidate) return candidate;
    }
  }
  return null;
}

/**
 * 把 hierarchy 树压成 `id | class | text` 行，只保留有 id 或有文字的节点。
 * 原始 JSON 有 24K+，直接塞 prompt 既慢又容易淹掉重点。
 * @param {any} node
 * @param {string[]} out
 */
function flattenHierarchy(node, out) {
  if (!node || typeof node !== 'object') return;
  const attrs = node.attributes ?? {};
  const rid = String(attrs['resource-id'] ?? '');
  const text = String(attrs.text ?? '');
  const hint = String(attrs.hintText ?? '');
  if (rid || text || hint) {
    const shortId = rid ? rid.split('/').pop() : '-';
    const cls = String(attrs.class ?? '').split('.').pop() || '-';
    const parts = [`id=${shortId}`, `class=${cls}`];
    if (text) parts.push(`text="${text}"`);
    if (hint) parts.push(`hint="${hint}"`);
    out.push(parts.join(' '));
  }
  for (const child of node.children ?? []) {
    flattenHierarchy(child, out);
  }
}

const MAX_HIERARCHY_LINES = 120;
const MAX_LOG_TAIL_CHARS = 6000;
const MAX_HINT_CHARS = 2000;
const MAX_DIAGNOSIS_CHARS = 4000;

/**
 * 组装同一次失败的诊断对话。调用方只传最近 5 轮，避免 prompt 无限增长。
 *
 * @param {{ user_hint?: string|null, response?: string|null }[]} turns
 * @param {string} currentHint
 * @returns {string}
 */
export function buildDiagnosisConversation(turns, currentHint = '') {
  const lines = [];
  for (const [index, turn] of (turns ?? []).entries()) {
    const round = index + 1;
    if (turn.user_hint) {
      lines.push(
        `第 ${round} 轮用户：${String(turn.user_hint).slice(0, MAX_HINT_CHARS)}`,
      );
    }
    if (turn.response) {
      lines.push(
        `第 ${round} 轮 AI：${String(turn.response).slice(0, MAX_DIAGNOSIS_CHARS)}`,
      );
    }
  }
  if (currentHint) {
    lines.push(`本轮用户补充：${String(currentHint).slice(0, MAX_HINT_CHARS)}`);
  }
  return lines.length
    ? `--- 本次失败的诊断对话 ---\n${lines.join('\n\n')}`
    : '';
}

/**
 * 找产物目录里失败那一步的 hierarchy JSON。
 * 命名形如 `step-048-assertCondition-E2E_Todo.json`，按序号取最大的那个。
 * @param {string} artifactDir
 * @returns {{ file: string, lines: string[] } | null}
 */
function readFailureHierarchy(artifactDir) {
  let flowDirs;
  try {
    flowDirs = fs
      .readdirSync(artifactDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(artifactDir, e.name));
  } catch {
    return null;
  }

  for (const dir of flowDirs) {
    const hDir = path.join(dir, 'screen-hierarchy');
    let files;
    try {
      files = fs.readdirSync(hDir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    if (files.length === 0) continue;

    // 失败时 maestro 只 dump 失败那一步；有多个就取序号最大的
    files.sort();
    const target = files[files.length - 1];
    try {
      const raw = fs.readFileSync(path.join(hDir, target), 'utf8');
      const out = [];
      flattenHierarchy(JSON.parse(raw), out);
      return { file: target, lines: out.slice(0, MAX_HIERARCHY_LINES) };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 组装失败诊断上下文：失败步骤 + stdout 尾部 + 失败瞬间 UI 树 + flow 源码。
 * 全部由 Node 读好塞进 prompt，不让 Claude 自己翻目录（产物在仓库外）。
 *
 * @param {{
 *   run: { failed_step?: string|null, artifact_dir?: string|null, log_excerpt?: string|null, exit_code?: number|null },
 *   flowPath?: string | null,
 *   flowRoot?: string | null,
 * }} opts
 * @returns {string}
 */
export function buildFailureContext({ run, flowPath, flowRoot }) {
  const sections = [];
  const log = run?.log_excerpt ?? '';
  const failedStep = run?.failed_step || parseFailedStep(log);
  const artifactDir = run?.artifact_dir || parseArtifactDir(log);

  sections.push(
    [
      `exit_code：${run?.exit_code ?? '?'}`,
      `失败步骤：${failedStep ?? '（未解析到）'}`,
      `产物目录：${artifactDir ?? '（无）'}`,
    ].join('\n'),
  );

  if (flowPath && flowRoot) {
    const abs = path.join(flowRoot, ...flowPath.split('/'));
    try {
      sections.push(`--- flow 源码 ${flowPath} ---\n${fs.readFileSync(abs, 'utf8')}`);
    } catch {
      sections.push(`--- flow 源码 ${flowPath} ---\n（读取失败）`);
    }
  }

  if (log) {
    sections.push(`--- maestro 输出尾部 ---\n${log.slice(-MAX_LOG_TAIL_CHARS)}`);
  }

  if (artifactDir) {
    const hierarchy = readFailureHierarchy(artifactDir);
    if (hierarchy) {
      sections.push(
        `--- 失败瞬间 UI 层级（${hierarchy.file}，已压缩） ---\n${hierarchy.lines.join('\n')}`,
      );
    } else {
      sections.push('--- 失败瞬间 UI 层级 ---\n（产物里没找到 screen-hierarchy）');
    }
  }

  return sections.join('\n\n');
}
