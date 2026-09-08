import fs from 'node:fs';
import path from 'node:path';
import { CHAPTER_TITLES, STATUS } from './constants.js';

const MD_SECTION3_START = '## 三、功能点清单';

/**
 * 从 SQLite 导出功能点清单到 md + 进度 html。
 * @param {{
 *   store: ReturnType<import('./store.js').createStore>,
 *   repoRoot: string,
 * }} opts
 */
export function exportSnapshot({ store, repoRoot }) {
  writeMarkdown(store, repoRoot);
  writeHtml(store, repoRoot);
}

/**
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {string} repoRoot
 */
function writeMarkdown(store, repoRoot) {
  const mdPath = path.join(repoRoot, 'TESTING_DEVICE_REGRESSION.md');
  const section3 = buildMarkdownSection3(store);
  const section4 = buildMarkdownSection4(store);

  let existing = '';
  try {
    existing = fs.readFileSync(mdPath, 'utf8');
  } catch {
    existing = '';
  }

  let next;
  if (existing.includes(MD_SECTION3_START)) {
    next = replaceMarkdownSection3(existing, section3);
  } else {
    next = buildShortMarkdown(section3, section4);
  }

  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, next, 'utf8');
}

/**
 * @param {string} existing
 * @param {string} section3Body 含标题的第三节全文（末尾无多余 ---）
 */
function replaceMarkdownSection3(existing, section3Body) {
  const start = existing.indexOf(MD_SECTION3_START);
  if (start < 0) return existing;

  const afterStart = existing.slice(start + MD_SECTION3_START.length);
  // 下一节以 --- 或 ## 四、 为界
  const dashIdx = afterStart.search(/\n---\s*\n/);
  const fourIdx = afterStart.search(/\n## 四、/);
  let endRel = -1;
  if (dashIdx >= 0 && fourIdx >= 0) endRel = Math.min(dashIdx, fourIdx);
  else if (dashIdx >= 0) endRel = dashIdx;
  else if (fourIdx >= 0) endRel = fourIdx;

  if (endRel < 0) {
    return existing.slice(0, start) + section3Body.trimEnd() + '\n';
  }

  const endAbs = start + MD_SECTION3_START.length + endRel;
  return (
    existing.slice(0, start) +
    section3Body.trimEnd() +
    '\n' +
    existing.slice(endAbs)
  );
}

/**
 * @param {ReturnType<import('./store.js').createStore>} store
 */
function buildMarkdownSection3(store) {
  const features = store.listFeatures();
  const byModule = groupByModule(features);
  const lines = [
    MD_SECTION3_START,
    '',
    '按**模块**再按**数据前提**分章。状态来自回归控制台 SQLite 当前值。',
    '',
  ];

  for (const moduleId of [...byModule.keys()].sort()) {
    const moduleFeatures = byModule.get(moduleId);
    lines.push(`### 模块 \`${moduleId}\``);
    lines.push('');
    const byChapter = groupByChapter(moduleFeatures);
    for (const chapter of [...byChapter.keys()].sort((a, b) => a - b)) {
      const rows = byChapter.get(chapter);
      const title =
        CHAPTER_TITLES[moduleId]?.[chapter] ?? `第 ${chapter} 章`;
      const pre = rows[0]?.precondition ? `（${rows[0].precondition}）` : '';
      lines.push(`#### 第 ${chapter} 章　${title}${pre}`);
      lines.push('');
      lines.push('| # | 功能点 | 判定依据 | 状态 |');
      lines.push('|---|---|---|---|');
      for (const f of rows) {
        lines.push(
          `| ${f.code} | ${escMdCell(f.title)} | ${escMdCell(f.criteria)} | ${escMdCell(f.status)} |`,
        );
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * @param {ReturnType<import('./store.js').createStore>} store
 */
function buildMarkdownSection4(store) {
  const flows = aggregateFlows(store);
  const lines = [
    '## 四、执行流',
    '',
    '### 入口 flow（可单独跑）',
    '',
    '| 文件 | 覆盖功能点 | 状态 |',
    '|---|---|---|',
  ];
  for (const row of flows) {
    lines.push(
      `| \`${row.path}\` | ${row.codes.join(' / ')} | ${escMdCell(row.statusLabel)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {string} section3
 * @param {string} section4
 */
function buildShortMarkdown(section3, section4) {
  return [
    '# 真机回归（Maestro）',
    '',
    '## 一、文档怎么读',
    '',
    '| 概念 | 含义 | 在哪 |',
    '|---|---|---|',
    '| **功能点** | 被测的产品行为 | 第三节 |',
    '| **执行流（flow）** | 可单独 `maestro test` 的入口脚本 | 第四节 |',
    '',
    '---',
    '',
    section3.trimEnd(),
    '',
    '---',
    '',
    section4.trimEnd(),
    '',
  ].join('\n');
}

/**
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {string} repoRoot
 */
function writeHtml(store, repoRoot) {
  const htmlPath = path.join(repoRoot, 'docs/testing/device-regression-plan.html');
  const body = buildGeneratedBody(store);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });

  let existing = '';
  try {
    existing = fs.readFileSync(htmlPath, 'utf8');
  } catch {
    existing = '';
  }

  if (existing.includes('id="generated-body"')) {
    const next = replaceGeneratedBody(existing, body);
    fs.writeFileSync(htmlPath, next, 'utf8');
    return;
  }

  if (existing.includes('<div class="cards">')) {
    // 首次：用 generated-body 包住 cards～各章 stage（下一步之前）
    const wrapped = wrapExistingHtml(existing, body);
    fs.writeFileSync(htmlPath, wrapped, 'utf8');
    return;
  }

  fs.writeFileSync(htmlPath, buildFullHtml(body, store), 'utf8');
}

/**
 * 按 div 嵌套深度替换 id=generated-body 的整块内容（含开闭标签）。
 * @param {string} html
 * @param {string} inner
 */
function replaceGeneratedBody(html, inner) {
  const openTag = '<div id="generated-body">';
  const start = html.indexOf(openTag);
  if (start < 0) return html;
  let i = start + openTag.length;
  let depth = 1;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) {
        return (
          html.slice(0, start) +
          `${openTag}\n${inner}\n  </div>` +
          html.slice(nextClose + '</div>'.length)
        );
      }
      i = nextClose + '</div>'.length;
    }
  }
  return html;
}

/**
 * @param {string} existing
 * @param {string} body
 */
function wrapExistingHtml(existing, body) {
  const cardsStart = existing.indexOf('<div class="cards">');
  if (cardsStart < 0) return existing;

  const nextH2 = existing.indexOf('<h2><span class="n">02</span>', cardsStart);
  const foot = existing.indexOf('<div class="foot">', cardsStart);
  const end =
    nextH2 >= 0 ? nextH2 : foot >= 0 ? foot : existing.indexOf('</div>\n</body>');

  if (end < 0) {
    return (
      existing.slice(0, cardsStart) +
      `<div id="generated-body">\n${body}\n  </div>\n` +
      existing.slice(cardsStart)
    );
  }

  return (
    existing.slice(0, cardsStart) +
    `<div id="generated-body">\n${body}\n  </div>\n\n  ` +
    existing.slice(end)
  );
}

/**
 * @param {ReturnType<import('./store.js').createStore>} store
 */
function buildGeneratedBody(store) {
  const features = store.listFeatures();
  const total = features.length;
  const passed = features.filter((f) => f.status === STATUS.PASSED).length;
  const byChapter = groupByChapter(features);
  const completedChapters = [...byChapter.entries()].filter(([, rows]) =>
    rows.every((r) => r.status === STATUS.PASSED || r.status === STATUS.MANUAL),
  ).length;
  const chapterCount = byChapter.size;
  const flowCount = aggregateFlows(store).length;
  const stuck = features.find(
    (f) =>
      f.status !== STATUS.PASSED &&
      f.status !== STATUS.MANUAL &&
      f.status !== STATUS.FALSE_GREEN,
  );

  const lines = [];
  lines.push('    <div class="cards">');
  lines.push(
    `      <div class="card"><div class="k">已通过功能点</div><div class="v">${passed} <small>/ ${total}</small></div></div>`,
  );
  lines.push(
    `      <div class="card"><div class="k">已跑通 flow</div><div class="v">${flowCount} <small>个入口</small></div></div>`,
  );
  lines.push(
    `      <div class="card"><div class="k">已完成章节</div><div class="v">${completedChapters} <small>/ ${chapterCount}</small></div></div>`,
  );
  const stuckLabel = stuck
    ? escHtml(stuck.code + ' · ' + stuck.status)
    : '—';
  lines.push(
    `      <div class="card now"><div class="k">当前卡在</div><div class="v" style="color:var(--hand)">${stuckLabel}</div></div>`,
  );
  lines.push('    </div>');
  lines.push('');
  lines.push('  <h2><span class="n">01</span>各章进度（按数据前提分层）</h2>');
  lines.push('');

  for (const chapter of [...byChapter.keys()].sort((a, b) => a - b)) {
    const rows = byChapter.get(chapter);
    const title =
      CHAPTER_TITLES[rows[0]?.module || 'todo']?.[chapter] ??
      `第 ${chapter} 章`;
    const chapPassed = rows.filter((r) => r.status === STATUS.PASSED).length;
    const pct =
      rows.length === 0 ? 0 : Math.round((chapPassed / rows.length) * 100);
    const pre = rows[0]?.precondition
      ? escHtml(rows[0].precondition)
      : '前提：—';

    lines.push('  <div class="stage">');
    lines.push('    <div class="stage-hd">');
    lines.push(`      <span class="t">第 ${chapter} 章 · ${escHtml(title)}</span>`);
    lines.push(`      <span class="pre">${pre}</span>`);
    lines.push(
      `      <span class="bar"><i style="width:${pct}%"></i></span><span class="cnt">${chapPassed}/${rows.length}</span>`,
    );
    lines.push('    </div>');
    lines.push('    <table>');
    lines.push(
      '      <tr><th class="id">#</th><th class="fn">功能点</th><th class="jd">判定依据</th><th class="st">状态</th></tr>',
    );
    for (const f of rows) {
      lines.push(
        `      <tr><td class="id">${escHtml(f.code)}</td><td class="fn">${escHtml(f.title)}</td><td class="jd">${formatCriteriaHtml(f.criteria)}</td><td class="st"><span class="pill ${pillClass(f.status)}">${escHtml(f.status)}</span></td></tr>`,
      );
    }
    lines.push('    </table>');
    lines.push('  </div>');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * @param {string} body
 * @param {ReturnType<import('./store.js').createStore>} store
 */
function buildFullHtml(body, store) {
  const features = store.listFeatures();
  const total = features.length;
  const passed = features.filter((f) => f.status === STATUS.PASSED).length;
  const pending = features.filter((f) => f.status === STATUS.PENDING_WRITE).length;
  const manual = features.filter((f) => f.status === STATUS.MANUAL).length;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Todo 真机回归自动化 · 进度与计划</title>
<style>
  :root{
    --bg:#0f1115; --panel:#171a21; --panel2:#1e222b; --line:#2a2f3a;
    --txt:#e7e9ee; --dim:#9aa3b2; --faint:#6b7382;
    --ok:#3fb950; --ok-bg:rgba(63,185,80,.12);
    --wait:#d29922; --wait-bg:rgba(210,153,34,.12);
    --warn:#f85149; --warn-bg:rgba(248,81,73,.12);
    --hand:#58a6ff; --hand-bg:rgba(88,166,255,.12);
  }
  *{box-sizing:border-box}
  body{
    margin:0; padding:32px 24px 64px;
    background:var(--bg); color:var(--txt);
    font:15px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  }
  .wrap{max-width:1080px;margin:0 auto}
  h1{font-size:26px;margin:0 0 6px;letter-spacing:.3px}
  .sub{color:var(--dim);font-size:13.5px;margin-bottom:28px}
  .sub code{background:var(--panel2);padding:1px 6px;border-radius:4px;font-size:12.5px}
  h2{font-size:17px;margin:36px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  h2 .n{color:var(--faint);margin-right:8px;font-variant-numeric:tabular-nums}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:8px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
  .card .k{color:var(--dim);font-size:12.5px;margin-bottom:6px}
  .card .v{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
  .card .v small{font-size:14px;color:var(--faint);font-weight:400}
  .card.now .v{font-size:17px;font-weight:600;padding-top:5px}
  .stage{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-bottom:12px;overflow:hidden}
  .stage-hd{display:flex;align-items:center;gap:12px;padding:13px 18px;background:var(--panel2)}
  .stage-hd .t{font-weight:600;font-size:14.5px}
  .stage-hd .pre{color:var(--dim);font-size:12.5px;flex:1}
  .bar{width:130px;height:6px;background:#2a2f3a;border-radius:99px;overflow:hidden;flex:none}
  .bar i{display:block;height:100%;background:var(--ok);border-radius:99px}
  .cnt{color:var(--dim);font-size:12.5px;font-variant-numeric:tabular-nums;flex:none;width:44px;text-align:right}
  table{width:100%;border-collapse:collapse}
  td,th{padding:9px 18px;text-align:left;border-top:1px solid var(--line);vertical-align:top}
  th{color:var(--faint);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.6px}
  td.id{color:var(--faint);font-variant-numeric:tabular-nums;width:52px;white-space:nowrap}
  td.fn{width:30%}
  td.jd{color:var(--dim);font-size:13.5px}
  td.st{width:104px;white-space:nowrap}
  .pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:500;white-space:nowrap}
  .p-ok{color:var(--ok);background:var(--ok-bg)}
  .p-wait{color:var(--wait);background:var(--wait-bg)}
  .p-warn{color:var(--warn);background:var(--warn-bg)}
  .p-hand{color:var(--hand);background:var(--hand-bg)}
  .foot{color:var(--faint);font-size:12.5px;margin-top:32px;text-align:center}
  @media (max-width:860px){.cards{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<div class="wrap">
  <h1>Todo 真机回归自动化 · 进度与计划</h1>
  <div class="sub">由 regression-console exporter 生成 ｜ 详见 <code>TESTING_DEVICE_REGRESSION.md</code></div>
  <div id="generated-body">
${body}
  </div>
  <div class="foot">功能点 ${total} 条 ｜ 已通过 ${passed} ｜ 待写 ${pending} ｜ 留手测 ${manual}</div>
</div>
</body>
</html>
`;
}

/**
 * @param {object[]} features
 * @returns {Map<number, object[]>}
 */
function groupByChapter(features) {
  /** @type {Map<number, object[]>} */
  const map = new Map();
  for (const f of features) {
    const list = map.get(f.chapter);
    if (list) list.push(f);
    else map.set(f.chapter, [f]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true }));
  }
  return map;
}

function groupByModule(features) {
  /** @type {Map<string, object[]>} */
  const map = new Map();
  for (const f of features) {
    const m = f.module || 'todo';
    const list = map.get(m);
    if (list) list.push(f);
    else map.set(m, [f]);
  }
  return map;
}

/**
 * 按 path 聚合 kind=flow；codes 去重排序。
 * @param {ReturnType<import('./store.js').createStore>} store
 */
function aggregateFlows(store) {
  /** @type {Map<string, { path: string, codes: string[], statuses: string[] }>} */
  const byPath = new Map();
  for (const f of store.listFeatures()) {
    for (const flow of store.listFlows(f.code, f.module)) {
      if (flow.kind !== 'flow') continue;
      let entry = byPath.get(flow.path);
      if (!entry) {
        entry = { path: flow.path, codes: [], statuses: [] };
        byPath.set(flow.path, entry);
      }
      const label = `${f.module || 'todo'}:${f.code}`;
      if (!entry.codes.includes(label)) {
        entry.codes.push(label);
        entry.statuses.push(f.status);
      }
    }
  }
  return [...byPath.values()]
    .map((e) => {
      e.codes.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      const allPassed = e.statuses.every((s) => s === STATUS.PASSED);
      const anyFailed = e.statuses.some((s) => s === STATUS.FAILED);
      let statusLabel = e.statuses[0] ?? '';
      if (allPassed) statusLabel = STATUS.PASSED;
      else if (anyFailed) statusLabel = STATUS.FAILED;
      return { ...e, statusLabel };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** @param {string} s */
function escMdCell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** @param {string} s */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {string} criteria */
function formatCriteriaHtml(criteria) {
  // 简单把 `code` 转成 <code>，其余转义
  const parts = String(criteria ?? '').split(/(`[^`]+`)/g);
  return parts
    .map((p) => {
      if (p.startsWith('`') && p.endsWith('`')) {
        return `<code>${escHtml(p.slice(1, -1))}</code>`;
      }
      return escHtml(p);
    })
    .join('');
}

/** @param {string} status */
function pillClass(status) {
  if (status === STATUS.PASSED) return 'p-ok';
  if (status === STATUS.MANUAL) return 'p-hand';
  if (status === STATUS.FAILED || status === STATUS.FALSE_GREEN) return 'p-warn';
  return 'p-wait';
}
