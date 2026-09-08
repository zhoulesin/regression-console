# Regression Console - Claude 指令

## 项目概述

本机 Todo 回归看板：SQLite 状态 + Maestro 执行 + 静态 UI。

**技术栈：**
- 后端：Node.js >= 24 + Express + SQLite (better-sqlite3)
- 前端：React + Vite
- 测试：Maestro (Android UI 自动化)
- 设备：Cozyla Calendar (EW400003C)

## 关键架构

```
regression-console/
├── src/                    # Node.js 后端
│   ├── catalog.js         # 目录扫描与分析
│   └── seed/              # 测试数据种子
├── web/                   # React 前端
│   ├── src/
│   │   ├── App.jsx        # 主应用
│   │   ├── CatalogPanel.jsx  # 目录面板
│   │   └── styles.css     # 样式
│   └── dist/              # 构建产物
├── maestro/               # Maestro 脚本
│   ├── todo/              # Todo 模块脚本
│   └── subflows/          # 子流程
└── regression.config.json # 本地配置（.gitignore）
```

## 核心概念

### 1. 功能点（Feature）
- 被测的产品行为，是「验什么」
- 带数据前提，独立于脚本
- 位置：TESTING_DEVICE_REGRESSION.md 第三节

### 2. 执行流（Flow）
- 可单独 `maestro test` 的入口脚本
- 一个 flow 只覆盖一个功能点
- 位置：TESTING_DEVICE_REGRESSION.md 第四节

### 3. 子流程（Subflow）
- 被 flow 复用的片段（进页面、造夹具、清夹具）
- 不单独作为用例

### 4. 夹具（Fixture）
- 脚本自己造、自己删的测试数据
- 命名：`E2E Todo*` / `E2E_*`

## 常用命令

```bash
# 开发
npm run dev          # 只起 API（前端开发用 Vite :4781 proxy）
npm start            # 构建 UI 并起 127.0.0.1:4780

# 测试
npm test             # 单测
npm run build-ui     # 构建 web/dist

# Maestro 回归
export PATH="$HOME/.maestro/bin:$PATH"
maestro test maestro/todo/subflows/cleanup-fixture.yaml  # 清残留
maestro test maestro/cold-launch.yaml                    # 冷启动测试
```

## 关键配置

### regression.config.json
```json
{
  "appRoot": "/absolute/path/to/choresReward",  // 被测项目路径
  "sourceDirs": ["app/src/main/java"]           // catalog 扫描目录
}
```

**重要：** 此文件含本机绝对路径，已在 `.gitignore` 中排除。

## 工作流

### 脚本生成（CLI 端）
1. 在 Claude Code 中描述功能点要求
2. Claude 分析源代码并生成 Maestro YAML
3. 复制到 `maestro/todo/` 目录
4. 更新数据库记录

### 测试执行（Web 端）
1. 在控制台查看功能点列表
2. 点击「执行」运行 Maestro 脚本
3. 查看执行结果（通过/失败）
4. 失败时可查看详细日志

## Maestro 编写铁律

### 1. 坐标关系不得用于定位操作目标
- `rightOf` / `below` / `leftOf` / `above` **只比较屏幕坐标**，不含行内或层级约束
- **正确写法**：绑定到行容器（`childOf` + `containsChild`）

### 2. 写入前做 fail-closed 断言
- 编辑类操作在输入前先断言对象正确，不符就失败、不写数据

### 3. 没有数据支撑的断言就是假绿
- 断言必须落在**数据可观察的效果**上，不能只断言控件自身的 `selected`

### 4. 一次只交一个可验证单元
- 一个 flow 只做一件事，失败时能精确定位

## 边界

**做**：
- 启动与导航冒烟
- Todo 模块的增删改查与持久化
- 失败留截图并能对上 logcat

**不做**（继续手测或交给单测）：
- 登录/登出竞态、ID App 登录页
- Widget、ContentProvider 对外契约
- 家长锁 PIN
- chore 打卡 / uncheck（太脆）
- 重复规则、顺延、UseCase 等细规则 → 归 `app/src/test`（JVM）

## 常见问题

### Node 版本问题
- 要求：`>=24`（见 `.nvmrc`）
- `better-sqlite3` 是原生模块，已按 Node 25 的 ABI 编译
- 用 Node 22 跑会报 `ERR_DLOPEN_FAILED`

### Maestro driver app
- 不要卸载 `dev.mobile.maestro`
- 卸载后重装会报 `INSTALL_FAILED_USER_RESTRICTED`，需重启设备

### 设备要求
- USB 设备 + Maestro 可用
- 会话前提：ID 已登录、token 可用
- 脚本开头即断言能进主 Tab

## 相关文档

| 文档 | 职责 |
|------|------|
| `README.md` | 项目概述与快速开始 |
| `TESTING_DEVICE_REGRESSION.md` | 真机 Maestro 回归清单 |
| `TESTING_UI_REPEAT_VIEWS.md` | instrumented：重复选择 View |
| `TESTING_ROUTINE_*.md` | 日常/周常/月常手测或规则清单 |
| `app/src/test` | JVM：规则与 UseCase |
