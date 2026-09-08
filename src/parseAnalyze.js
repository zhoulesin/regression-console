import { assertMaestroYamlPath } from './fileGate.js';

const ERR422 = (msg) => {
  throw new Error(`422 ${msg}`);
};

/**
 * @param {string} raw
 * @returns {string}
 */
function extractJsonText(raw) {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * @param {string} content
 */
function assertNotDiff(content) {
  if (content.startsWith('@@') || content.startsWith('--- ')) {
    ERR422('content must not be a unified diff');
  }
}

/**
 * @param {string} raw
 * @param {string} repoRoot
 * @returns {{ rationale: string, risks: string[], files: { path: string, content: string }[] }}
 */
export function parseAnalyzeResponse(raw, repoRoot) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(raw));
  } catch {
    ERR422('invalid JSON');
  }

  if (!isNonEmptyString(parsed.rationale)) {
    ERR422('rationale must be a non-empty string');
  }

  if (!Array.isArray(parsed.risks)) {
    ERR422('risks must be an array');
  }

  for (const risk of parsed.risks) {
    if (typeof risk !== 'string') {
      ERR422('risks must contain strings');
    }
  }

  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    ERR422('files must be a non-empty array');
  }

  const files = [];
  for (const file of parsed.files) {
    if (!file || typeof file !== 'object') {
      ERR422('each file must be an object');
    }

    if (!isNonEmptyString(file.path) || !isNonEmptyString(file.content)) {
      ERR422('each file must have non-empty path and content');
    }

    assertNotDiff(file.content);

    let normalizedPath;
    try {
      normalizedPath = assertMaestroYamlPath(repoRoot, file.path);
    } catch {
      ERR422('invalid file path');
    }

    files.push({ path: normalizedPath, content: file.content });
  }

  return {
    rationale: parsed.rationale,
    risks: parsed.risks,
    files,
  };
}
