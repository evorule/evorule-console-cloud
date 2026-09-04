// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — UV-058 W2.3/W2.4 治理页模板脚手架 + 编辑入口单测
//
// 覆盖(43 号方案 W2.3+W2.4 验收):
//   - 模板清单:空白骨架 + 4 场景(共 5 项),rule_body 均为合法 JSON 且通过本地校验
//   - 空白骨架含最佳实践引导(instruction 谓词 + 双分支 set + 末条 all(inner:[]) 兜底)
//   - 场景模板预填 entry_id/domain;空白骨架不预填
//   - 覆盖确认判定:空输入不确认,已有内容需确认
//   - 编辑新版本预填:entry_id 原值 / version+1 / rule_body pretty-print(对象与字符串两种形态)

import { describe, expect, test } from 'vitest';
import {
  RULE_TEMPLATES,
  shouldConfirmTemplateOverwrite,
  prefillFromEntry
} from '../rule-templates';
import { RuleValidator } from '$lib/kernel/validators/ruleValidator';
import { summarizeTransformSteps } from '../rule-form';

describe('W2.3 模板清单', () => {
  test('空白骨架 + 4 场景,共 5 项', () => {
    expect(RULE_TEMPLATES.length).toBe(5);
    expect(RULE_TEMPLATES[0].id).toBe('blank');
    expect(RULE_TEMPLATES.map((t) => t.id)).toEqual([
      'blank',
      'equipment-inspection',
      'expense-compliance',
      'contract-payment-guard',
      'ai-mfa-gate'
    ]);
  });

  test('所有模板 rule_body 均为合法 JSON 且本地校验无 error', () => {
    for (const t of RULE_TEMPLATES) {
      const r = RuleValidator.validate(t.ruleBody);
      expect(r.valid, `${t.id} 应无 error:${JSON.stringify(r.errors)}`).toBe(true);
    }
  });

  test('空白骨架含最佳实践引导:instruction 谓词 + 双分支 + 末条 all(inner:[]) 兜底', () => {
    const blank = RULE_TEMPLATES[0];
    const body = JSON.parse(blank.ruleBody);
    const transform = body.transform as Array<{ type: string; params: Record<string, unknown> }>;
    // 首条:instruction 谓词分支,含 on_true/on_false 双分支
    expect(transform[0].type).toBe('branch');
    expect((transform[0].params.domain as Record<string, unknown>).type).toBe('instruction');
    expect(Array.isArray(transform[0].params.on_true)).toBe(true);
    expect(Array.isArray(transform[0].params.on_false)).toBe(true);
    // 末条:all(inner:[]) 兜底
    const last = transform[transform.length - 1];
    const lastDomain = last.params.domain as Record<string, unknown>;
    expect(lastDomain.type).toBe('all');
    expect(lastDomain.inner).toEqual([]);
    // 空白骨架不预填 entry_id/domain(由治理员自填)
    expect(blank.entryId).toBe('');
    expect(blank.domain).toBe('');
  });

  test('场景模板预填 entry_id/domain,源文件路径已标注(同步纪律锚点)', () => {
    const scenarios = RULE_TEMPLATES.filter((t) => t.id !== 'blank');
    expect(scenarios.length).toBe(4);
    for (const t of scenarios) {
      expect(t.entryId).toMatch(/^scenario\./);
      expect(t.domain).not.toBe('');
      expect(t.sourceFile).toMatch(/^assets\/evorule-rules\/scenario-.*\.json$/);
    }
  });

  test('场景模板与源资产口径一致:rule_id 进 rule_body 精简形状,transform 可提取摘要', () => {
    const equip = RULE_TEMPLATES.find((t) => t.id === 'equipment-inspection')!;
    const body = JSON.parse(equip.ruleBody);
    expect(body.rule_id).toBe('scenario.equipment_inspection');
    expect(body.version).toBe(1);
    expect(typeof body.description).toBe('string');
    const steps = summarizeTransformSteps(equip.ruleBody);
    expect(steps).not.toBeNull();
    expect(steps![0].text).toContain('instruction=equipment_inspection_check');
  });

  test('场景模板无末条兜底 → G6 warning(不阻断,资产侧已知形态,如实提示)', () => {
    const equip = RULE_TEMPLATES.find((t) => t.id === 'equipment-inspection')!;
    const r = RuleValidator.validate(equip.ruleBody);
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.gate === 'G6')).toBe(true);
  });
});

describe('W2.3 覆盖确认判定(不静默清空用户输入)', () => {
  test('空输入 → 无需确认,直接填充', () => {
    expect(shouldConfirmTemplateOverwrite('')).toBe(false);
    expect(shouldConfirmTemplateOverwrite('   \n  ')).toBe(false);
  });
  test('已有内容(手改或前次填充)→ 需确认', () => {
    expect(shouldConfirmTemplateOverwrite('{"transform": []}')).toBe(true);
  });
});

describe('W2.4 编辑新版本预填', () => {
  test('对象形态 rule_body:entry_id 原值 / version+1 / domain / pretty-print', () => {
    const p = prefillFromEntry({
      entry_id: 'scenario.demo',
      version: 3,
      domain: 'finance',
      rule_body: { rule_id: 'demo', transform: [{ type: 'branch', params: { domain: { type: 'all', inner: [] }, on_true: [] } }] }
    });
    expect(p.entry_id).toBe('scenario.demo');
    expect(p.version).toBe(4);
    expect(p.domain).toBe('finance');
    // pretty-print:2 空格缩进
    expect(p.rule_body).toContain('\n  "rule_id"');
    // 回灌后仍可通过本地校验
    expect(RuleValidator.validate(p.rule_body).valid).toBe(true);
  });

  test('字符串形态 rule_body:合法 JSON 字符串重排;非法字符串原样保留(不静默改写)', () => {
    const ok = prefillFromEntry({
      entry_id: 'a',
      version: 1,
      rule_body: '{"transform":[{"type":"branch","params":{"domain":{"type":"all","inner":[]},"on_true":[]}}]}'
    });
    expect(ok.rule_body).toContain('\n  "transform"');
    const bad = prefillFromEntry({ entry_id: 'b', version: 1, rule_body: 'not-json' });
    expect(bad.rule_body).toBe('not-json');
  });

  test('domain 缺省 → 空串(表单可编辑补填)', () => {
    const p = prefillFromEntry({ entry_id: 'c', version: 1, rule_body: {} });
    expect(p.domain).toBe('');
  });
});
