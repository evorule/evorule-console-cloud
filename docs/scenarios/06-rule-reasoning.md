<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# 场景 6 · 规则集静态推理（引擎审查自己的规则）

## 业务语义

规则集越长，人眼 review 越不可靠：两条规则在不同文件里给同一字段写不同常量、规则互相读写成环——这类问题主流规则引擎留给人工。evorule 的推理服务族对**规则集本身**做确定性静态分析：冲突六型学检测、环路检测（Kahn 拓扑）、前向链仿真（合成文档迭代到不动点）。只报告、不拦截、结论 bitwise_replayable——机器出证据，人做裁决。

对应能力：原生服务 `inference_conflict_detect` / `inference_cycle_detect` / `inference_forward_simulate`（族内另有读写集提取/后向规划/效果预测/收敛检测/反事实差分/等价探针/参数扫描）。

## 演示 A · 规则抓雷（冲突检测）

两条规则各自成立、放在一起打架：

```json
{"type":"set","params":{"attr":"__exec__.payload.data.discount","operation":"set","value":10}}
{"type":"set","params":{"attr":"__exec__.payload.data.discount","operation":"set","value":20}}
```

预期输出（人话报告）：

- `has_conflicts: true`
- `conflict_type: "contradictory_constants"`
- `description: "规则 rules/vip.json#0 与 rules/staff.json#1 域可能同时满足且都写 'payload.data.discount' 但赋予不同常量: 10 vs 20"`

## 演示 B · 环路检测

两条规则互读互写（`x←y` 与 `y←x`）：

- `has_cycles: true`，`static_cycles: [["rules/a.json#0", "rules/b.json#1"]]`
- `unsafe_rules` 列出环上全部规则（拓扑排序不可用）

## 演示 C · 前向仿真（上线前彩排）

VIP 分支定价规则 + 初始文档 `{"payload":{"data":{"is_vip":true}}}`：

- `final_document: {"payload":{"data":{"is_vip":true,"price":80}}}`
- `reached_fixed_point: true`，`stopped_reason: "fixpoint"`
- 附诚实域声明：`simulation_scope: "合成文档仿真:无 I/O 响应/无并发/无治理面干预,不动点≠真实系统行为"`

## 验证步骤

```bash
curl -X POST http://127.0.0.1:18080/api/services/inference_conflict_detect/invoke \
  -H "Content-Type: application/json" \
  -d '{"rules":[{"type":"set","params":{"attr":"__exec__.payload.data.discount","operation":"set","value":10}},{"type":"set","params":{"attr":"__exec__.payload.data.discount","operation":"set","value":20}}],"sources":["rules/vip.json","rules/staff.json"]}'
```

## 契约要点（接入必读）

- `rules` 为**合并指令列表**：元素是 transform 指令本身（非规则文件包装）
- `sources` 与 `rules` 等长；来源标签 `core_eval` = 宪法段（豁免分析）
- `inference_forward_simulate` 的 `initial_document` **不带** `__exec__` 前缀（仿真器自建执行文档）
