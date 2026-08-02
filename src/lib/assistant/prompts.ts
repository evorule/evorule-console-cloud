// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM 三用途 prompt 模板
//
// 设计原则:
//   - 强约束 LLM 输出纯 JSON(规则草案 / 测试输入),便于机器解析
//   - 注入 evorule 规则格式说明(7 大门禁约束),让 LLM 知道边界
//   - 三用途共享同一份"规则格式说明",减少 token 浪费
//   - 不暴露 apiKey/敏感信息到 prompt

/**
 * evorule 规则格式说明(注入所有 LLM prompt)。
 *
 * 这份说明让 LLM 知道规则 schema,产出的草案更可能通过 RuleValidator。
 * 注意:这只是引导,不替代 RuleValidator 的硬性校验。
 */
export const EVORULE_RULE_SPEC = `evorule 规则格式(JSON):

顶层结构: { "transform": [规则1, 规则2, ..., 兜底规则] }

每条规则是一个对象,字段:
  - type: 元指令,取值 "set" | "push" | "branch" | "io_request"
  - params: 参数对象,因 type 而异
  - comment?: 可选注释字符串

各 type 的 params:
  - set:    { path: "__exec__.payload.<字段>", value: <值> }
            (路径必须以 __exec__.payload. 或 __exec__.instruction. 开头)
  - push:   { path: "__exec__.queue", value: <指令对象> }
  - branch: { domain: <域>, on_true: [子规则数组], on_false: [子规则数组] }
  - io_request: { request: <IO请求对象>, on_result: [子规则数组] }
                (io_request 必须放在 type='branch' 且 domain 检查 __io_result__ 的子规则中)

域(domain)类型:
  - eq:        { type: "eq", path: "__exec__.instruction.<字段>", value: <值> }
  - lt:        { type: "lt", path: "__exec__.instruction.<字段>", value: <值> }
  - exists:    { type: "exists", path: "<__前缀路径>" }
  - instruction: { type: "instruction" }  (匹配任何指令)
  - all:       { type: "all", domains: [<域数组>] }    (全部满足)
  - not:       { type: "not", domain: <域> }            (取反)

硬约束(违反将无法通过校验):
  G1: 必须是合法 JSON
  G2: type 必须是 set/push/branch/io_request 之一
  G3: io_request 必须在 exists(__io_result__) 的 branch.on_true 内
  G4: domain.type 必须是 eq/lt/exists/instruction/all/not 之一
  G5: __ 前缀路径必须以 __exec__.payload. / __exec__.instruction. / __exec__.queue 开头,
      或字面量 __io_result__
  G6: transform 数组最后一条必须是 branch + all([]) 兜底规则
  G7: 递归深度 ≤ 64 层

兜底规则示例(必须放在 transform 最后一条):
  { "type": "branch", "params": { "domain": { "type": "all", "domains": [] },
    "on_true": [{ "type": "set", "params": { "path": "__exec__.payload.result", "value": "未匹配" } }],
    "on_false": [] } }

完整示例(匹配指令 type=register,给 user 字段赋值):
  {
    "transform": [
      {
        "type": "branch",
        "params": {
          "domain": { "type": "eq", "path": "__exec__.instruction.type", "value": "register" },
          "on_true": [
            { "type": "set", "params": { "path": "__exec__.payload.status", "value": "ok" } }
          ],
          "on_false": []
        }
      },
      {
        "type": "branch",
        "params": {
          "domain": { "type": "all", "domains": [] },
          "on_true": [{ "type": "set", "params": { "path": "__exec__.payload.result", "value": "未知指令" } }],
          "on_false": []
        }
      }
    ]
  }`;

/**
 * 用途1: 自然语言 → JSON 规则草案。
 *
 * 用户用自然语言描述想要的规则,LLM 输出符合 evorule 格式的 JSON 草案。
 * 用户审核 + RuleValidator 校验后才生效,不自动执行。
 */
export function promptGenerateRuleDraft(naturalLanguage: string): string {
	return `你是规则设计助手。请把以下自然语言描述转换为 evorule 规则 JSON。

${EVORULE_RULE_SPEC}

用户描述:
"""
${naturalLanguage}
"""

要求:
1. 输出严格的 JSON(无注释、无 markdown 代码块包裹、无前后说明文字)
2. 必须满足所有硬约束 G1-G7
3. 最后一条必须是兜底规则(G6)
4. 路径必须使用正确的 __ 前缀(G5)
5. 如果用户描述不明确,按合理默认值填充,不要拒绝

只输出 JSON 本身,不要解释,不要 markdown:`;
}

/**
 * 用途2: JSON 规则 → 自然语言说明(只读,不改规则)。
 *
 * 给定 JSON 规则,LLM 用通俗易懂的语言解释这条规则做什么。
 * 用于业务专家理解规则含义。
 */
export function promptExplainRule(ruleJson: string): string {
	return `你是规则解释助手。请用通俗易懂的中文解释以下 evorule 规则 JSON 做什么。

${EVORULE_RULE_SPEC}

规则 JSON:
"""
${ruleJson}
"""

要求:
1. 用普通用户能理解的语言(避免术语)
2. 说明这条规则会匹配什么指令、做什么操作
3. 如果有 io_request,说明会等待 IO 输入
4. 如果有兜底规则,说明未匹配时会发生什么
5. 不要输出 JSON,只输出说明文字
6. 简洁清晰,3-5 句话即可

说明:`;
}

/**
 * 用途3: 自然语言 → 测试输入 JSON(辅助填表)。
 *
 * 用户用自然语言描述想要的测试输入,LLM 输出符合 evorule instruction 格式的 JSON。
 * 用户审核后才填入执行面板,不自动执行。
 */
export function promptGenerateInput(description: string): string {
	return `你是测试输入助手。请把以下自然语言描述转换为 evorule 测试输入 JSON。

evorule 测试输入(instruction)是一个 JSON 对象,字段由业务规则匹配。
常见字段:type(指令类型)、payload(数据对象)等。

用户描述:
"""
${description}
"""

要求:
1. 输出严格的 JSON 对象(无注释、无 markdown 代码块包裹)
2. 字段名用蛇形/snake_case(如 user_id 而非 userId)
3. 数值类型用数字,日期用 ISO 8601 字符串
4. 如果描述不明确,按合理默认值填充
5. 不要输出说明文字,只输出 JSON

只输出 JSON 本身:`;
}

/**
 * 用途4(测试连接): 简单 ping,不产生实际草案。
 * 用最少 token 验证 apiKey/endpoint/model 可用。
 */
export function promptTestConnection(): string {
	return `请回复"OK"(只输出这两个字符,不要其他内容)。`;
}
