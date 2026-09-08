import { spawn as defaultSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArtifactDir, parseFailedStep } from './failureContext.js';

/**
 * IDE/GUI 启动的 Node 不一定继承 shell PATH。优先支持显式覆盖，再查 PATH，
 * 最后兼容 Maestro 官方默认安装目录。
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   homeDir?: string,
 *   existsSync?: (candidate: string) => boolean,
 * }} [opts]
 * @returns {string}
 */
export function resolveMaestroBin({
  env = process.env,
  homeDir = os.homedir(),
  existsSync = fs.existsSync,
} = {}) {
  const explicit = env.MAESTRO_BIN?.trim();
  if (explicit) return explicit;

  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'maestro');
    if (existsSync(candidate)) return candidate;
  }

  const standard = path.join(homeDir, '.maestro', 'bin', 'maestro');
  return existsSync(standard) ? standard : 'maestro';
}

/**
 * 读 ~/.maestro/tests 下按 mtime 最新的子目录；没有则 ''。
 * @returns {string}
 */
export function findLatestArtifactDir() {
  const root = path.join(os.homedir(), '.maestro', 'tests');
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return '';
  }
  let best = '';
  let bestMtime = -1;
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const full = path.join(root, ent.name);
    let mtime;
    try {
      mtime = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = full;
    }
  }
  return best;
}

/**
 * 单槽 Maestro runner：同一时刻只允许一个 child。
 * @param {{
 *   spawnFn?: typeof defaultSpawn,
 *   store: ReturnType<import('./store.js').createStore>,
 *   repoRoot: string,
 *   maestroBin?: string,
 *   exportFn?: () => void,
 * }} opts
 */
export function createRunner({
  spawnFn = defaultSpawn,
  store,
  repoRoot,
  maestroBin = 'maestro',
  exportFn,
}) {
  /** @type {import('node:child_process').ChildProcess | null} */
  let activeChild = null;
  /** @type {Map<number, string[]>} */
  const logsByRun = new Map();
  /** @type {Map<number, Set<(chunk: string) => void>>} */
  const subscribers = new Map();

  function appendLog(runId, chunk) {
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    let buf = logsByRun.get(runId);
    if (!buf) {
      buf = [];
      logsByRun.set(runId, buf);
    }
    buf.push(text);
    const subs = subscribers.get(runId);
    if (subs) {
      for (const fn of subs) fn(text);
    }
  }

  /**
   * @param {string} featureCode
   * @param {string} [module]
   */
  function start(featureCode, module = 'todo') {
    // startRun 在有活跃 run 时抛 409，保证 spawn 前失败
    // 旧数据可能没有轮次；首次直接执行时补一轮，后续 rerun 复用当前轮。
    const attempt =
      store.getCurrentAttempt(featureCode, module) ??
      store.createAttempt(featureCode, module);
    const run = store.startRun(featureCode, module, attempt.id);
    const flows = store.listFlows(featureCode, module);
    const flow = flows.find((f) => f.kind === 'flow');
    if (!flow) {
      throw new Error('必须有 kind=flow 的行');
    }

    logsByRun.set(run.id, []);
    let log = '';
    const onData = (d) => {
      const s = typeof d === 'string' ? d : String(d);
      log += s;
      appendLog(run.id, s);
    };
    let settled = false;
    /** @type {import('node:child_process').ChildProcess | null} */
    let child = null;
    const settle = (code, extraLog = '') => {
      if (settled) return;
      settled = true;
      if (extraLog) onData(extraLog);
      const exit_code = code === 0 ? 0 : code == null ? 1 : code;
      // 优先用 maestro 自己打印的产物路径；解析不到才退回按 mtime 猜
      const artifact_dir =
        exit_code !== 0
          ? parseArtifactDir(log) || findLatestArtifactDir() || null
          : null;
      const failed_step = exit_code !== 0 ? parseFailedStep(log) : null;
      try {
        store.finishRun(run.id, {
          exit_code,
          failed_step,
          artifact_dir,
          log_excerpt: log.slice(-16000),
        });
        // finishRun 已更新 feature.status；再刷 md/html（失败也不挡槽位释放）
        if (typeof exportFn === 'function') {
          try {
            exportFn();
          } catch {
            /* 导出失败不影响 run 收尾 */
          }
        }
      } finally {
        if (activeChild === child) activeChild = null;
      }
    };

    try {
      child = spawnFn(maestroBin, ['test', flow.path], { cwd: repoRoot });
      activeChild = child;
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (error) => {
        settle(127, `[runner] Maestro 启动失败：${error.message}\n`);
      });
      child.on('close', (code) => settle(code));
    } catch (error) {
      settle(127, `[runner] Maestro 启动失败：${error.message}\n`);
    }

    return run;
  }

  function abort() {
    if (activeChild) {
      activeChild.kill('SIGTERM');
    }
  }

  /**
   * @param {number} runId
   * @param {(chunk: string) => void} fn
   * @returns {() => void} unsubscribe
   */
  function subscribe(runId, fn) {
    const id = Number(runId);
    let set = subscribers.get(id);
    if (!set) {
      set = new Set();
      subscribers.set(id, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  /**
   * @param {number} runId
   * @returns {string[]}
   */
  function getLogs(runId) {
    return logsByRun.get(Number(runId)) ?? [];
  }

  return { start, abort, subscribe, getLogs };
}
