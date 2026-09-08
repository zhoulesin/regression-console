#!/usr/bin/env node

/**
 * Maestro YAML 校验器
 *
 * 用法：
 *   node src/cli/validate.js maestro/todo/item-fast-add.yaml   # 校验单个
 *   node src/cli/validate.js maestro/todo/                     # 校验目录
 *   node src/cli/validate.js --all                             # 校验全部
 *   node src/cli/validate.js --json maestro/todo/              # JSON 输出
 *
 * 校验项：
 *   1. 坐标定位：rightOf/below/leftOf/above 不得用于 tapOn
 *   2. 断言绑定：assertVisible 必须有 childOf/containsChild（防假绿）
 *   3. ID 存在：引用的 android:id 必须在 XML 布局中存在
 *   4. 子流程引用：runFlow 路径必须存在
 *   5. timeout 位置：不得写在 visible/notVisible 内部
 *   6. 结构完整性：必须有 appId + --- + 至少一个 step
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const allMode = args.includes('--all');
const targets = args.filter((a) => !a.startsWith('--'));

const regressionRoot = path.resolve(import.meta.dirname, '../..');

// ─── 收集 XML 布局中的 ID ───

function collectLayoutIds(appRoot) {
  const ids = new Set();
  const layoutDir = path.join(appRoot, 'app/src/main/res/layout');
  try {
    for (const file of fs.readdirSync(layoutDir)) {
      if (!file.endsWith('.xml')) continue;
      const content = fs.readFileSync(path.join(layoutDir, file), 'utf8');
      for (const m of content.matchAll(/android:id="@\+id\/([^"]+)"/g)) {
        ids.add(m[1]);
      }
    }
  } catch {}
  return ids;
}

// ─── 读取 regression.config.json 拿 appRoot ───

function getAppRoot() {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(regressionRoot, 'regression.config.json'), 'utf8'),
    );
    return config.appRoot;
  } catch {
    return null;
  }
}

// ─── 解析 YAML steps ───

function parseSteps(yamlContent) {
  // Maestro YAML 用 --- 分隔 header 和 steps
  const parts = yamlContent.split(/^---\s*$/m);
  if (parts.length < 2) return null;

  const stepsPart = parts.slice(1).join('---\n');
  try {
    const doc = parseYaml(stepsPart);
    return doc;
  } catch (e) {
    return null;
  }
}

// ─── 递归查找所有 tapOn / assertVisible 等命令 ───

function findCommands(steps, parentPath = '') {
  const results = [];
  if (!Array.isArray(steps)) return results;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== 'object') continue;

    const pathHere = `${parentPath}[${i}]`;

    // runFlow 递归
    if (step.runFlow && typeof step.runFlow === 'string') {
      results.push({ type: 'runFlow', path: step.runFlow, loc: pathHere });
    }
    if (step.runFlow?.path) {
      results.push({ type: 'runFlow', path: step.runFlow.path, loc: pathHere });
    }

    // 直接命令
    for (const cmd of [
      'tapOn', 'assertVisible', 'assertNotVisible', 'extendedWaitUntil',
      'scrollUntilVisible', 'inputText', 'clearText', 'launchApp', 'stopApp',
    ]) {
      if (step[cmd]) {
        results.push({ type: cmd, value: step[cmd], loc: pathHere });
      }
    }

    // 嵌套 commands
    if (step.commands) {
      results.push(...findCommands(step.commands, pathHere + '.commands'));
    }
    if (step.runFlow?.commands) {
      results.push(...findCommands(step.runFlow.commands, pathHere + '.runFlow.commands'));
    }
  }
  return results;
}

// ─── 校验一条 YAML ───

function validateFile(filePath, layoutIds) {
  const issues = [];
  const content = fs.readFileSync(filePath, 'utf8');

  // 1. 基本结构
  if (!content.includes('appId:')) {
    issues.push({ level: 'error', rule: 'structure', msg: '缺少 appId' });
  }
  if (!content.includes('---')) {
    issues.push({ level: 'error', rule: 'structure', msg: '缺少 --- 分隔符' });
  }

  // 2. 解析 YAML
  const doc = parseSteps(content);
  if (!doc) {
    issues.push({ level: 'error', rule: 'parse', msg: 'YAML 解析失败' });
    return issues;
  }

  // 3. 提取 header 后的 steps
  const steps = doc.steps || (Array.isArray(doc) ? doc : []);
  const commands = findCommands(steps);

  // 4. 检查每条命令
  for (const cmd of commands) {
    // 4a. tapOn 不得用 rightOf/below/leftOf/above 定位
    if (cmd.type === 'tapOn' && typeof cmd.value === 'object') {
      for (const bad of ['rightOf', 'below', 'leftOf', 'above']) {
        if (cmd.value[bad]) {
          issues.push({
            level: 'error',
            rule: 'no-coord-tap',
            msg: `tapOn 使用了 ${bad} 定位（铁律 #1：只比较坐标，会误操作）`,
            loc: cmd.loc,
          });
        }
      }
    }

    // 4b. assertVisible 必须绑定容器（防假绿）
    if (cmd.type === 'assertVisible' && typeof cmd.value === 'object') {
      if (!cmd.value.childOf && !cmd.value.containsChild && !cmd.value.containsDescendants) {
        issues.push({
          level: 'warn',
          rule: 'assert-bind-container',
          msg: 'assertVisible 未绑定容器，可能假绿（铁律 #4：结果必须在判定容器内）',
          loc: cmd.loc,
        });
      }
    }

    // 4c. extendedWaitUntil 的 visible 内不得有 timeout
    if (cmd.type === 'extendedWaitUntil' && typeof cmd.value === 'object') {
      if (cmd.value.visible?.timeout !== undefined) {
        issues.push({
          level: 'error',
          rule: 'timeout-placement',
          msg: 'timeout 写在了 visible 内部（应该写在 extendedWaitUntil 层）',
          loc: cmd.loc,
        });
      }
    }

    // 4d. ID 存在性检查
    if (typeof cmd.value === 'object' && cmd.value.id) {
      const id = cmd.value.id.replace(/^com\.cozyla\.choresreward:id\//, '');
      if (layoutIds.size > 0 && !layoutIds.has(id)) {
        issues.push({
          level: 'warn',
          rule: 'id-exists',
          msg: `ID "${id}" 在 XML 布局中未找到（可能是动态 ID 或运行时生成）`,
          loc: cmd.loc,
        });
      }
    }

    // 4e. 子流程路径存在性
    if (cmd.type === 'runFlow' && typeof cmd.value === 'string') {
      const subflowPath = path.resolve(path.dirname(filePath), cmd.value);
      if (!fs.existsSync(subflowPath)) {
        issues.push({
          level: 'error',
          rule: 'subflow-exists',
          msg: `子流程 "${cmd.value}" 不存在（${subflowPath}）`,
          loc: cmd.loc,
        });
      }
    }
  }

  // 5. 检查是否用了 stopApp（除非本功能就是测杀进程）
  if (content.includes('stopApp:') && !content.includes('杀进程')) {
    issues.push({
      level: 'warn',
      rule: 'no-unnecessary-stop',
      msg: '脚本用了 stopApp，但 name 中不含「杀进程」（铁律 #9：脚本要短，不必要的 stopApp 会拖慢执行）',
    });
  }

  // 6. 检查结尾是否又 cleanup（铁律 #9：cleanup 只放开头）
  const lastCommands = commands.slice(-3);
  for (const cmd of lastCommands) {
    if (cmd.type === 'runFlow' && typeof cmd.value === 'string' && cmd.value.includes('cleanup')) {
      issues.push({
        level: 'warn',
        rule: 'cleanup-only-at-start',
        msg: '结尾有 cleanup-fixture（铁律 #9：cleanup 只放开头，结尾不要）',
        loc: cmd.loc,
      });
    }
  }

  return issues;
}

// ─── 收集文件列表 ───

function collectFiles(targets) {
  const files = [];
  for (const t of targets) {
    const full = path.resolve(t);
    if (fs.statSync(full).isDirectory()) {
      for (const entry of fs.readdirSync(full, { recursive: true })) {
        if (typeof entry !== 'string') continue;
        if (entry.endsWith('.yaml') && !entry.includes('subflows')) {
          files.push(path.join(full, entry));
        }
      }
    } else if (full.endsWith('.yaml')) {
      files.push(full);
    }
  }
  return files;
}

// ─── 主流程 ───

const appRoot = getAppRoot();
const layoutIds = appRoot ? collectLayoutIds(appRoot) : new Set();
if (layoutIds.size === 0) {
  console.error('⚠️  未找到 XML 布局，ID 存在性检查将跳过');
}

let allFiles;
if (allMode) {
  allFiles = collectFiles([path.join(regressionRoot, 'maestro')]);
} else if (targets.length > 0) {
  allFiles = collectFiles(targets);
} else {
  console.error('用法: validate.js <file|dir> [--all] [--json]');
  process.exit(1);
}

const results = [];
let totalErrors = 0;
let totalWarns = 0;

for (const file of allFiles) {
  const relPath = path.relative(regressionRoot, file);
  const issues = validateFile(file, layoutIds);
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  totalErrors += errors.length;
  totalWarns += warns.length;
  results.push({ file: relPath, issues, errors: errors.length, warns: warns.length });
}

if (jsonMode) {
  console.log(JSON.stringify({ totalErrors, totalWarns, files: results }, null, 2));
} else {
  for (const r of results) {
    if (r.issues.length === 0) {
      console.log(`✅ ${r.file}`);
    } else {
      const icon = r.errors > 0 ? '❌' : '⚠️';
      console.log(`${icon} ${r.file}`);
      for (const issue of r.issues) {
        const prefix = issue.level === 'error' ? '  ✖' : '  ⚠';
        const loc = issue.loc ? ` ${issue.loc}` : '';
        console.log(`${prefix} [${issue.rule}]${loc} ${issue.msg}`);
      }
    }
  }

  console.log(`\n📊 ${allFiles.length} 个文件, ${totalErrors} 个错误, ${totalWarns} 个警告`);
  if (totalErrors > 0) process.exit(1);
}
