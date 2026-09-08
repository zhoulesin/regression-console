# Regression Console

本机 Todo 回归看板：SQLite 状态 + Maestro 执行 + 静态 UI。

> **Node 版本要求：`>=24`**（见 `.nvmrc`）。`better-sqlite3` 是原生模块，
> 已按 Node 25 的 ABI（NODE_MODULE_VERSION 141）编译。用 Node 22 跑会报
> `ERR_DLOPEN_FAILED`，且所有涉及数据库的测试会成片失败——这不是代码问题，
> 换回 Node 24+ 即可。

## 控制台放哪、怎么关联被测项目

控制台**不要求放在被测仓库内**。被测 Android 项目的位置由外部配置给出，
优先级：`REGRESSION_APP_ROOT` 环境变量 > `regression.config.json` 的 `appRoot`
> 必填，不再有默认 `../..`。指向被测项目（DUT）根目录；清单 `regression.manifest.json` 与 `maestro/` 都在那里。

```bash
cp regression.config.example.json regression.config.json
# 编辑 appRoot 指向被测项目；控制台在仓库外时写绝对路径
# "appRoot": "/absolute/path/to/choresReward"
```

`sourceDirs` 当前未使用（功能点完全由 DUT manifest 驱动），保留字段留给后续 AI 生成。
`regression.config.json` 含本机绝对路径，已在 `.gitignore` 中排除。

AI 分析怎么拿到源码：`buildContext` 由 Node 端读文件塞进 prompt（与 cwd 无关）；
catalog 模式给 Claude 的候选文件清单是**相对 appRoot** 的路径，因此 claude 子进程的
`cwd` 会被显式设为 `appRoot`（`src/claudeRun.js`），否则 Claude 的 `Read` 补不上洞。

```bash
cd tools/regression-console
nvm use          # 或确保 node -v >= 24
npm install && npm --prefix web install
npm test          # 单测
npm run build-ui  # 构建 web/dist
npm start         # 构建 UI 并起 127.0.0.1:4780，打印带 token 的 URL
npm run dev       # 只起 API（前端开发用 Vite :4781 proxy）
```

功能点清单（`regression.manifest.json`）与 Maestro 脚本（`maestro/`）都归**被测项目（DUT）**所有，
不在本仓库内。控制台只负责从 DUT 同步清单、在 `appRoot` 下执行 `maestro test`、并把结果记账。
导出文档 `TESTING_DEVICE_REGRESSION.md`（进度 html 在 `docs/testing/`）仍由本仓库生成。
手动在 DUT 里验证脚本时先进入 DUT 根目录：

```bash
cd /path/to/choresReward
maestro test maestro/cold-launch.yaml
```

真机验收：USB 设备 + Maestro 可用时，看板选 0.4 / 1.1 点执行；无设备可跳过。
已通过条目允许再次执行。
