<!--
  Copyright 2026 EvoRule Project

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <https://www.gnu.org/licenses/>.

  SPDX-License-Identifier: AGPL-3.0-or-later
-->

# evorule-console-cloud — 声明

**版权所有 (c) 2026 EvoRule Project**

本仓库包含由 EvoRule Project 开发的 evorule-console-cloud 软件（evorule 规则引擎面板 · 联网大众版）。

## 许可

| 资产 | 协议 | 说明 |
| --- | --- | --- |
| **evorule-console-cloud 代码** | AGPL-3.0-or-later | 详见 [LICENSE](LICENSE)；商业许可见 [DUAL_LICENSE.md](DUAL_LICENSE.md) |

evorule-console-cloud 全部代码资产统一采用 AGPL-3.0-or-later，可通过商业许可豁免（详见 [DUAL_LICENSE.md](DUAL_LICENSE.md)）。

## 与 evorule-console 的关系

evorule-console-cloud 是 [evorule-console](https://gitee.com/evo-rule-lab/evorule-console) 的**衍生产品**，二者关系：

| 维度 | evorule-console（内核） | evorule-console-cloud（大众版） |
| --- | --- | --- |
| 定位 | 规则引擎面板内核（无 LLM、不绑定网络栈） | 二次开发者专业起点（联网 + 云 LLM） |
| 依赖 | 无外部 evorule 仓依赖 | `@evorule/console` v0.1.1（npm 依赖） |
| 联网 | ❌ 仅开发期 loopback | ✅ 联网/离线双模式（CloudHttpBackend） |
| LLM | ❌ 无 LLM 扩展槽实现 | ✅ 云 LLM（OpenAI 兼容协议，多厂商预设） |
| 代码修改 | — | **不修改内核**，通过 `provideBackend()` / `provideAssistant()` 扩展槽注入 |
| 版本 | 独立 semver | 独立 semver |
| 许可 | 独立 | 独立（沿用双许可架构） |

**关键边界**：evorule-console-cloud 不复用 evorule-console 的代码，而是通过 npm 依赖 `@evorule/console` 包，在运行时通过扩展槽注入联网后端与云 LLM 助手。二者各自独立建仓、独立许可、独立版本。

## 设计原则

evorule-console-cloud 遵循 EvoRule 项目的核心设计原则：

- 规则即数据（可读、可审计、可序列化）
- 自解释引擎（前端只展示，执行在后端，0 依赖可信）
- 完全可追溯（每次状态变化留下因果链）
- 零隐藏逻辑（规则用 JSON 表达，可读可审计）
- 不可变状态（基于不可变数据结构）
- 确定性执行（相同输入 = 永远相同输出）
- **LLM 是辅助层，不参与确定性执行**（大众版独有原则）

## 联系信息

- **项目**: evorule-console-cloud — evorule 规则引擎面板 · 联网大众版
- **作者**: EvoRule Project
- **邮箱**: <evorulelab@gmail.com>
- **组织**: [EvoRule Lab](https://gitee.com/evo-rule-lab)
- **Gitee**: <https://gitee.com/evo-rule-lab/evorule-console-cloud>
