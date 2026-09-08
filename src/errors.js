/**
 * 带 HTTP 语义的应用错误。
 *
 * `message` 形如 `422: xxx`，因为现有 `statusFromError` 靠消息前缀推断状态码；
 * `code` 供前端区分具体原因（如 FEATURE_MANUAL 与 FLOW_MISSING 文案不同）。
 */
export class AppError extends Error {
  /**
   * @param {number} httpStatus
   * @param {string} code
   * @param {string} message
   */
  constructor(httpStatus, code, message) {
    super(`${httpStatus}: ${message}`);
    this.name = 'AppError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}
