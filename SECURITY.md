<!--
SPDX-License-Identifier: CC0-1.0
Security disclosure procedures are public knowledge; we release them under CC0 so everyone knows how to report vulnerabilities safely.
-->

# 安全漏洞报告政策

**最后更新**: 2026-08-03
**适用范围**: evorule-console-cloud 仓

---

## ⚠️ 支持的版本

| 版本 | 支持状态 | 说明 |
| --- | --- | --- |
| `v0.1.x`（含 0.1.0） | ✅ Supported | 联网大众版首发阶段，当前主支持线 |
| `< v0.1.0` | ❌ Unsupported | 公开仓库之前的 commit 不维护 |

**alpha 阶段承诺**：

- Critical / High 漏洞：60 天内修
- Medium / Low 漏洞：推迟到 0.2.0
- 安全公告：修完后 30 天内公开披露（经协调）

---

## 报告安全漏洞

如果您发现 evorule-console-cloud 中的安全漏洞，请通过以下方式负责任地披露：

### 📧 联系方式

- **邮箱**: <evorulelab@gmail.com>（主题加 `[SECURITY]`）
- **Gitee 私信**: 维护者(@evorulelab)
- **加密**: 当前未提供 PGP 公钥（如有需要可联系）

### 📋 报告内容

请在报告中包含：

1. 漏洞类型和描述
2. 复现步骤
3. 潜在影响评估
4. 建议的修复方案（如有）
5. 已尝试的缓解措施

### ⏱️ 响应时间承诺

- **确认收到**: 48 小时内
- **初步评估**: 5 个工作日内
- **修复计划**: 10 个工作日内
- **公开披露**: 修复后 30 天内（经协调）

### 🔒 保密承诺

在漏洞修复并公开披露之前，我们将：

- 严格保密您的报告
- 不与第三方分享相关信息
- 及时向您通报修复进展

### 🙏 致谢

对于负责任披露的安全研究者，我们将在修复后的发布公告中予以致谢（经您同意）。

---

## 🔐 evorule-console-cloud 特有的安全考虑

evorule-console-cloud 是联网大众版（SvelteKit + 联网 + 云 LLM），其安全边界与内核 evorule-console 不同：

| 边界 | 风险 | 缓解 |
| --- | --- | --- |
| **云 LLM apiKey** | apiKey 泄露（localStorage 明文） | localStorage 存储（大众版可接受）；**不进 URL / 不进日志 / 不进 error.message**；密码框默认隐藏（眼睛图标切换显示）；UI 提示"key 存于本地，不上传" |
| **LLM 调用跨域** | 浏览器 fetch 厂商 API 触发 CORS | 厂商 API 侧配置 CORS 允许大众版 origin；大众版无服务端，不引入 CORS 风险 |
| **evorule-server 跨域** | 联网模式调远程 server 触发 CORS | evorule-server 启动时配置 `--allowed-origins`；本地开发用 `localhost` 对齐 vite 默认（避免 localhost ↔ 127.0.0.1 误判） |
| 用户规则 JSON 输入 / 编辑 | XSS（规则内容含 `<script>` 注入到 DOM） | Svelte 默认文本转义；**禁用 `{@html}`** 渲染规则内容；内核 `L_console` 预校验（G1-G7）拦截非法结构 |
| LLM 生成的规则草案 | LLM 输出含恶意 JSON / 注入 | 草案必须经内核 `RuleValidator` 校验（confidence 0.7/0.3/0.3 分级）+ **用户审核确认**才生效；不自动执行 |
| 视图/主题/LLM 配置 localStorage 持久化 | 跨测试 / 跨会话状态串扰 | 每次使用前 `localStorage.clear()`；不持久化除配置外的敏感数据 |
| npm 供应链 | 依赖被投毒 | `package-lock.json` 锁定；`npm audit` 定期检查；CI 校验签名 |

> **关键安全属性**：
> 1. **LLM 不参与确定性执行** — 执行链路完全不经过 LLM，规则即数据，用户审核才生效。LLM 调用失败降级为"用户手动编辑 JSON"，不阻塞规则引擎工作。
> 2. **审计链 TCB 纯净** — blake3 哈希计算与验证在 evorule 核心（tier1）完成，前端 AuditView 仅做展示。大众版不修改内核，通过扩展槽注入，不引入新的可信计算边界。
> 3. **apiKey 三不原则** — 不进 URL / 不进日志 / 不进 error.message（由 `llm-fetch.ts` 保证，单测覆盖断言）。

### 📚 详细安全设计

- LLM apiKey 安全实现：[src/lib/assistant/llm-fetch.ts](src/lib/assistant/llm-fetch.ts)（apiKey 脱敏 + 错误处理）
- LLM 草案校验：[src/lib/assistant/cloud-llm-assistant.ts](src/lib/assistant/cloud-llm-assistant.ts)（RuleValidator 集成）
- 联网后端配置：[src/lib/backend/cloud-http-backend.ts](src/lib/backend/cloud-http-backend.ts)（双模式 + reconfigure）
- 配置持久化：[src/lib/config/](src/lib/config/)（net-config + llm-config，localStorage 防御性解析）

### 📜 已知安全问题

当前**没有已知未修复的安全问题**。

历史上修复过的问题请见 [CHANGELOG.md](CHANGELOG.md)。

---

**重要提示**: 请勿在公共论坛、社交媒体或 issue tracker 中公开未修复的安全漏洞。

**作者**: EvoRule Project
**邮箱**: <evorulelab@gmail.com>
