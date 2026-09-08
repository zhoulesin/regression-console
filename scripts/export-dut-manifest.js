#!/usr/bin/env node
/**
 * 一次性迁出脚本：把功能点清单从控制台迁到被测仓。
 *
 * 数据来源是 SQLite（不是 seed 常量）——库里比 seed 多 11 条后来手工加的功能点，
 * 以库为准才不会丢数据。
 *
 * 用法：
 *   node scripts/export-dut-manifest.js            # 执行迁出
 *   node scripts/export-dut-manifest.js --dry-run   # 只打印将生成的 manifest
 *
 * 成功标准（全部满足才算迁出完成）：
 *   1. regression.manifest.json 已写入 appRoot
 *   2. maestro/** 已复制到 appRoot
 *   3. 每条非 manual 的 flow 都 existsSync 通过
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { appRoot, dbFile, manifestPath } from '../src/paths.js';
import { normalizeManifest } from '../src/manifest.js';
import { CHAPTER_TITLES } from '../src/constants.js';

const dryRun = process.argv.includes('--dry-run');
const STATUS_MANUAL = '留手测';

if (!appRoot) {
  console.error('未配置 appRoot（regression.config.json），无法迁出。');
  process.exit(1);
}
if (!fs.existsSync(appRoot)) {
  console.error(`appRoot 不存在：${appRoot}`);
  process.exit(1);
}

const db = new Database(dbFile, { readonly: true });

const modules = db
  .prepare('SELECT module, title FROM module_meta ORDER BY module')
  .all()
  .map((m) => ({ id: m.module, title: m.title || m.module }));

const flowByFeature = new Map(
  db
    .prepare("SELECT feature_module, feature_code, path FROM flow WHERE kind = 'flow'")
    .all()
    .map((f) => [`${f.feature_module}|${f.feature_code}`, f.path]),
);

const chaptersByModule = new Map();
for (const m of modules) {
  const row = db
    .prepare('SELECT chapters_json FROM module_meta WHERE module = ?')
    .get(m.id);
  chaptersByModule.set(m.id, JSON.parse(row?.chapters_json || '{}'));
}

// 绑定路径形如 maestro/todo/xxx.yaml，相对的是仓库根（迁移后是 appRoot）
const regressionRoot = path.resolve(import.meta.dirname, '..');
const features = db
  .prepare(
    'SELECT module, code, chapter, title, criteria, precondition, status, manual FROM feature ORDER BY module, code',
  )
  .all()
  .map((f) => {
    const bound = flowByFeature.get(`${f.module}|${f.code}`) ?? '';
    // 绑定的文件可能已被禁用（如 item-due-date.yaml.disabled）：如实降级为无 flow，
    // 禁用文件本身会随目录复制过去，修复后改名即可恢复。
    const flow =
      bound && fs.existsSync(path.join(regressionRoot, bound)) ? bound : '';
    if (bound && !flow) {
      console.warn(`! ${f.module}/${f.code} 绑定的 ${bound} 不存在（可能被禁用），按无 flow 迁出`);
    }
    const isManual = f.manual === 1 || f.status === STATUS_MANUAL;
    const entry = {
      module: f.module,
      code: f.code,
      chapter: f.chapter,
      title: f.title,
      criteria: f.criteria,
      precondition: f.precondition || '',
    };
    const chapterTitle = chaptersByModule.get(f.module)?.[String(f.chapter)];
    if (chapterTitle) entry.chapterTitle = chapterTitle;
    if (isManual) entry.manual = true;
    else if (flow) entry.flow = flow;
    // 无 flow 且非 manual：脚本待写，照常收录（sync 后 runnable=0）
    return entry;
  });

const manifest = {
  version: 1,
  appId: 'com.cozyla.choresreward',
  modules,
  features,
};

// 先校验再写盘：结构有错就中止，不产出半份清单
normalizeManifest(manifest, { appRoot });

console.log(
  `将迁出 ${modules.length} 个模块 / ${features.length} 条功能点` +
    `（含 ${features.filter((f) => f.manual).length} 条 manual，` +
    `${features.filter((f) => !f.manual && !f.flow).length} 条待写）→ ${appRoot}`,
);

if (dryRun) {
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

// 1. 写 manifest
const manifestFile = path.join(appRoot, manifestPath || 'regression.manifest.json');
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`✓ 已写入 ${manifestFile}`);

// 2. 复制 maestro
const srcMaestro = path.resolve(import.meta.dirname, '../maestro');
const dstMaestro = path.join(appRoot, 'maestro');
let copied = 0;
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.isDirectory()) copyDir(path.join(src, ent.name), path.join(dst, ent.name));
    else {
      fs.copyFileSync(path.join(src, ent.name), path.join(dst, ent.name));
      copied += 1;
    }
  }
}
copyDir(srcMaestro, dstMaestro);
console.log(`✓ 已复制 ${copied} 个文件到 ${dstMaestro}`);

// 3. 逐条校验 flow 存在
const failures = manifest.features.filter(
  (f) => !f.manual && f.flow && !fs.existsSync(path.join(appRoot, f.flow)),
);
if (failures.length > 0) {
  console.error('✗ 以下 flow 在 DUT 侧不存在，迁出未通过校验：');
  for (const f of failures) console.error(`  ${f.module}/${f.code} -> ${f.flow}`);
  process.exit(1);
}

console.log(
  `✓ 校验通过：${manifest.features.filter((f) => f.flow).length} 条 flow 全部存在`,
);
console.log('迁出完成。可以删除本仓 src/seed、src/importer.js 与 maestro/ 了。');
