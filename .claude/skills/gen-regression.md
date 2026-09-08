---
name: gen-regression
description: 从 Android 源码生成 Maestro 回归测试数据（seed + 脚本 + 绑定）
user_invocable: true
---

# gen-regression — 源码 → 回归测试

## 使用方式

**推荐在被测项目中调用**（如 choresReward），那边的 skill 会自动定位源码。

如果在 regression-console 项目中调用，需指定模块：
```
/gen-regression todo
```

## 执行逻辑

1. 读 `regression.config.json` 确定 `appRoot` 和 `sourceDirs`
2. 扫描 Kotlin 源码 + XML 布局，提取可测试行为和 UI ID
3. 读 `maestro/模块名/` 已有脚本，避免重复
4. 生成 seed（功能点）+ Maestro YAML（脚本）+ flow 绑定
5. 写入本项目的 `src/seed/`、`maestro/`、`src/seed/index.js`

## 铁律

遵循被测项目的 `maestro-flow-authoring` skill 中的全部规则。

## 输出

| 文件 | 路径 |
|------|------|
| Seed | `src/seed/模块名.js` |
| 脚本 | `maestro/模块名/xxx.yaml` |
| 绑定 | `src/seed/index.js` |
| 子流程 | `maestro/subflows/`（仅新夹具模式） |
