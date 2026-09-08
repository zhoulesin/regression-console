#!/usr/bin/env node
/**
 * 回归覆盖状态 CLI
 *
 * 数据源：被测仓的 regression.manifest.json（清单）+ 本仓 SQLite（执行状态）。
 *
 * 用法：
 *   node src/cli/status.js                # 全部模块
 *   node src/cli/status.js todo           # 只看 todo 模块
 *   node src/cli/status.js todo --json    # JSON 输出（供 skill 消费）
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { appRoot, dbFile, manifestPath } from '../paths.js';
import { readManifestFile } from '../manifest.js';

const moduleFilter = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : '';
const jsonMode = process.argv.includes('--json');

if (!appRoot) {
  console.error('未配置 appRoot（regression.config.json），无法读取清单。');
  process.exit(1);
}

let manifest;
try {
  manifest = readManifestFile(appRoot, manifestPath);
} catch (e) {
  console.error(`读取 manifest 失败：${String(e.message || e)}`);
  process.exit(1);
}

// 执行状态来自控制台库（清单不持有状态）
let statusByCode = new Map();
let notesByCode = new Map();
if (fs.existsSync(dbFile)) {
  const db = new Database(dbFile, { readonly: true });
  for (const row of db
    .prepare('SELECT module, code, status, notes FROM feature')
    .all()) {
    statusByCode.set(`${row.module}|${row.code}`, row.status);
    notesByCode.set(`${row.module}|${row.code}`, row.notes);
  }
}

const modules = {};
for (const f of manifest.features) {
  if (moduleFilter && f.module !== moduleFilter) continue;
  if (!modules[f.module]) modules[f.module] = [];
  modules[f.module].push(f);
}

if (jsonMode) {
  const output = {};
  for (const [mod, features] of Object.entries(modules)) {
    output[mod] = {
      features: features.map((f) => ({
        code: f.code,
        chapter: f.chapter,
        title: f.title,
        status: statusByCode.get(`${f.module}|${f.code}`) ?? '待执行',
        manual: f.manual === true,
        hasScript: Boolean(f.flow),
        scriptPath: f.flow || null,
        scriptExists: f.flow
          ? fs.existsSync(path.join(appRoot, f.flow))
          : false,
      })),
    };
  }
  console.log(JSON.stringify(output, null, 2));
} else {
  for (const [mod, features] of Object.entries(modules)) {
    console.log(`\n📦 ${mod} 模块`);
    console.log(`   功能点: ${features.length} 条`);
    console.log(
      `   有脚本: ${features.filter((f) => f.flow).length} 条（manual ${features.filter((f) => f.manual).length}）\n`,
    );

    const byChapter = {};
    for (const f of features) {
      if (!byChapter[f.chapter]) byChapter[f.chapter] = [];
      byChapter[f.chapter].push(f);
    }

    for (const [ch, items] of Object.entries(byChapter).sort(
      (a, b) => a[0] - b[0],
    )) {
      console.log(`  第 ${ch} 章:`);
      for (const f of items) {
        const status = statusByCode.get(`${f.module}|${f.code}`) ?? '待执行';
        const statusIcon =
          status === '通过' ? '✅' :
          status === '留手测' ? '🤚' :
          status === '假绿' ? '⚠️' :
          status === '待写' ? '📝' :
          status === '待执行' ? '⬜' :
          status === '运行中' ? '🔄' :
          status === '失败' ? '❌' :
          '❓';
        const scriptIcon = f.manual ? '🤚' : f.flow ? '📜' : '  ';
        console.log(`    ${statusIcon} ${scriptIcon} ${f.code} ${f.title}`);
      }
    }
  }
  console.log();
}
