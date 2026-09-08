#!/usr/bin/env node

/**
 * 回归覆盖状态 CLI
 *
 * 用法：
 *   node src/cli/status.js                # 全部模块
 *   node src/cli/status.js todo           # 只看 todo 模块
 *   node src/cli/status.js todo --json    # JSON 输出（供 skill 消费）
 */

import fs from 'node:fs';
import path from 'node:path';
import { SEED_FEATURES, FLOW_BINDINGS } from '../seed/index.js';

const moduleFilter = process.argv[2] || '';
const jsonMode = process.argv.includes('--json');

// 收集已有 Maestro 脚本
function listMaestroScripts(dir) {
  const scripts = new Map(); // path → exists
  try {
    for (const entry of fs.readdirSync(dir, { recursive: true })) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isFile() && entry.endsWith('.yaml') && !entry.includes('/subflows/')) {
        scripts.set(full.replace(dir + '/', ''), true);
      }
    }
  } catch {}
  return scripts;
}

const regressionRoot = path.resolve(import.meta.dirname, '../..');
const maestroDir = path.join(regressionRoot, 'maestro');

// 按模块分组
const modules = {};
for (const f of SEED_FEATURES) {
  if (moduleFilter && f.module !== moduleFilter) continue;
  if (!modules[f.module]) modules[f.module] = [];
  modules[f.module].push(f);
}

// 按模块收集脚本
const moduleScripts = {};
for (const mod of Object.keys(modules)) {
  const dir = path.join(maestroDir, mod);
  moduleScripts[mod] = listMaestroScripts(dir);
}

// 按模块收集绑定
const moduleBindings = {};
for (const b of FLOW_BINDINGS) {
  if (moduleFilter && b.feature_module !== moduleFilter) continue;
  if (!moduleBindings[b.feature_module]) moduleBindings[b.feature_module] = new Set();
  moduleBindings[b.feature_module].add(b.feature_code);
}

// 子流程
const subflows = [];
try {
  for (const entry of fs.readdirSync(path.join(maestroDir, 'todo', 'subflows'))) {
    if (entry.endsWith('.yaml')) subflows.push(`maestro/todo/subflows/${entry}`);
  }
} catch {}

if (jsonMode) {
  // JSON 输出：供 skill 消费
  const output = {};
  for (const [mod, features] of Object.entries(modules)) {
    const bindings = moduleBindings[mod] || new Set();
    const scripts = moduleScripts[mod] || new Map();
    output[mod] = {
      features: features.map((f) => ({
        code: f.code,
        chapter: f.chapter,
        title: f.title,
        status: f.status,
        hasScript: bindings.has(f.code),
        scriptPath: FLOW_BINDINGS.find(
          (b) => b.feature_module === mod && b.feature_code === f.code,
        )?.path || null,
      })),
      scripts: [...scripts.keys()],
      subflows,
    };
  }
  console.log(JSON.stringify(output, null, 2));
} else {
  // 人类可读输出
  for (const [mod, features] of Object.entries(modules)) {
    const bindings = moduleBindings[mod] || new Set();
    const scripts = moduleScripts[mod] || new Map();

    console.log(`\n📦 ${mod} 模块`);
    console.log(`   功能点: ${features.length} 条`);
    console.log(`   已绑定: ${bindings.size} 条`);
    console.log(`   脚本数: ${scripts.size} 个\n`);

    // 按章节分组
    const byChapter = {};
    for (const f of features) {
      if (!byChapter[f.chapter]) byChapter[f.chapter] = [];
      byChapter[f.chapter].push(f);
    }

    for (const [ch, items] of Object.entries(byChapter).sort((a, b) => a[0] - b[0])) {
      console.log(`  第 ${ch} 章:`);
      for (const f of items) {
        const hasBinding = bindings.has(f.code);
        const statusIcon =
          f.status === '通过' ? '✅' :
          f.status === '留手测' ? '🤚' :
          f.status === '假绿' ? '⚠️' :
          f.status === '待写' ? '📝' :
          f.status === '待执行' ? '⬜' :
          f.status === '运行中' ? '🔄' :
          f.status === '失败' ? '❌' :
          '❓';
        const scriptIcon = hasBinding ? '📜' : '  ';
        console.log(`    ${statusIcon} ${scriptIcon} ${f.code} ${f.title}`);
      }
    }

    // 未绑定的功能点
    const unbound = features.filter((f) => !bindings.has(f.code));
    if (unbound.length > 0) {
      console.log(`\n  ⚠️  未绑定脚本 (${unbound.length}):`);
      for (const f of unbound) {
        console.log(`     ${f.code} ${f.title}`);
      }
    }

    // 多出的脚本（有绑定但没 seed）
    const seedCodes = new Set(features.map((f) => f.code));
    const extraBindings = [...bindings].filter((code) => !seedCodes.has(code));
    if (extraBindings.length > 0) {
      console.log(`\n  ⚠️  有绑定但无 seed (${extraBindings.length}):`);
      for (const code of extraBindings) {
        console.log(`     ${code}`);
      }
    }
  }

  console.log(`\n📁 子流程 (${subflows.length}):`);
  for (const s of subflows) {
    console.log(`   ${s}`);
  }
  console.log();
}
