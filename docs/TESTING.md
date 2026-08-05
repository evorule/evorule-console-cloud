<!--
SPDX-License-Identifier: AGPL-3.0-or-later
Copyright (C) 2026 EvoRule Project
-->

# 测试指南 — evorule-console-cloud

**版本**: 1.0
**最后更新**: 2026-08-03
**面向**: 二次开发者（基于 evorule-console-cloud 构建自己产品的开发者）

> 本指南覆盖：环境准备 → 4 种自动化测试 → 完整联调（evorule-server）→ LLM 联调 → 排查常见问题。
> 跟着走一遍，约 30 分钟跑通全部测试。

---

## 1. 测试环境准备

### 1.1 前置要求

| 项 | 要求 |
| --- | --- |
| Node.js | ≥ 20.0（推荐 20.10+） |
| npm | ≥ 10 |
| 操作系统 | Windows / macOS / Linux 均可 |
| 浏览器 | Chromium（playwright 自动安装） |

### 1.2 一次性安装

```bash
git clone https://gitee.com/evo-rule-lab/evorule-console-cloud.git
cd evorule-console-cloud
npm install                            # 安装依赖
npx playwright install chromium        # 安装 e2e 浏览器（首次必须）
```

> **注**：开发期 `package.json` 中 `@evorule/console` 依赖是 `file:../evorule-console`，需要本地有内核仓。发版后会改为 git URL，届时 `npm install` 自动拉取。

### 1.3 验证安装成功

```bash
npm run check     # 应输出 "svelte-check found 0 errors and 0 warnings"
```

---

## 2. 4 种自动化测试（一键全跑）

### 2.1 测试一览

| 测试 | 命令 | 作用 | 耗时 |
| --- | --- | --- | --- |
| 类型检查 | `npm run check` | svelte-check：TS 类型 + Svelte 语法 + import 解析 | ~30s |
| 单元测试 | `npx vitest run` | vitest：纯函数逻辑（apiKey 脱敏、backend 切换、LLM 上下文注入等） | ~3s |
| e2e 测试 | `npm run test` | playwright：浏览器端到端（6 tab 导航 + LLM 流程 + 设置面板） | ~4min |
| 生产构建 | `npm run build` | adapter-static：产出 `build/` 静态文件 | ~30s |

### 2.2 一键全跑（推荐提 PR 前执行）

```bash
npm run check && npx vitest run && npm run test && npm run build
```

**全绿标准**：

- svelte-check: `0 errors / 0 warnings`
- vitest: `82 passed`
- playwright: `47 passed`
- build: `Wrote site to "build" ✔ done`

### 2.3 各测试详解见下文

---

## 3. 单元测试（vitest）

### 3.1 测试文件覆盖

| 文件 | 测试数 | 覆盖范围 |
| --- | --- | --- |
| [src/verify.test.ts](../src/verify.test.ts) | - | 核心契约验证 |
| [src/lib/assistant/types.test.ts](../src/lib/assistant/types.test.ts) | 21 | LLM 类型守卫 + CloudLlmConfig 防御性解析 |
| [src/lib/assistant/cloud-llm-assistant.test.ts](../src/lib/assistant/cloud-llm-assistant.test.ts) | 33 | LLM 调用全流程 + **apiKey 三不原则断言**（不进 URL / 不进日志 / 不进 error.message） |
| [src/lib/assistant/llm-context.test.ts](../src/lib/assistant/llm-context.test.ts) | - | provideLlm 上下文注入 |
| [src/lib/backend/cloud-http-backend.test.ts](../src/lib/backend/cloud-http-backend.test.ts) | - | CloudHttpBackend 双模式切换 + reconfigure |

### 3.2 怎么跑

```bash
# 跑一次就退出（CI / PR 前验证）
npx vitest run

# watch 模式（开发时持续监听文件变化）
npm run test:unit          # 等价于 npx vitest

# 只跑某个文件
npx vitest run src/lib/assistant/cloud-llm-assistant.test.ts

# 带覆盖率
npx vitest run --coverage
```

### 3.3 看结果

```
 ✓ src/lib/assistant/types.test.ts (21 tests) 883ms
 ✓ src/lib/assistant/cloud-llm-assistant.test.ts (33 tests) 28ms

 Test Files  5 passed (5)
      Tests  82 passed (82)
```

### 3.4 **关键断言：apiKey 三不原则**

`cloud-llm-assistant.test.ts` 包含 apiKey 安全断言：

- ✅ apiKey 不出现在 fetch URL 中
- ✅ apiKey 不出现在 console.log 中
- ✅ apiKey 不出现在 error.message 中（错误信息脱敏）
- ✅ 401 / 429 / 网络错误时返回友好提示

**新增 LLM 相关代码时，必须保持这些断言全绿**。

---

## 4. e2e 测试（playwright）

### 4.1 测试文件覆盖

| 文件 | 测试数 | 覆盖范围 |
| --- | --- | --- |
| [tests/navigation.spec.ts](../tests/navigation.spec.ts) | 20 | 6 tab 导航 + 主题切换 + 连接徽标 + 视图持久化 + 联网切换按钮 |
| [tests/assistant-flow.spec.ts](../tests/assistant-flow.spec.ts) | 6 | LLM 三用途流程 + LLM 关闭回归 + Escape 关闭 Dialog |
| [tests/settings-flow.spec.ts](../tests/settings-flow.spec.ts) | 21 | 联网配置 + LLM 配置 + apiKey 安全 + 持久化 + L2 占位 |

**TOTAL: 47 项**

### 4.2 怎么跑

```bash
# 全跑
npm run test

# 跑单个文件
npx playwright test tests/navigation.spec.ts

# 跑单个测试（按测试名过滤）
npx playwright test -g "点击 \"规则库\" tab"

# 带 UI 界面（可视化看每步）
npx playwright test --ui

# 跑完自动打开 HTML 报告
npx playwright test --reporter=html && npx playwright show-report
```

### 4.3 为什么 `workers: 1`？

[playwright.config.ts](../playwright.config.ts) 强制 `workers: 1` + `fullyParallel: false`。

**原因**：vite dev server 冷启动有编译延迟，多 worker 并发 `page.goto('/')` 时会触发竞态（首屏未编译完，`onMount` 滞后，hydration signal timeout）。**这是配置约束，不是代码缺陷**。

### 4.4 e2e 如何 mock evorule-server？

e2e 测试**不依赖真实 evorule-server**。`assistant-flow.spec.ts` 用 `page.route()` mock 了 `/api/sessions` 等 API，确保 `currentSessionId` 被设置，让 AI 按钮可见。

```typescript
// tests/assistant-flow.spec.ts 中的 mock 示例
await page.route('**/api/sessions', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ sessions: [1] })
  });
});
```

---

## 5. 完整联调（含 evorule-server）

自动化测试 mock 了后端，**真实联调需启动 evorule-server**。以下是完整步骤。

### 5.1 启动顺序（关键）

```bash
# 1. 启动 evorule-server（带 CORS 允许大众版 dev/preview 源）
cd D:\evorule-server
target\release\evorule-server.exe --addr 127.0.0.1:18080 \
  --allowed-origins "http://localhost:5174,http://localhost:4173,http://127.0.0.1:5174,http://127.0.0.1:4173"

# 2. 启动大众版 dev server
cd D:\evorule-console-cloud
npm run dev    # http://localhost:5174

# 3. 创建初始 session（让执行台 UI 显示提交区）
curl -X POST http://127.0.0.1:18080/api/sessions
# → {"message":"Session created","session_id":1}

# 4. 浏览器打开 http://localhost:5174/
```

### 5.2 验证联调成功

打开 http://localhost:5174/ 后：

| 验证点 | 预期 | 失败排查 |
| --- | --- | --- |
| 顶部连接徽标 | 显示"已连接" | 见 [§7.1 CORS](#71-cors-跨域错误) |
| 执行台 → Sessions 列表 | 显示 `#1` | 见 [§7.3 空 sessions](#73-空-sessions) |
| 执行台 → 提交命令 | 提交后显示 CommandResult | 检查 evorule-server 是否运行 |
| 状态视图 | 显示 reactor phase / version | 依赖 backend，未连接显示空状态 |
| 审计视图 | 显示审计链 | 依赖 backend |

### 5.3 生产预览模式

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

> **host 对齐注意**：preview 默认 `localhost`，若用 `--host 127.0.0.1` 需对应修改设置面板中的 baseUrl。dev mode 默认 `localhost:5174`，与 `net-config` 默认 `localhost:18080` 对齐。

---

## 6. LLM 联调（真实 API 调用）

### 6.1 获取 apiKey

推荐用**智谱 GLM-4-Flash**（有免费额度，无需付费）：

1. 访问 [智谱开放平台](https://open.bigmodel.cn/usercenter/apikeys)
2. 注册 → 创建 API Key → 复制（35 字符，`sk-` 开头）

其他厂商：

| 厂商 | 获取地址 | 备注 |
| --- | --- | --- |
| 智谱 GLM（推荐） | <https://open.bigmodel.cn/usercenter/apikeys> | 有免费额度 |
| 通义千问 | <https://dashscope.console.aliyun.com/apiKey> | - |
| DeepSeek | <https://platform.deepseek.com/api_keys> | - |
| OpenAI | <https://platform.openai.com/api-keys> | 需海外网络 |
| 文心一言 | - | **不兼容**（UI 中 disabled） |

### 6.2 配置 LLM

1. 浏览器打开 http://localhost:5174/
2. 点击顶部 **⚙️ 设置** tab
3. 切到 **🤖 LLM 配置** tab
4. 启用 LLM 辅助（勾选开关）
5. 厂商预设选"智谱 GLM"
6. apiKey 填入（密码框默认隐藏，👁️ 切换显示）
7. 点"测试连接" → 应显示"✓ 连接成功"
8. 点"保存"
9. **刷新页面**（配置变更需刷新才生效）

### 6.3 测试三用途

#### 用途 1：AI 辅助创建规则

1. 点 **规则库** tab
2. 点 **✨ AI 辅助创建** 按钮
3. 输入描述，例如：`注册时设置 status=ok`
4. 点"生成草案" → 等 1-3 秒 → 显示 LLM 生成的规则 JSON
5. 检查 RuleValidator 校验结果（confidence 显示 0.7/0.3/0.3 分级）
6. 点"采用并加入规则库" → 规则出现在规则列表

#### 用途 2：AI 解释规则

1. 规则库中选一个规则（如 `set_basic`）
2. 点 **✨ AI 解释规则** 按钮
3. 等 1-3 秒 → 显示 LLM 对规则的自然语言解释

#### 用途 3：AI 生成测试输入

1. 点 **执行台** tab
2. 选中一个 session（没有就点"+ 新建"）
3. 点 **✨ AI 生成输入** 按钮
4. 输入描述，例如：`用户登录场景`
5. 点"生成" → 显示 LLM 生成的 instruction JSON
6. 点"采用并复制到剪贴板" → JSON 自动填入指令编辑框
7. 点"提交命令" → 验证 CommandResult

### 6.4 验证 apiKey 安全

在浏览器 DevTools (F12) 中检查：

- ✅ URL 中**不含** apiKey（地址栏、network 请求 URL）
- ✅ Console 中**不打印** apiKey
- ✅ 故意填错 apiKey 测试连接 → 错误信息**不含** apiKey 明文

---

## 7. 常见问题排查

### 7.1 CORS 跨域错误

**现象**：浏览器 Console 报 `Access-Control-Allow-Origin` 错误，连接徽标显示"未连接"。

**原因**：evorule-server 默认严格同源，跨端口请求被拒。

**解决**：

```bash
# evorule-server 启动时加 --allowed-origins
evorule-server.exe --addr 127.0.0.1:18080 \
  --allowed-origins "http://localhost:5174,http://localhost:4173"
```

### 7.2 端口 5174 被占用（e2e 测试后常见）

**现象**：`npm run dev` 报 `Port 5174 is in use`，或浏览器访问 `http://localhost:5174/` 显示 "This site can't be reached"。

**根因**：`npm run test`（playwright e2e）结束后，Windows 上 `npm → vite → node` 子进程树不一定被完全清理，残留的 node 进程会持有端口 5174。下次 `npm run dev` 时 vite（`strictPort: true`）会直接报错。

**解决**：

```bash
# 一键清理（推荐）
npm run clean && npm run dev

# 或手动查找并停止
Get-NetTCPConnection -LocalPort 5174 -State Listen | Select-Object OwningProcess
Stop-Process -Id <PID> -Force
```

> **预防**：每次跑完 `npm run test` 后，先 `npm run clean` 再 `npm run dev`。

### 7.3 空 sessions（执行台不显示提交区）

**现象**：执行台显示"没有当前 session，点击左侧 + 新建 创建一个 session"。

**原因**：evorule-server 启动后 sessions 列表为空。

**解决**：

```bash
# 手动创建初始 session
curl -X POST http://127.0.0.1:18080/api/sessions
```

或在 UI 中点执行台左侧的 **+ 新建** 按钮。

### 7.4 e2e 测试超时

**现象**：playwright 报 `Test timeout of 30000ms exceeded`。

**排查**：

1. 确认 `playwright.config.ts` 中 `workers: 1`（默认已配置）
2. 确认 `page.goto('/')` 用了 `waitUntil: 'networkidle'`（让 vite 完成首屏编译）
3. 如果是首次跑，确认 `npx playwright install chromium` 已执行
4. 网络慢时可在 `playwright.config.ts` 临时调大 timeout

### 7.5 LLM 调用失败

**现象**：点"生成草案"后转圈不停或报错。

**排查**：

| 错误 | 原因 | 解决 |
| --- | --- | --- |
| `401 Unauthorized` | apiKey 错误或过期 | 重新获取 apiKey |
| `429 Too Many Requests` | 调用频率超限 | 等待或换厂商 |
| `Failed to fetch` | 网络问题或 CORS | 检查网络；厂商 API 是否支持浏览器端 CORS |
| `JSON parse error` | LLM 返回非 JSON | 重试或换 prompt；RuleValidator 会拦截 |
| 转圈不停 | 厂商 API 响应慢 | 等待 5-10 秒；超时后会显示错误 |

### 7.6 svelte-check 报错

**现象**：`npm run check` 报 TS 类型错误。

**排查**：

1. 确认 `npm install` 已执行（依赖完整）
2. 确认 `@evorule/console` 内核包已构建（`file:../evorule-console` 依赖需内核有 dist/）
3. 如果内核未构建，先 `cd ../evorule-console && npm run package`

---

## 8. 测试覆盖矩阵

### 8.1 自动化覆盖（129 项）

| 场景 | 自动化测试 | 文件 |
| --- | --- | --- |
| 6 tab 导航切换 | ✅ 20 项 | navigation.spec.ts |
| 主题切换 + 持久化 | ✅ | navigation.spec.ts |
| 连接徽标三态 | ✅ | navigation.spec.ts |
| 视图持久化 | ✅ | navigation.spec.ts |
| 联网模式切换 + 持久化 | ✅ | navigation.spec.ts |
| LLM 三用途流程（mock） | ✅ 6 项 | assistant-flow.spec.ts |
| LLM 关闭回归 | ✅ | assistant-flow.spec.ts |
| 联网配置流程 | ✅ 21 项 | settings-flow.spec.ts |
| LLM 配置流程 | ✅ | settings-flow.spec.ts |
| apiKey 不进 URL | ✅ | settings-flow.spec.ts |
| LLM 配置持久化 | ✅ | settings-flow.spec.ts |
| L2 占位可见 | ✅ | settings-flow.spec.ts |
| apiKey 三不原则（单测） | ✅ 33 项 | cloud-llm-assistant.test.ts |
| LLM 类型守卫 | ✅ 21 项 | types.test.ts |
| CloudHttpBackend 双模式 | ✅ | cloud-http-backend.test.ts |
| LLM 上下文注入 | ✅ | llm-context.test.ts |

### 8.2 需人工测试（自动化无法覆盖）

| 场景 | 为什么需人工 | 测试方法 |
| --- | --- | --- |
| 真实 LLM API 调用 | e2e 用 mock，不调真实厂商 API | 见 [§6 LLM 联调](#6-llm-联调真实-api-调用) |
| 真实 evorule-server 连接 | e2e 用 mock，不依赖真实 server | 见 [§5 完整联调](#5-完整联调含-evorule-server) |
| 视觉还原（CSS 布局错位） | 自动化只检查 DOM，不检查视觉 | 浏览器手动检查各视图 |
| 跨浏览器兼容 | playwright 只测 chromium | 手动测 Firefox / Edge / Safari |
| 性能（LLM 响应时间） | mock 不反映真实延迟 | 见 [§6](#6-llm-联调真实-api-调用)，预期 1-3 秒 |

---

## 9. 持续集成（CI）建议

提 PR 时建议 CI 跑以下流水线：

```yaml
# .github/workflows/ci.yml 示例（Gitee 可用类似配置）
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run check
      - run: npx vitest run
      - run: npm run test
      - run: npm run build
```

**全绿才允许合并**。

---

## 10. 测试文件结构

```
evorule-console-cloud/
├── src/
│   ├── verify.test.ts                              # 核心契约验证
│   └── lib/
│       ├── assistant/
│       │   ├── types.test.ts                       # LLM 类型守卫 (21)
│       │   ├── cloud-llm-assistant.test.ts         # LLM 调用 + apiKey 安全 (33)
│       │   └── llm-context.test.ts                 # 上下文注入
│       └── backend/
│           └── cloud-http-backend.test.ts          # 双模式 backend
├── tests/
│   ├── navigation.spec.ts                          # 6 tab 导航 (20)
│   ├── assistant-flow.spec.ts                      # LLM 三用途 (6)
│   └── settings-flow.spec.ts                       # 设置面板 (21)
└── playwright.config.ts                            # workers:1 + fullyParallel:false
```

---

## 联系

- **Gitee Issues**: <https://gitee.com/evo-rule-lab/evorule-console-cloud/issues>
- **邮箱**: <evorulelab@gmail.com>
- **贡献指南**: [CONTRIBUTING.md](../CONTRIBUTING.md)

---

**遵循 [Conventional Commits](https://www.conventionalcommits.org/) + [Keep a Changelog](https://keepachangelog.com/)。**
