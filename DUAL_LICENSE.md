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

# evorule-console-cloud 双重许可说明

**版本**：1.0
**生效日期**：2026-08-03
**适用范围**：evorule-console-cloud（EvoRule 生态产品，云端版）

---

## 概述

evorule-console-cloud 采用**双轨许可模式**，为不同用户提供灵活选择：

1. **AGPL-3.0-or-later 开源许可** — 免费使用，适合开源项目和个人开发者
2. **商业许可** — 付费使用，适合企业闭源产品和商业应用

---

## 与 evorule-console 内核的关系

evorule-console-cloud 是 **evorule-console（内核）的衍生产品**，定位为“**面向二次开发者的专业起点**”（联网 + 云 LLM）。两者关系如下：

- **内核关系**：evorule-console-cloud 内联 evorule-console 内核快照（`src/lib/kernel/`，取自内核 v0.2.0，AGPL-3.0-or-later），在此之上扩展云端能力（联网检索、云 LLM 接入等），无 npm 依赖。
- **许可独立性**：evorule-console-cloud 拥有**独立的商业许可策略**。本文件约束 evorule-console-cloud 仓本身，与内核仓（evorule-console）的商业许可**相互独立**。
- **传染性边界**：内联的 `src/lib/kernel/` 快照沿用内核的 AGPL-3.0-or-later 许可，不适用本仓商业许可豁免；对快照之外本仓自有代码的修改，受本仓 AGPL-3.0-or-later 或商业许可约束。
- **衍生作品**：基于 evorule-console-cloud 二次开发的衍生作品，适用本仓的双重许可条款。

> 简言之：**内核快照归 AGPL，云端自有代码归双许可**。二次开发者只需关注 evorule-console-cloud 仓的许可；修改内核快照（`src/lib/kernel/`）须遵守 AGPL-3.0-or-later。

---

## AGPL-3.0-or-later 开源许可

### 适用场景

- ✅ 开源项目（必须同样采用 AGPL-3.0 或兼容许可证）
- ✅ 个人学习和研究
- ✅ 内部工具（不对外提供服务）
- ✅ 教育用途
- ✅ 非营利公益项目

### 主要义务

根据 AGPL-3.0-or-later 许可证，如果您：

- 修改了 evorule-console-cloud 代码
- 通过网络向用户提供服务

则您必须：

- 公开您的源代码（包括修改部分）
- 提供获取源代码的方式
- 保留原始版权声明和许可证

### 限制

- ❌ 不能将 evorule-console-cloud 用于闭源商业产品
- ❌ 不能在 SaaS 服务中使用而不公开源代码
- ❌ 不能移除或修改版权声明

---

## 商业许可

### 适用场景

- ✅ 企业闭源产品
- ✅ SaaS 服务（无需公开源代码）
- ✅ 商业软件集成
- ✅ 专有系统开发
- ✅ 需要技术支持和 SLA 保障

### 主要优势

- 🔒 **无需公开源代码** — 您可以在闭源产品中使用
- **无 AGPL 传染性** — 您的代码不受 AGPL 约束
- **商业友好** — 适合企业级应用
- **法律保护** — 获得明确的商业使用授权
- **技术支持** — 可选的技术支持和咨询服务

### 定价方案

| 方案 | 价格 | 适用对象 |
|---|---|---|
| 初创企业 | 联系询价 | 年收入 < $1M 的公司 |
| 中小企业 | 联系询价 | 年收入 $1M-$10M 的公司 |
| 大型企业 | 联系询价 | 年收入 > $10M 的公司 |
| 教育机构 | 优惠价格 | 学校和科研机构 |
| 非营利组织 | **免费**（申请）| 见 [FREE_COMMERCIAL_LICENSE.md](FREE_COMMERCIAL_LICENSE.md) |

**联系方式**：<evorulelab@gmail.com>

---

## 常见问题

### Q1：我可以在公司内部使用 AGPL 版本吗？

**A**：可以。如果您的内部工具不对外部用户提供服务，可以使用 AGPL 版本而无需公开代码。但如果通过 Web 界面向员工提供服务，从严格的 AGPL 解释角度，可能需要公开代码。建议企业内部使用选择商业许可以避免法律风险。

### Q2：商业许可是否包含技术支持？

**A**：基础商业许可不包含技术支持，但可以购买额外的支持套餐。详情请咨询销售团队。

### Q3：我可以从 AGPL 升级到商业许可吗？

**A**：可以。您可以随时从 AGPL 切换到商业许可，只需联系销售团队即可。

### Q4：商业许可是永久的还是订阅制？

**A**：我们提供两种选项：

- **永久许可** — 一次性付费，永久使用该版本
- **订阅许可** — 年费制，包含所有更新和技术支持

### Q5：自由职业者 / 个人开发者需要商业许可吗？

**A**：不需要。如果您是个人使用、学习、内部工具，AGPL-3.0 即可。如果您把基于 evorule-console-cloud 的服务卖给客户，**才**需要商业许可。

### Q6：evorule-console-cloud 与 evorule-console 内核是什么关系？商业许可如何适用？未来高级版怎么办？

**A**：evorule-console-cloud 是 evorule-console（内核）的衍生产品，通过 `@evorule/console` npm 包依赖内核，但拥有**独立的商业许可策略**。本文件只约束 evorule-console-cloud 仓本身，与内核仓的商业许可相互独立——购买云端版商业许可不等于获得内核商业许可，反之亦然。未来推出的“高级版”将是 evorule-console-cloud 的进一步衍生，届时会另行发布其专属商业许可说明，本文件不适用于高级版。

---

## 联系方式

- **销售咨询**：<evorulelab@gmail.com>
- **技术支持**：<evorulelab@gmail.com>（同邮箱）
- **官方网站**：<https://gitee.com/evorule/evorule-console-cloud>
- **Gitee 组织**：<https://gitee.com/evo-rule-lab>

---

## 法律声明

本文档**不构成法律建议**。如有法律疑问，请咨询专业律师。

evorule-console-cloud 的知识产权归 EvoRule Project 所有。

---

## 版本历史

| 版本 | 日期 | 变更说明 |
|---|---|---|
| 1.0 | 2026-08-03 | 初版，适配 evorule-console-cloud v0.1.0 |

---

*本说明遵循 EvoRule Project 的发布原则。*
