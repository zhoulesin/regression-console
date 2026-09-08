import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors.js';

export { AppError };

const MANIFEST_VERSION = 1;
const MODULE_ID_RE = /^[a-z0-9-]{2,20}$/;
const FEATURE_CODE_RE = /^\d+\.\d+$/;
const FLOW_EXT_RE = /\.(yaml|yml)$/i;

function invalid(detail) {
  return new AppError(422, 'MANIFEST_INVALID', detail);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {string} raw */
export function parseManifestJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw invalid('manifest 不是合法 JSON');
  }
}

/**
 * 校验并归一化 manifest。
 *
 * 清单是外部输入，闸门不能比 FileGate 更松：flow 既不能逃出 appRoot，
 * 也必须是 .yaml/.yml。manual 项（如只能手测的「数量上限」）允许没有 flow。
 *
 * @param {unknown} draft
 * @param {{ appRoot: string }} opts
 */
export function normalizeManifest(draft, { appRoot }) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw invalid('manifest 必须是对象');
  }
  if (draft.version !== MANIFEST_VERSION) {
    throw invalid(`version 必须为 ${MANIFEST_VERSION}`);
  }

  const appId = text(draft.appId);
  if (appId && !appId.includes('.')) {
    throw invalid(`appId 应为完整包名：${appId}`);
  }
  const device = text(draft.device);

  if (!Array.isArray(draft.modules) || draft.modules.length === 0) {
    throw invalid('modules 不能为空');
  }
  const moduleIds = new Set();
  const modules = draft.modules.map((m) => {
    const id = text(m?.id);
    const title = text(m?.title);
    if (!MODULE_ID_RE.test(id)) throw invalid(`模块 id 非法：${id || '(空)'}`);
    if (!title) throw invalid(`模块 ${id} 缺少 title`);
    if (moduleIds.has(id)) throw invalid(`模块 id 重复：${id}`);
    moduleIds.add(id);
    return { id, title };
  });

  if (!Array.isArray(draft.features)) {
    throw invalid('features 必须是数组');
  }

  const seen = new Set();
  const features = draft.features.map((f) => {
    if (!f || typeof f !== 'object') throw invalid('feature 必须是对象');
    const module = text(f.module);
    const code = text(f.code);
    if (!moduleIds.has(module)) throw invalid(`feature ${code} 的模块未声明：${module}`);
    if (!FEATURE_CODE_RE.test(code)) throw invalid(`feature code 非法：${code || '(空)'}`);
    if (!Number.isInteger(f.chapter) || f.chapter < 0) {
      throw invalid(`feature ${code} 的 chapter 必须是不小于 0 的整数`);
    }
    const title = text(f.title);
    const criteria = text(f.criteria);
    if (!title) throw invalid(`feature ${code} 缺少 title`);
    if (!criteria) throw invalid(`feature ${code} 缺少 criteria`);

    const key = `${module}|${code}`;
    if (seen.has(key)) throw invalid(`feature 重复：${key}`);
    seen.add(key);

    const manual = f.manual === true;
    let flow = '';
    const rawFlow = text(f.flow);
    if (rawFlow) {
      const resolved = path.resolve(appRoot, rawFlow);
      const rel = path.relative(appRoot, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw invalid(`feature ${code} 的 flow 逃出了 appRoot：${rawFlow}`);
      }
      if (!FLOW_EXT_RE.test(rel)) {
        throw invalid(`feature ${code} 的 flow 必须是 .yaml/.yml：${rawFlow}`);
      }
      flow = path.normalize(rel).split(path.sep).join('/').replace(/^\.\//, '');
    }
    // 无 flow 是合法状态：manual 表示「只能手测」，无 flow 的非 manual 项
    // 表示「脚本还没写」——sync 会把 runnable 置 0，前端按 FLOW_MISSING 提示。

    return {
      module,
      code,
      chapter: f.chapter,
      title,
      criteria,
      precondition: typeof f.precondition === 'string' ? f.precondition : '',
      chapterTitle: typeof f.chapterTitle === 'string' ? f.chapterTitle : '',
      flow,
      manual,
    };
  });

  return { appId, device, modules, features };
}

/**
 * 从被测仓读取 manifest。
 *
 * @param {string} appRoot 被测项目根
 * @param {string} [manifestPath] 相对 appRoot 的路径
 */
export function readManifestFile(appRoot, manifestPath = 'regression.manifest.json') {
  if (!appRoot) {
    throw new AppError(422, 'MANIFEST_MISSING', '未配置 appRoot，无法定位 manifest');
  }
  const file = path.resolve(appRoot, manifestPath);
  if (!fs.existsSync(file)) {
    throw new AppError(422, 'MANIFEST_MISSING', `manifest 不存在：${file}`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  return normalizeManifest(parseManifestJson(raw), { appRoot });
}
