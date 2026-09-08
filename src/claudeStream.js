/**
 * 解析 `claude --output-format stream-json` 的 NDJSON 流。
 *
 * 用流式格式而不是默认 text，是因为 `claude -p` 的 text 输出会缓冲到进程结束才吐，
 * 控制台面板在此期间完全空白，看起来像卡死。
 */
export function createStreamParser() {
  let pending = '';
  /** @type {string | null} */
  let finalText = null;
  let errorMessage = '';
  let thinkingStarted = false;
  let answerStarted = false;

  /**
   * @param {any} evt
   * @param {(text: string) => void} emit
   */
  function handleEvent(evt, emit) {
    if (!evt || typeof evt !== 'object') return;

    // 最终结果：只认 type=result 的 result 字段
    if (evt.type === 'result') {
      if (evt.is_error) {
        errorMessage = String(evt.result ?? evt.subtype ?? 'claude error');
      } else if (typeof evt.result === 'string') {
        finalText = evt.result;
      }
      const ms = Number(evt.duration_ms);
      emit(`\n[claude] 完成${Number.isFinite(ms) ? `（${Math.round(ms / 1000)}s）` : ''}\n`);
      return;
    }

    if (evt.type === 'system') {
      if (evt.subtype === 'init') {
        emit(`[claude] 启动 model=${evt.model ?? '?'}\n`);
      } else if (evt.subtype === 'status' && evt.status) {
        emit(`[claude] ${evt.status}\n`);
      }
      return;
    }

    if (evt.type !== 'stream_event') return;
    const inner = evt.event;
    if (!inner || typeof inner !== 'object') return;

    if (inner.type === 'content_block_delta') {
      const delta = inner.delta ?? {};
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        if (!thinkingStarted) {
          thinkingStarted = true;
          emit('\n[claude] 思考中…\n');
        }
        emit(delta.thinking);
      } else if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        if (!answerStarted) {
          answerStarted = true;
          emit('\n\n[claude] 输出结果…\n');
        }
        emit(delta.text);
      }
      return;
    }

    if (inner.type === 'content_block_start') {
      const kind = inner.content_block?.type;
      if (kind === 'tool_use') {
        emit(`\n[claude] 调用工具 ${inner.content_block?.name ?? '?'}\n`);
      }
    }
  }

  return {
    /**
     * 吃一段 stdout，返回给面板显示的可读进度文本。
     * @param {string} chunk
     * @returns {string}
     */
    push(chunk) {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      let out = '';
      const emit = (text) => {
        out += text;
      };
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          handleEvent(JSON.parse(trimmed), emit);
        } catch {
          // 非 JSON 行（早期告警等）原样透出，便于排查
          emit(trimmed + '\n');
        }
      }
      return out;
    },

    get finalText() {
      return finalText;
    },

    get errorMessage() {
      return errorMessage;
    },
  };
}
