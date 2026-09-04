// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 治理页规则模板脚手架(UV-058 W2.3/W2.4)
//
// 职责(43 号方案):
//   - W2.3 模板下拉资产:空白骨架 + 4 场景(静态内嵌副本)
//   - W2.3 覆盖确认判定:已手改 rule_body 后再选模板 → 显式确认,不静默清空
//   - W2.4 编辑新版本预填:条目 → 表单初值(entry_id 原值 / version+1 / rule_body pretty-print)
//
// ⚠️ 同步纪律(风险登记"模板与 assets 场景文件演进脱节"的缓解):
//   4 场景的 transform/description 为 assets/evorule-rules/scenario-*.json 的静态内嵌副本,
//   源文件变更时必须同步本文件(源头路径标在各模板 sourceFile 字段)。
//   已知差异:场景资产 metadata.sections 声称"noop 收尾规则",但源 transform 无末条兜底
//   (资产侧漂移,已登记台账);故场景模板在治理表单会触发 G6 warning(不阻断,如实提示)。

/** 治理页规则模板(W2.3 表单顶部下拉) */
export interface RuleTemplate {
  /** 下拉 value */
  id: string;
  /** 下拉显示名 */
  label: string;
  /** 预填 entry_id(空白骨架留空,由治理员填写) */
  entryId: string;
  /** 预填 domain */
  domain: string;
  /** 场景说明(下拉 title / 表单提示) */
  description: string;
  /** 填充 rule_body 的完整 JSON 文本(精简形状 {rule_id, version, description, transform}) */
  ruleBody: string;
  /** 内嵌副本的源头文件路径(同步纪律锚点) */
  sourceFile?: string;
}

/** 空白骨架:instruction 谓词 branch + 双分支 set 示例 + 末条 all(inner:[]) 兜底(最佳实践引导,删改自由) */
const BLANK_BODY = {
  rule_id: 'my-rule',
  version: 1,
  description: '规则说明:匹配什么业务指令,做什么决策',
  transform: [
    {
      type: 'branch',
      params: {
        domain: { type: 'instruction', instruction_type: 'my_command' },
        on_true: [
          {
            type: 'branch',
            params: {
              domain: { type: 'exists', path: '__exec__.payload.data.some_field' },
              on_true: [
                { type: 'set', params: { attr: 'data.decision', operation: 'set', value: 'hit' } }
              ],
              on_false: [
                { type: 'set', params: { attr: 'data.decision', operation: 'set', value: 'miss' } }
              ]
            }
          }
        ],
        on_false: []
      }
    },
    {
      type: 'branch',
      params: {
        domain: { type: 'all', inner: [] },
        on_true: [
          { type: 'set', params: { attr: 'data.result', operation: 'set', value: '未匹配' } }
        ],
        on_false: []
      }
    }
  ]
};

/** 场景模板组装:精简形状 {rule_id, version, description, transform}(剥离 $schema/kind/id/metadata 封装) */
function scenarioBody(
  ruleId: string,
  description: string,
  transform: unknown[]
): string {
  return JSON.stringify({ rule_id: ruleId, version: 1, description, transform }, null, 2);
}

/** 模板清单:空白骨架 + 4 场景(源:assets/evorule-rules/,静态内嵌副本 2026-09-04) */
export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'blank',
    label: '空白骨架(最佳实践引导)',
    entryId: '',
    domain: '',
    description: 'instruction 谓词 branch + 双分支 set 示例 + 末条 all(inner:[]) 兜底,删改自由',
    ruleBody: JSON.stringify(BLANK_BODY, null, 2)
  },
  {
    id: 'equipment-inspection',
    label: '设备巡检告警',
    entryId: 'scenario.equipment_inspection',
    domain: 'equipment',
    description: '温度 ≥ 80 升级告警;振动 ≥ 5 判异常',
    ruleBody: scenarioBody(
      'scenario.equipment_inspection',
      '设备巡检分级 — 提交业务指令 equipment_inspection_check：温度 ≥ 80 升级告警；振动 ≥ 5 判异常',
      [
        {
          type: 'branch',
          params: {
            domain: { type: 'instruction', instruction_type: 'equipment_inspection_check' },
            on_true: [
              { type: 'set', params: { attr: 'data', operation: 'set', value: '__exec__.instruction.params' } },
              {
                type: 'branch',
                params: {
                  domain: { type: 'lt', path: '__exec__.payload.data.sensor.temperature', value: 80 },
                  on_true: [
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.inspection.alarm_level', operation: 'set', value: 'normal' }
                    }
                  ],
                  on_false: [
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.inspection.alarm_level', operation: 'set', value: 'escalate' }
                    },
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.inspection.escalate_to', operation: 'set', value: '值班主管工单队列' }
                    }
                  ]
                }
              },
              {
                type: 'branch',
                params: {
                  domain: { type: 'lt', path: '__exec__.payload.data.sensor.vibration', value: 5 },
                  on_true: [
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.inspection.vibration_status', operation: 'set', value: 'normal' }
                    }
                  ],
                  on_false: [
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.inspection.vibration_status', operation: 'set', value: 'abnormal' }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    ),
    sourceFile: 'assets/evorule-rules/scenario-equipment-inspection.json'
  },
  {
    id: 'expense-compliance',
    label: '报销合规检查',
    entryId: 'scenario.expense_compliance',
    domain: 'finance',
    description: '复审印发票拒绝;低于 5000 自动通过;否则需主管审批',
    ruleBody: scenarioBody(
      'scenario.expense_compliance',
      '报销合规判定 — 提交业务指令 expense_compliance_check：复审印发票拒绝；低于 5000 自动通过；否则需主管审批',
      [
        {
          type: 'branch',
          params: {
            domain: { type: 'instruction', instruction_type: 'expense_compliance_check' },
            on_true: [
              { type: 'set', params: { attr: 'data', operation: 'set', value: '__exec__.instruction.params' } },
              {
                type: 'branch',
                params: {
                  domain: { type: 'eq', path: '__exec__.payload.data.invoice.duplicate', value: true },
                  on_true: [
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.expense.decision', operation: 'set', value: 'rejected' }
                    },
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.expense.reject_reason', operation: 'set', value: '发票重复：同一发票号已存在报销记录' }
                    }
                  ],
                  on_false: [
                    {
                      type: 'branch',
                      params: {
                        domain: { type: 'lt', path: '__exec__.payload.data.expense.amount', value: 5000 },
                        on_true: [
                          {
                            type: 'set',
                            params: { attr: '__exec__.payload.data.expense.decision', operation: 'set', value: 'auto_approved' }
                          }
                        ],
                        on_false: [
                          {
                            type: 'set',
                            params: { attr: '__exec__.payload.data.expense.decision', operation: 'set', value: 'manager_approval_needed' }
                          },
                          {
                            type: 'set',
                            params: { attr: '__exec__.payload.data.expense.escalate_to', operation: 'set', value: '部门主管审批队列' }
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    ),
    sourceFile: 'assets/evorule-rules/scenario-expense-compliance.json'
  },
  {
    id: 'contract-payment-guard',
    label: '合同付款门禁',
    entryId: 'scenario.contract_payment_guard',
    domain: 'contract',
    description: '合同已签 + 审批单在 + 金额低于 10 万放行,否则阻断并留痕',
    ruleBody: scenarioBody(
      'scenario.contract_payment_guard',
      '合同付款门禁 — 提交业务指令 contract_payment_check：合同已签 + 审批单在 + 金额低于 10 万放行，否则阻断并留痕',
      [
        {
          type: 'branch',
          params: {
            domain: { type: 'instruction', instruction_type: 'contract_payment_check' },
            on_true: [
              { type: 'set', params: { attr: 'data', operation: 'set', value: '__exec__.instruction.params' } },
              {
                type: 'branch',
                params: {
                  domain: {
                    type: 'all',
                    inner: [
                      { type: 'eq', path: '__exec__.payload.data.contract.signed', value: true },
                      { type: 'exists', path: '__exec__.payload.data.approval_id' },
                      { type: 'lt', path: '__exec__.payload.data.payment.amount', value: 100000 }
                    ]
                  },
                  on_true: [
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.payment.status', operation: 'set', value: 'approved' }
                    }
                  ],
                  on_false: [
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.payment.status', operation: 'set', value: 'blocked' }
                    },
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.payment.block_reason', operation: 'set', value: '付款前提缺失：需合同已签 + 审批单存在 + 金额低于 100000' }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    ),
    sourceFile: 'assets/evorule-rules/scenario-contract-payment-guard.json'
  },
  {
    id: 'ai-mfa-gate',
    label: 'AI 合规门禁',
    entryId: 'scenario.ai_mfa_gate',
    domain: 'security',
    description: 'AI Agent 发起资金操作但未通过 MFA → 阻断 + 审计留痕',
    ruleBody: scenarioBody(
      'scenario.ai_mfa_gate',
      'AI 合规门禁 — 提交业务指令 ai_mfa_gate_check：AI Agent 发起资金操作但未通过 MFA → 阻断 + 审计留痕',
      [
        {
          type: 'branch',
          params: {
            domain: { type: 'instruction', instruction_type: 'ai_mfa_gate_check' },
            on_true: [
              { type: 'set', params: { attr: 'data', operation: 'set', value: '__exec__.instruction.params' } },
              {
                type: 'branch',
                params: {
                  domain: { type: 'eq', path: '__exec__.payload.data.request.mfa_verified', value: true },
                  on_true: [
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.request.gate_decision', operation: 'set', value: 'allowed' }
                    }
                  ],
                  on_false: [
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.request.gate_decision', operation: 'set', value: 'blocked' }
                    },
                    {
                      type: 'set',
                      params: { attr: '__exec__.payload.data.request.gate_note', operation: 'set', value: '等保 2.0 三级 §8.1.4.1.d：资金类操作需先通过 MFA 验证，已阻断并留痕' }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    ),
    sourceFile: 'assets/evorule-rules/scenario-ai-mfa-gate.json'
  }
];

/**
 * W2.3 覆盖确认判定:rule_body 已有内容(手改或前次填充)时再选模板,
 * 需显式确认覆盖——不静默清空用户输入。
 */
export function shouldConfirmTemplateOverwrite(currentRuleBody: string): boolean {
  return currentRuleBody.trim() !== '';
}

/** W2.4 编辑新版本表单初值 */
export interface EditPrefill {
  entry_id: string;
  version: number;
  domain: string;
  /** 当前 rule_body 的 pretty-print 文本 */
  rule_body: string;
}

/**
 * W2.4 编辑新版本预填:条目 → 表单初值。
 * entry_id 原值、version+1(入库走既有 addEntry 同 entry_id 新版本,版本链/diff 自然承接)。
 * rule_body pretty-print:对象 → stringify(2);字符串 → 尝试解析重排,失败原样保留(不静默改写)。
 */
export function prefillFromEntry(entry: {
  entry_id: string;
  version: number;
  domain?: string;
  rule_body: unknown;
}): EditPrefill {
  let body: string;
  if (typeof entry.rule_body === 'string') {
    try {
      body = JSON.stringify(JSON.parse(entry.rule_body), null, 2);
    } catch {
      body = entry.rule_body;
    }
  } else {
    body = JSON.stringify(entry.rule_body, null, 2);
  }
  return {
    entry_id: entry.entry_id,
    version: entry.version + 1,
    domain: entry.domain ?? '',
    rule_body: body
  };
}
