const TOKEN_KEY = 'rc_token';
const MODULE_KEY = 'rc_module';

/** 页面 load：URL ?token= 优先写入 localStorage */
export function bootstrapToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl);
  }
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function getSavedModule(fallback = 'todo') {
  return localStorage.getItem(MODULE_KEY) || fallback;
}

export function saveModule(id) {
  localStorage.setItem(MODULE_KEY, id);
}

/** 给 path 追加 ?module= 或 &module= */
export function withModule(path, moduleId) {
  if (!moduleId) return path;
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}module=${encodeURIComponent(moduleId)}`;
}

/**
 * @param {string} path
 * @param {RequestInit} [opts]
 */
export async function api(path, opts = {}) {
  const token = getToken();
  const headers = new Headers(opts.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opts.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error || res.statusText || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export function streamUrl(runId) {
  const token = encodeURIComponent(getToken());
  return `/api/runs/${runId}/stream?token=${token}`;
}

export function analyzeStreamUrl() {
  const token = encodeURIComponent(getToken());
  return `/api/analyze/stream?token=${token}`;
}
