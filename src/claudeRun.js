import { spawn } from 'node:child_process';
import { createStreamParser } from './claudeStream.js';

/** 多久没有任何输出算卡死（有输出就重置） */
export const IDLE_TIMEOUT_MS = 120_000;
/** 绝对上限，防止一直有输出却永不收敛 */
export const HARD_TIMEOUT_MS = 900_000;

/**
 * 调一次 claude，流式吐进度，resolve 最终文本。
 *
 * 用 stream-json 而不是默认 text：`claude -p` 的 text 输出会缓冲到进程结束才吐，
 * 面板在此期间完全空白，看起来像卡死。
 *
 * @param {{
 *   prompt: string,
 *   bin?: string,
 *   cwd?: string,
 *   onData?: (chunk: string) => void,
 *   registerChild?: (child: import('node:child_process').ChildProcess | null) => void,
 * }} opts
 * @returns {Promise<string>} claude 的最终文本输出
 */
export function runClaude({ prompt, bin = 'claude', cwd, onData, registerChild }) {
  // --bare 跳过 hooks / 插件 / CLAUDE.md 自动发现，去掉启动开销
  // --allowedTools Read 保证它只能读，不能自己写盘（写盘只能走 FileGate + 人工批准）
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--bare',
    '--allowedTools',
    'Read',
  ];

  // cwd 必须是 appRoot：prompt 里的候选文件清单是相对 appRoot 的路径，
  // Claude 用 Read 补洞时按自己的 cwd 解析。不设就会继承控制台目录而找不到文件。
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    registerChild?.(child);

    const parser = createStreamParser();
    let err = '';
    let settled = false;

    /** @type {NodeJS.Timeout | null} */
    let idleTimer = null;
    const hardTimer = setTimeout(() => {
      fail(`422: claude 超过 ${HARD_TIMEOUT_MS / 1000}s 仍未结束`);
    }, HARD_TIMEOUT_MS);

    function clearTimers() {
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(hardTimer);
    }

    function armIdle() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail(`422: claude ${IDLE_TIMEOUT_MS / 1000}s 无输出，已中止`);
      }, IDLE_TIMEOUT_MS);
    }

    /** @param {string} message */
    function fail(message) {
      if (settled) return;
      settled = true;
      clearTimers();
      child.kill('SIGKILL');
      registerChild?.(null);
      reject(new Error(message));
    }

    armIdle();

    child.stdout.on('data', (d) => {
      armIdle();
      const progress = parser.push(String(d));
      if (progress) onData?.(progress);
    });

    child.stderr.on('data', (d) => {
      armIdle();
      err += d;
      onData?.(String(d));
    });

    child.on('error', (e) => {
      fail('422: ' + e.message);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      registerChild?.(null);

      if (code !== 0) {
        reject(new Error('422: claude exit ' + code + ' ' + err.slice(0, 500)));
        return;
      }
      if (parser.errorMessage) {
        reject(new Error('422: ' + parser.errorMessage.slice(0, 500)));
        return;
      }
      if (parser.finalText == null) {
        reject(new Error('422: claude 未返回 result'));
        return;
      }
      resolve(parser.finalText);
    });
  });
}
