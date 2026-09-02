<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# 场景 3 · 设备巡检告警（阈值联动 / 升级上报）

## 业务语义

产线传感器巡检判定：**温度 ≥ 80°C 触发告警并升级上报值班主管**（低于为正常）；**振动 ≥ 5 mm/s 标记异常**。两项独立判定、互不影响。

对应规则：[rules/equipment-inspection.json](./rules/equipment-inspection.json)

## 预期执行结果

提交业务指令后，判定结果写回 `payload.data.inspection`：

| 业务指令（params.sensor） | 预期输出（data.inspection） |
| --- | --- |
| 温度 83，振动 5 | `alarm_level = "escalate"` + `escalate_to = "值班主管工单队列"`，`vibration_status = "abnormal"` |
| 温度 79，振动 9 | `alarm_level = "normal"`，`vibration_status = "abnormal"` |
| 温度 76，振动 3 | `alarm_level = "normal"`，`vibration_status = "normal"` |
| 温度 80（等于阈值），振动 5 | `alarm_level = "escalate"`（规则为"低于 80 正常"，等于触发） |

## 验证步骤

1. 「执行台」→ 新建会话
2. 命令提交区粘贴业务指令：

```json
{"type":"equipment_inspection_check","params":{"sensor":{"temperature":83,"vibration":5}}}
```

3. 「状态」视图：应看到 `data.inspection.alarm_level = "escalate"` 与升级去向
4. 四组输入逐一对照上表（每组输入**新建会话**后提交；改 `temperature`/`vibration` 即可）
5. 把温度从 79 改到 80 再执行，观察告警状态的跳变——阈值是显式写在规则里的，不是黑盒
