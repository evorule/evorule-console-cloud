// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — UV-058 W2.2 治理页规则表单辅助单测
//
// 覆盖(43 号方案 W2.2 验收):
//   - 保存分层第 1 层三态:本地 error 阻断 / warning-only 放行 / 全绿放行
//   - formatIssues 面板明细格式(gate + path + message)
//   - summarizeTransformSteps 摘要预览:非法 JSON→null、合法规则步骤文本、兜底规则显式标注

import { describe, expect, test } from 'vitest';
import { formatIssues, localSaveGate, summarizeTransformSteps } from '../rule-form';

describe('W2.2 localSaveGate — 保存分层第 1 层(本地 error 阻断)', () => {
  test('非法 JSON → 阻断(G1)', () => {
    const g = localSaveGate('{"transform": [');
    expect(g.blocked).toBe(true);
    expect(g.message).toContain('G1');
    expect(g.message).toContain('未发起网络请求');
  });

  test('单数 __io_result__ → 阻断(本地即报,不等 server)', () => {
    const g = localSaveGate(
      JSON.stringify({
        transform: [
          {
            type: 'branch',
            params: {
              domain: { type: 'exists', path: '__exec__.payload.__io_result__.call_external' },
              on_true: [],
              on_false: [{ type: 'io_request', params: { io_type: 'call_external' } }]
            }
          }
        ]
      })
    );
    expect(g.blocked).toBe(true);
    expect(g.message).toContain('__io_result__');
  });

  test('域嵌套用 domains(旧口径)→ 阻断', () => {
    const g = localSaveGate(
      JSON.stringify({
        transform: [{ type: 'branch', params: { domain: { type: 'all', domains: [] }, on_true: [] } }]
      })
    );
    expect(g.blocked).toBe(true);
  });

  test('io_request 缺 io_type → 阻断(params 完备性)', () => {
    const g = localSaveGate(
      JSON.stringify({
        transform: [{ type: 'io_request', params: {} }]
      })
    );
    expect(g.blocked).toBe(true);
    expect(g.message).toContain('io_type');
  });

  test('warning-only(无兜底规则 G6)→ 放行', () => {
    const g = localSaveGate(
      JSON.stringify({
        transform: [
          {
            type: 'branch',
            params: {
              domain: { type: 'instruction', instruction_type: 'demo' },
              on_true: [{ type: 'set', params: { attr: 'data.ok', operation: 'set', value: true } }],
              on_false: []
            }
          }
          // 无末条 all(inner:[]) 兜底 → G6 warning,不阻断
        ]
      })
    );
    expect(g.blocked).toBe(false);
    expect(g.message).toBeUndefined();
  });

  test('全绿(含兜底)→ 放行', () => {
    const g = localSaveGate(
      JSON.stringify({
        rule_id: 'demo',
        transform: [
          {
            type: 'branch',
            params: {
              domain: { type: 'instruction', instruction_type: 'demo' },
              on_true: [{ type: 'set', params: { attr: 'data.ok', operation: 'set', value: true } }],
              on_false: []
            }
          },
          { type: 'branch', params: { domain: { type: 'all', inner: [] }, on_true: [] } }
        ]
      })
    );
    expect(g.blocked).toBe(false);
  });
});

describe('W2.2 formatIssues — 面板明细格式', () => {
  test('含 gate/path/message 三段', () => {
    const s = formatIssues([{ gate: 'G4', path: 'transform[0]', message: '未知域类型' }]);
    expect(s).toBe('[G4] transform[0]: 未知域类型');
  });
  test('无 path 时省略路径段', () => {
    const s = formatIssues([{ gate: 'G1', message: 'JSON 格式错误' }]);
    expect(s).toBe('[G1]: JSON 格式错误');
  });
});

describe('W2.2 summarizeTransformSteps — 摘要预览', () => {
  test('非法 JSON → null', () => {
    expect(summarizeTransformSteps('not json')).toBeNull();
  });

  test('无 transform 结构 → null', () => {
    expect(summarizeTransformSteps('{"foo": 1}')).toBeNull();
  });

  test('合法规则 → 逐步摘要(序号 + 类型 + 域)', () => {
    const s = summarizeTransformSteps(
      JSON.stringify({
        transform: [
          {
            type: 'branch',
            params: {
              domain: { type: 'instruction', instruction_type: 'equipment_check' },
              on_true: [{ type: 'set', params: { attr: 'data.alarm', operation: 'set', value: 'high' } }],
              on_false: []
            }
          },
          { type: 'branch', params: { domain: { type: 'all', inner: [] }, on_true: [] } }
        ]
      })
    );
    expect(s).not.toBeNull();
    expect(s!.map((x) => x.index)).toEqual([1, 2]);
    expect(s![0].text).toContain('branch[instruction=equipment_check]');
    expect(s![0].text).toContain('真1步/假0步');
    expect(s![1].text).toContain('兜底规则');
  });

  test('6 元指令摘要全覆盖', () => {
    const s = summarizeTransformSteps(
      JSON.stringify({
        transform: [
          { type: 'set', params: { attr: 'data.a', operation: 'set', value: 1 } },
          { type: 'push', params: { instructions: [{ type: 'demo' }] } },
          { type: 'io_request', params: { io_type: 'call_external' } },
          { type: 'collect', params: { from: 'data.items', each: { type: 'set', params: {} } } },
          { type: 'merge', params: { messages: 'data.msgs', tool_result: 'data.tr', next_instruction: {} } },
          {
            type: 'branch',
            params: {
              domain: { type: 'not', inner: [{ type: 'eq', path: 'data.x', value: 1 }] },
              on_true: [],
              on_false: []
            }
          }
        ]
      })
    );
    expect(s).not.toBeNull();
    expect(s![0].text).toBe('set data.a set 1');
    expect(s![1].text).toBe('push 1 条指令');
    expect(s![2].text).toBe('io_request(call_external)');
    expect(s![3].text).toBe('collect data.items 每项执行模板');
    expect(s![4].text).toBe('merge 消息源=data.msgs');
    expect(s![5].text).toContain('branch[not[eq data.x=1]]');
  });

  test('7 域类型摘要(has_fields/all 嵌套)', () => {
    const s = summarizeTransformSteps(
      JSON.stringify({
        transform: [
          {
            type: 'branch',
            params: {
              domain: {
                type: 'all',
                inner: [
                  { type: 'has_fields', path: 'data', fields: ['a', 'b'] },
                  { type: 'lt', path: 'data.b', value: 5 },
                  { type: 'exists', path: 'data.c' }
                ]
              },
              on_true: [],
              on_false: []
            }
          }
        ]
      })
    );
    expect(s![0].text).toContain('branch[all[3 域]]');
  });

  test('超长 value 截断(预览防溢出)', () => {
    const s = summarizeTransformSteps(
      JSON.stringify({
        transform: [{ type: 'set', params: { attr: 'data.x', operation: 'set', value: 'x'.repeat(100) } }]
      })
    );
    expect(s![0].text.length).toBeLessThan(60);
    expect(s![0].text).toContain('…');
  });
});
