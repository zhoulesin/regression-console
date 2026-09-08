import fs from 'node:fs';
import path from 'node:path';

const ERR = (msg) => {
  throw new Error(`400 ${msg}`);
};

/**
 * @param {string} repoRoot
 * @param {string} relativePath
 * @returns {string} normalized relative POSIX path
 */
export function assertMaestroYamlPath(repoRoot, relativePath) {
  if (
    relativePath.includes('\0') ||
    relativePath.startsWith('/') ||
    /^[a-zA-Z]:[/\\]/.test(relativePath) ||
    path.isAbsolute(relativePath)
  ) {
    ERR('invalid path');
  }

  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) {
    ERR('path traversal');
  }

  const resolved = path.resolve(repoRoot, normalized);
  const rel = path.relative(repoRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    ERR('path escapes repo');
  }

  const posixRel = rel.split(path.sep).join('/');
  if (!posixRel.startsWith('maestro/')) {
    ERR('path must be under maestro/');
  }

  const ext = path.posix.extname(posixRel).toLowerCase();
  if (ext !== '.yaml' && ext !== '.yml') {
    ERR('extension must be .yaml or .yml');
  }

  return posixRel;
}

/**
 * @param {string} repoRoot
 * @param {{ path: string, content: string }[]} files
 * @returns {string}
 */
export function diffFiles(repoRoot, files) {
  const chunks = [];

  for (const file of files) {
    const rel = assertMaestroYamlPath(repoRoot, file.path);
    const abs = path.join(repoRoot, ...rel.split('/'));
    let oldContent = '';
    try {
      oldContent = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const oldLines = oldContent.split('\n');
    if (oldLines.at(-1) === '') oldLines.pop();
    const newLines = file.content.split('\n');
    if (newLines.at(-1) === '') newLines.pop();

    chunks.push(`--- a/${rel}`);
    chunks.push(`+++ b/${rel}`);

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      if (oldLine !== undefined && oldLine !== newLine) {
        chunks.push(`-${oldLine}`);
      }
      if (newLine !== undefined && oldLine !== newLine) {
        chunks.push(`+${newLine}`);
      }
    }
  }

  return chunks.join('\n');
}

/**
 * @param {string} repoRoot
 * @param {{ path: string, content: string }[]} files
 * @returns {{ applied: string[] }}
 */
export function applyFiles(repoRoot, files) {
  const validated = files.map((file) => ({
    rel: assertMaestroYamlPath(repoRoot, file.path),
    content: file.content,
  }));

  const applied = [];
  for (const { rel, content } of validated) {
    const abs = path.join(repoRoot, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });

    if (fs.existsSync(abs)) {
      fs.copyFileSync(abs, abs + '.bak');
    }

    fs.writeFileSync(abs, content, 'utf8');
    applied.push(rel);
  }

  return { applied };
}
