<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# 场景 5 · 公式量纲验证（AI 给的公式，单位过不过机器说了算）

## 业务语义

模型输出的公式"看着像对的"是常态错误源：`E = m*v` 把动量当动能。量纲引擎按变量单位推导公式两侧的 SI 量纲向量（七基本量纲幂次），逐条判定一致性——确定性静态分析，无模型参与、无浮点、bitwise_replayable。

对应能力：原生服务 `inference_dimension_verify_formula`（公式验证）/ `numeric_dim_eval`（量纲感知求值）。交互面：**「确定性计算」页**（侧栏 / 首页场景卡 🧮）。

## 预期执行结果

变量单位：`F=N, m=kg, a=m/s^2, E=J, v=m/s, g=m/s^2, t=s`

| 公式 | 预期判定 | 说明 |
| --- | --- | --- |
| `F = m*a` | ✅ 一致 | `kg·m / s² == kg·m / s²`（牛顿第二定律） |
| `E = m*v` | ❌ 不一致 | 左侧 `kg·m² / s²`（动能）≠ 右侧 `kg·m / s`（动量）——典型 AI 单位错误被当场抓住 |
| `v = g*t` | ✅ 一致 | `m / s == m / s`（自由落体） |

量纲感知计算器：

| 表达式 | 预期结果 |
| --- | --- |
| `9.8 m/s^2 * 2 s` | `19.600000 m / s`（精确分数 98/5） |
| `(3 m/s) * (2 s)` | `6.00 m` |

## 验证步骤

1. 启动 evorule-server（本地 127.0.0.1:18080），console 设置 → 网络确认为本地/联网模式
2. 侧栏「🧮 确定性计算」→ ① 区已预填三公式 → 点「验证量纲」→ 对照上表
3. ② 区输入 `9.8 m/s^2 * 2 s` → 点「计算」→ 应得 `19.600000 m / s`

也可直接调服务（任何 HTTP 客户端 / MCP）：

```bash
curl -X POST http://127.0.0.1:18080/api/services/inference_dimension_verify_formula/invoke \
  -H "Content-Type: application/json" \
  -d '{"formulas":["F = m*a","E = m*v"],"si_units":{"F":"N","m":"kg","a":"m/s^2","E":"J","v":"m/s"}}'
```

## 边界

- 单位支持：SI 基本单位 + 常用导出单位（N/J/W/Pa/Hz/C/V/Ω/F）及其复合（`N·m`≡`J`、`J/m^3`≡`Pa`）；`^` 幂与 Unicode 上标（`m/s^2`≡`m/s²`）等价
- SI 词头（km/cm/µ…）暂不支持：明确报错而非静默误解
- 结果信封恒带 `status: determined` + `determinism: bitwise_replayable`
