<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# evorule-console-cloud 开发者指南

> **读者**：要参与本仓开发的新人（人或 LLM 协作者）。
> **范围**：架构、启动、一次完整产品流程、核心概念、代码地图、坑表。
> **不属于这里**：终端用户上手看 [tutorial/](./tutorial/)；启停细节看仓库根 [README-STARTUP.md](../../README-STARTUP.md)。

---

## 一、这套系统是什么

evorule-console-cloud 是 evorule 生态的**大众版前端 + 联调编排层**。它自己不是引擎，而是把两个 Rust 后端的服务组织成一个产品：

```
                    浏览器 http://localhost:5174
                            │
             ┌──────────────┴──────────────┐
             │   console-cloud (Vite dev)  │   SvelteKit SPA
             └──────┬───────────────┬──────┘
                    │ REST          │ REST
        ┌───────────▼──┐      ┌─────▼─────────────┐
        │ evorule-rule │      │ evorule-server    │
        │   :18081     │      │   :18080          │
        │  治理域       │      │  执行域            │
        └──────────────┘      └───────────────────┘
        evorule-rule\data\       rules/ + core_eval
        rule.db                  会话执行 + WAL 审计链
        数据集/条目/生命周期
```

| 进程 | 端口 | 职责 | 仓 |
|---|---|---|---|
| console-cloud dev | 5174 | 前端 SPA（工作台/治理/审计视图） | 本仓 |
| evorule-rule-serve | 18081 | **治理域**：规则数据集、条目、版本、生命周期、快照导出 | evorule-rule 仓 |
| evorule-server | 18080 | **执行域**：会话执行引擎、bundle 导入、事实链/审计 | evorule-server 仓 |

**铁律**：上层应用（含本前端）禁止直连 evorule 核心仓（D:\evorule 的 crate），一切调用必须过 server 层或 rule-serve 的 HTTP 门禁。

**三个仓的目录约定**（start-all.ps1 按兄弟目录推导 binary 路径）：

```
<父目录>/
├── evorule-console-cloud/   ← 本仓
├── evorule-server/          ← target/(debug|release)/evorule-server.exe
└── evorule-rule/            ← target/(debug|release)/evorule-rule-serve.exe
```

---

## 二、首次跑起来

### 前置条件

- Node.js（npm install 可用）
- Rust 工具链（cargo，用于编译两个后端）
- 三个仓按上面的兄弟目录摆好（或用环境变量覆盖 binary 路径）

### 步骤

```powershell
# 1. 编译两个后端（首次 ~30 分钟，debug 即可）
cd <evorule-server 仓根>; cargo build
cd <evorule-rule 仓根>;   cargo build

# 2. 装前端依赖
cd <本仓根>; npm install

# 3. 一键起全栈（三进程按序拉起，等端口就绪后自动开浏览器）
.\start-all.bat
```

`start-all.ps1` 做了什么：先检测端口，已占用则认为在运行并跳过；未占用则启动并等就绪。日志统一落 `logs\`（每轮转存 `.prev`，只保留两轮）。

**手动起单个服务时注意**：evorule-server 裸起**不会工作**——必须带 `--rules-dir`/`--core-eval`/`--service-registry` 等资源参数（默认参数见 start-all.ps1）；evorule-rule 联调要带 `--allowed-origins`（见坑表 #1）。

### 验证

- 浏览器 `http://localhost:5174/` 打开首页
- 治理页 http://localhost:5174/governance 能连上 18081（首次需引导管理员，见下）
- `.\status-all.ps1` 三服务全绿

### 首次引导治理管理员

evorule-rule 的 rule.db 初始为空，需带参数引导（公开仓不硬编码凭据）：

```powershell
$env:EVORULE_RULE_ARGS = '--host 127.0.0.1 --port 18081 --db C:\path\to\rule.db --admin-user <名字> --admin-password <你的密码> --allowed-origins http://localhost:5174'
.\start-all.bat
```

### 停止

```powershell
.\stop-all.bat
# 或只清前端端口（e2e 残留僵尸进程常见）
npm run clean
```

---

## 三、一次完整的产品流程（主线走读）

这是理解产品最重要的部分——规则从「写出来」到「被执行并留痕」的一生：

**① 治理建库**（:18081）：治理页连接后，建数据集（Dataset）→ 录入条目（规则条款）→ 生命周期推进（Draft → Candidate → Active）→ 发布（Published）。
数据集需带**法规锚 law_ref**（document_id + effective_from）——auto_by_effective_date 模式缺生效基准会在发布/部署时被前置校验 400 拦截（这是有意的闸门，不是 bug）。

**② 部署到执行域**（治理页「🚀 部署到执行域」按钮）：
`POST /v1/bundles/export`（治理侧导出快照包，含人工确认背书）→ `POST /api/bundles/import`（执行侧 8 项校验）→ 原子落盘 `evorule-server/rules/bundles/` → 自动 reload → 新会话生效。

**③ 执行与审计**（:18080）：工作台（或演示模式）新建会话 → 提交业务指令（instruction + payload）→ 引擎按「宪法 core_eval + 规则集」合并为单一顺序 transform 程序执行 → 结论落 payload.data，全程事实入 session_N.wal 审计链（哈希链，可回放验证）。

**④ 角色与权限**：平台账号登录（存于 evorule-server，Argon2id + 审计）；内置 4 角色，权限矩阵 ≤30 秒生效；受保护域（`stable.llm.*`/`stable.system.*`）写入仅 service token 可用。

三层分类贯穿全程，归属必须清晰：

| 层 | 是什么 | 载体 |
|---|---|---|
| 系统规则 | 系统自身运行规则，非用户资产 | TCB 宪法 + server 桥接规则集 |
| 用户规则 | 用户资产，达成业务目的 | 治理库数据集 → bundle → rules/ 目录 |
| 用户数据 | 业务指令与结论，只产生于会话 | params（输入）→ payload.data（结论）→ WAL（留痕） |

---

## 四、核心概念速查

- **治理域 vs 执行域**：位置视角。治理域（rule-serve）管规则的「生产与审批」；执行域（server）管规则的「装载与运行」。发布链是两者之间唯一的正门。
- **数据集生命周期**：5 态 Draft → Candidate → Active → Published（+ Rejected 旁路），状态机由治理侧强制，不可跳级。
- **bundle**：治理数据集的不可变快照（含版本、条目、BLAKE3 哈希）。执行域只认 bundle，不认治理库。
- **宪法（core_eval）+ 规则集**：执行时合并为单一顺序 transform，宪法在前、rules 按文件名字典序；无匹配规则即 Error 事实（不静默兜底）。
- **审计链**：每会话一个 WAL 文件，Command → StateTransition → Stable 哈希链，可离线验证。
- **后端注入**：前端通过 Svelte context 拿 ExecutionBackend（[backend-context.ts](../../src/lib/kernel/backend/backend-context.ts)），默认 HttpBackend，测试注入 MockBackend——换后端只改 root 一处。

---

## 五、代码地图

```
src/
├── routes/            # 页面（SvelteKit）
│   ├── workbench/     #   工作台（会话执行、审计视图、用户/角色管理入口）
│   ├── governance/    #   治理（数据集/条目/生命周期/部署到执行域/法规锚编辑）
│   ├── audit/ monitor/ users/ roles/ ...   # 各管理视图
│   └── login/         #   演示模式 + 平台登录
├── lib/
│   ├── kernel/        # 执行内核前端侧：backend 抽象、会话、指令提交
│   │   └── backend/   #   ExecutionBackend 接口 + Http/Mock 实现（context 注入）
│   ├── governance/    # 治理域客户端：backend/store/types（数据集、生命周期、bundle 导出）
│   ├── backend/       # 工作台后端通道：cloud/mock 双实现、平台认证
│   ├── views/         # 视图组件
│   └── components/    # 通用组件
└── scripts/           # dev.mjs（交互式启动）、clean-ports、validate-audit-bridge 等
```

## 六、常用命令

```powershell
npm run dev          # 起 dev server（含端口占用检测与交互清理）
npm run check        # svelte-check（提交前必须 0 错误）
npm run test:unit    # vitest 单测
npm test             # playwright e2e（先自动清端口）
npm run verify       # 校验套件
npm run lint:tokens  # 设计令牌 lint
node scripts/validate-audit-bridge.mjs   # 审计桥端到端 10 项验收
```

---

## 七、坑表（每条都是实测换来的）

按「症状 → 原因 → 修复」组织。新人遇到问题先查这里。

**#1 治理页连不上 18081 / 浏览器 CORS 拦截**
`start-all.ps1` 默认 `RULE_ARGS` 不带 `--allowed-origins`，手动重启 rule-serve 也容易漏。rule-serve 缺省走严格同源，跨端口前端全被拦。
修复：`$env:EVORULE_RULE_ARGS` 里补 `--allowed-origins http://localhost:5174` 再 start-all（见 README-STARTUP.md「后端启动参数」）。

**#2 `127.0.0.1:5174` 打不开，`localhost:5174` 能**
Vite dev 默认 listen IPv6 `::1`。用 `localhost` 或 `http://[::1]:5174/`；start-all 的端口检测已双栈兼容。

**#3 端口 5174 被占用 / e2e 后起不来**
playwright 测试残留僵尸进程。`npm run clean` 或让 `npm run dev` 的交互清理流程处理。

**#4 Svelte `lifecycle_outside_component` 崩溃**
`getContext`/`useBackendOrNull()` 等只能在组件初始化期同步调用；在异步回调（按钮 handler、await 之后）里调用即崩。
修复：组件顶层先取好 context 存变量，回调里用缓存。

**#5 发布数据集被 400 拦：「auto_by_effective_date 模式需生效基准」**
数据集 law_ref 缺 effective_from。这是治理侧三层前置闸门（创建/更新/发布期 fail-fast），不是 bug。
修复：治理页「法规锚(law_ref)」区块补齐（或 PATCH /v1/datasets/{id}），或把 version_selection 切 pinned。

**#6 手动起 evorule-server 后 18080 无响应**
裸起缺 `--rules-dir`/`--core-eval`/`--service-registry` 资源参数。用 start-all.ps1 或照抄其默认参数。

**#7 rule.db 管理员密码忘了**
不可恢复（哈希存储）。幂等引导一个新的管理员账号即可，不破坏既有数据（见「首次引导治理管理员」）。

**#8 写 .bat 脚本中文乱码 / 命令被吃**
cmd 按 ANSI 代码页预解析。启动类 .bat 必须纯 ASCII；PowerShell 文件注意 BOM（不要重复叠加）。

**#9 浏览器自动化验证「按钮禁用」误报**
自动化代理对 disabled 状态的读取偶发误报。裁定争议以 DOM 实际属性为准（快照 + 属性断言双确认）。

**#10 执行域行为「不生效」**
bundle 导入后只对**新会话**生效；老会话不回放新规则。验证部署是否落盘：看 `evorule-server/rules/bundles/` 目录 + server 日志三连（落盘 → core_eval replaced → reload）。

---

## 八、文档分工

| 文档 | 受众 |
|---|---|
| 本文档 | 开发者（架构/流程/坑） |
| [tutorial/](./tutorial/) + [scenarios/](./scenarios/) | 终端用户上手 |
| [README-STARTUP.md](../../README-STARTUP.md) | 启停/看门狗/日志细节 |
| [adr/](./adr/) | 架构决策记录 |
| [explanation/](./explanation/) | 概念与原理（规划中） |
