/**
 * 全局单槽：analyze / diagnose /（日后）catalog 共用。
 * 占用只在 Claude 进程跑着的时候成立，pending 审阅不算占用。
 *
 * 旧实现只有 begin/push，第二次请求会 begin() 清空第一次的日志接着跑，
 * 并不存在 409。abort 必须释放占用；release 带票号，避免中止后
 * 旧请求的 finally 把新占用清掉。
 */
export function createAnalyzeHub() {
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;
  /** @type {string[]} */
  let logs = [];
  /** @type {Set<(chunk: string) => void>} */
  const subs = new Set();
  let busy = false;
  /** @type {string | null} */
  let kind = null;
  let ticket = 0;

  /**
   * @param {number} held
   */
  function release(held) {
    if (held !== ticket || !busy) return;
    busy = false;
    kind = null;
    child = null;
  }

  return {
    /**
     * @param {string} nextKind
     * @returns {number} 0 = 已被占用；>0 为票号，结束时交给 release
     */
    tryBegin(nextKind) {
      if (busy) return 0;
      ticket += 1;
      busy = true;
      kind = typeof nextKind === 'string' && nextKind ? nextKind : 'analyze';
      logs = [];
      child = null;
      return ticket;
    },

    release,

    /** @param {string} chunk */
    push(chunk) {
      const text = typeof chunk === 'string' ? chunk : String(chunk);
      logs.push(text);
      for (const fn of subs) fn(text);
    },

    /** @param {import('node:child_process').ChildProcess | null} c */
    setChild(c) {
      child = c;
    },

    /**
     * 杀掉 Claude 子进程并释放槽位（作废当前票号）。
     * 没有 child 时也要释放，否则中止一次后所有 AI 入口会一直 409。
     * @returns {boolean} 是否真的杀掉了进程
     */
    abort() {
      const hadChild = Boolean(child);
      if (child) {
        child.kill('SIGKILL');
        child = null;
      }
      if (busy) {
        ticket += 1;
        busy = false;
        kind = null;
      }
      return hadChild;
    },

    status() {
      return { busy, kind };
    },

    getLogs() {
      return logs.slice();
    },

    /** @param {(chunk: string) => void} fn */
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
