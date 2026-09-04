// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// ruleValidator 黄金向量测试(UV-074 / UV-058 W2.1)
//
// 对齐权威:evorule-server core/rule_schema/schemas/_shared/v1.0.json(固化版)
// — 7 域类型(含 has_fields)、inner 嵌套(禁 domains/domain,P0-03)、
//   path 正则(拒绝空段/缺闭合/空索引/非数字索引/索引后拼接/单数 __io_result__,P1-03)、
//   6 元指令 params 完备性、G6 兜底降为 warning、G3 双路径降为 warning
// 正反例移植自 _shared/v1.0.json 各 $defs 描述与 rule_schema 测试语义。

import { describe, expect, test } from 'vitest';
import { RuleValidator } from '../ruleValidator';

/** 便捷:校验 JSON 字符串并断言 valid */
function v(json: string) {
  return RuleValidator.validate(json);
}

describe('G0/G1 结构与格式', () => {
  test('非法 JSON → G1 error', () => {
    const r = v('{not valid json}');
    expect(r.valid).toBe(false);
    expect(r.errors[0].gate).toBe('G1');
  });

  test('无可识别结构({foo:1}) → G0 error', () => {
    const r = v('{"foo": 1}');
    expect(r.valid).toBe(false);
    expect(r.errors[0].gate).toBe('G0');
  });

  test('空 transform 数组 → G0 error(TCB 非空约束)', () => {
    const r = v('{"transform": []}');
    expect(r.valid).toBe(false);
    expect(r.errors[0].gate).toBe('G0');
  });

  test('顶层数组形态可识别(server 归一化口径)', () => {
    const r = v('[{"type":"set","params":{"attr":"data","operation":"set","value":1}}]');
    expect(r.valid).toBe(true);
  });

  test('单条对象形态可识别(包装为数组)', () => {
    const r = v('{"type":"set","params":{"attr":"data","operation":"set","value":1}}');
    expect(r.valid).toBe(true);
  });
});

describe('G2 元指令与 params 完备性', () => {
  test('noop 不是元指令(P0-01:指令层类型不得出现在元指令层) → G2', () => {
    const r = v('{"transform":[{"type":"noop","params":{}}]}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G2')).toBe(true);
  });

  test('set 缺 value → G2(引擎 exec_set MissingField)', () => {
    const r = v('{"transform":[{"type":"set","params":{"attr":"data","operation":"set"}}]}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G2' && e.message.includes('value'))).toBe(true);
  });

  test('set.operation 非法枚举 → G2', () => {
    const r = v(
      '{"transform":[{"type":"set","params":{"attr":"data","operation":"assign","value":1}}]}'
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G2' && e.message.includes('operation'))).toBe(true);
  });

  test('io_request 缺 io_type → G2', () => {
    const r = v('{"transform":[{"type":"io_request","params":{"prompt":"hi"}}]}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G2' && e.message.includes('io_type'))).toBe(true);
  });

  test('branch 缺 on_true → G2', () => {
    const r = v(
      '{"transform":[{"type":"branch","params":{"domain":{"type":"exists","path":"data.x"}}}]}'
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G2' && e.message.includes('on_true'))).toBe(true);
  });

  test('collect 缺 each → G2', () => {
    const r = v('{"transform":[{"type":"collect","params":{"from":"data.items"}}]}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G2' && e.message.includes('each'))).toBe(true);
  });

  test('merge 缺 tool_result/tool_results → G2', () => {
    const r = v(
      '{"transform":[{"type":"merge","params":{"messages":"data.ms","next_instruction":{"type":"noop"}}}]}'
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G2' && e.message.includes('tool_result'))).toBe(true);
  });

  test('push.instructions 为 __ 路径引用 → 合法', () => {
    const r = v(
      '{"transform":[{"type":"push","params":{"instructions":"__exec__.instruction.params.instructions"}}]}'
    );
    expect(r.valid).toBe(true);
  });

  test('push.instructions 为非 __ 字符串 → G5(路径引用必须 __ 前缀)', () => {
    const r = v('{"transform":[{"type":"push","params":{"instructions":"foo.bar"}}]}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G5')).toBe(true);
  });
});

describe('G4 域类型与 inner 嵌套(7 域类型 + P0-03)', () => {
  test('7 域类型全量通过(含 has_fields)', () => {
    const r = v(JSON.stringify({
      transform: [
        {
          type: 'branch',
          params: {
            domain: { type: 'instruction', instruction_type: 'demo' },
            on_true: [
              {
                type: 'branch',
                params: {
                  domain: {
                    type: 'all',
                    inner: [
                      { type: 'eq', path: 'data.a', value: 1 },
                      { type: 'not', inner: [{ type: 'lt', path: 'data.b', value: 5 }] },
                      { type: 'exists', path: 'data.c' },
                      { type: 'has_fields', path: 'data', fields: ['a', 'b'] }
                    ]
                  },
                  on_true: [{ type: 'set', params: { attr: 'data.ok', operation: 'set', value: true } }],
                  on_false: []
                }
              }
            ],
            on_false: []
          }
        }
      ]
    }));
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  test('派生域 gt 不在枚举(须用 lt+not/all 组合表达) → G4', () => {
    const r = v(
      '{"transform":[{"type":"branch","params":{"domain":{"type":"gt","path":"data.a","value":1},"on_true":[]}}]}'
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G4')).toBe(true);
  });

  test('域嵌套用 domains(旧口径) → G4(P0-03:一律 inner)', () => {
    const r = v(
      '{"transform":[{"type":"branch","params":{"domain":{"type":"all","domains":[]},"on_true":[]}}]}'
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G4' && e.message.includes('inner'))).toBe(true);
  });

  test('域嵌套用 domain 键 → G4(P0-03)', () => {
    const r = v(
      '{"transform":[{"type":"branch","params":{"domain":{"type":"all","domain":{"type":"exists","path":"x"}},"on_true":[]}}]}'
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G4' && e.message.includes('inner'))).toBe(true);
  });

  test('all 缺 inner → G4', () => {
    const r = v('{"transform":[{"type":"branch","params":{"domain":{"type":"all"},"on_true":[]}}]}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G4' && e.message.includes('inner'))).toBe(true);
  });

  test('动态域 __ 路径引用 → 合法', () => {
    const r = v(
      '{"transform":[{"type":"branch","params":{"domain":"__exec__.instruction.params.domain","on_true":[]}}]}'
    );
    expect(r.errors.filter((e) => e.gate === 'G4' || e.gate === 'G5')).toEqual([]);
  });

  test('动态域非 __ 字符串 → G4(会被当字面量运行时 MissingField)', () => {
    const r = v('{"transform":[{"type":"branch","params":{"domain":"foo","on_true":[]}}]}');
    expect(r.errors.some((e) => e.gate === 'G4' && e.message.includes('__'))).toBe(true);
  });

  test('has_fields 缺 fields → G4', () => {
    const r = v(
      '{"transform":[{"type":"branch","params":{"domain":{"type":"has_fields","path":"data"},"on_true":[]}}]}'
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G4' && e.message.includes('fields'))).toBe(true);
  });

  test('instruction 域缺 instruction_type → G4', () => {
    const r = v(
      '{"transform":[{"type":"branch","params":{"domain":{"type":"instruction"},"on_true":[]}}]}'
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G4' && e.message.includes('instruction_type'))).toBe(true);
  });
});

describe('G5 path 语法(权威 _shared $defs/path 正则 + P1-03 单数拒绝)', () => {
  const badPaths = [
    'x.', // 空段(尾点)
    '.x', // 空段(首点)
    'x..y', // 空段(连续点)
    'items[0]..name', // 索引后空段
    'a[0', // 缺闭合括号
    'a[]', // 空索引
    'a[abc]', // 非数字索引
    'a[0]b', // 索引后非法拼接
    'matrix[0][1]', // 连续索引缺 . 分隔(权威正则:第二索引须 .[1] 形态)
    '__exec__.payload.__io_result__', // 单数(P1-03)
    '__exec__.payload.__io_result__.x' // 单数带子路径
  ];
  test.each(badPaths)('非法 path "%s" → G5', (p) => {
    const r = v(
      JSON.stringify({
        transform: [
          { type: 'branch', params: { domain: { type: 'exists', path: p }, on_true: [] } }
        ]
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G5')).toBe(true);
  });

  const goodPaths = [
    'data',
    'data.sensor.temperature',
    '__exec__.payload.data.x',
    '__exec__.instruction.params.foo',
    '__exec__.queue',
    '__exec__.result.notify',
    '__io_results__.call_external.messages',
    '__exec__.payload.__io_results__.call_external.done',
    'items[0].name',
    'matrix[0].[1]', // 连续索引的点分隔形态(权威正则允许 .[index])
    'items.[0]', // 点后直接索引(_shared 允许 .[0] 形态)
    'payload.$schema' // $ 兼容迁移写法
  ];
  test.each(goodPaths)('合法 path "%s" 通过', (p) => {
    const r = v(
      JSON.stringify({
        transform: [
          { type: 'branch', params: { domain: { type: 'exists', path: p }, on_true: [] } }
        ]
      })
    );
    expect(r.errors.filter((e) => e.gate === 'G5')).toEqual([]);
  });

  test('set.attr 非法路径 → G5', () => {
    const r = v('{"transform":[{"type":"set","params":{"attr":"x.","operation":"set","value":1}}]}');
    expect(r.errors.some((e) => e.gate === 'G5' && e.path?.includes('attr'))).toBe(true);
  });

  test('set.value __ 前缀非法路径 → G5(path_or_literal)', () => {
    const r = v(
      '{"transform":[{"type":"set","params":{"attr":"data","operation":"set","value":"__bad path."}}]}'
    );
    expect(r.errors.some((e) => e.gate === 'G5')).toBe(true);
  });

  test('set.value 普通字面量放行(path_or_literal 语义)', () => {
    const r = v(
      '{"transform":[{"type":"set","params":{"attr":"data","operation":"set","value":"正常的中文字面量"}}]}'
    );
    expect(r.errors.filter((e) => e.gate === 'G5')).toEqual([]);
  });
});

describe('G3 双路径模式(warning 级)', () => {
  test('裸 io_request → G3 warning 但 valid=true', () => {
    const r = v(
      '{"transform":[{"type":"io_request","params":{"io_type":"call_external"}}]}'
    );
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.gate === 'G3')).toBe(true);
  });

  test('io_request 包在 exists(__io_results__…) 分支 on_false 内 → 无 G3 warning', () => {
    const r = v(JSON.stringify({
      transform: [
        {
          type: 'branch',
          params: {
            domain: { type: 'exists', path: '__exec__.payload.__io_results__.call_external' },
            on_true: [],
            on_false: [{ type: 'io_request', params: { io_type: 'call_external' } }]
          }
        }
      ]
    }));
    expect(r.warnings.filter((w) => w.gate === 'G3')).toEqual([]);
  });
});

describe('G6 兜底规则(warning 级)', () => {
  test('无兜底 → G6 warning 但 valid=true(无匹配→Error fact 是引擎既定行为)', () => {
    const r = v('{"transform":[{"type":"set","params":{"attr":"data","operation":"set","value":1}}]}');
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.gate === 'G6')).toBe(true);
  });

  test('末条 all(inner:[]) 兜底 → 无 G6 warning', () => {
    const r = v(JSON.stringify({
      transform: [
        { type: 'set', params: { attr: 'data', operation: 'set', value: 1 } },
        { type: 'branch', params: { domain: { type: 'all', inner: [] }, on_true: [] } }
      ]
    }));
    expect(r.warnings.filter((w) => w.gate === 'G6')).toEqual([]);
  });
});

describe('G7 递归深度', () => {
  test('branch 嵌套超 64 层 → G7 error', () => {
    // 构造 65 层嵌套 branch
    let rule: Record<string, unknown> = { type: 'set', params: { attr: 'data', operation: 'set', value: 1 } };
    for (let i = 0; i < 65; i++) {
      rule = { type: 'branch', params: { domain: { type: 'exists', path: 'data.x' }, on_true: [rule] } };
    }
    const r = v(JSON.stringify({ transform: [rule] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.gate === 'G7')).toBe(true);
  });
});

describe('场景级黄金向量(assets/evorule-rules 形态)', () => {
  test('设备巡检场景规则(equipment-inspection 形态)通过且仅兜底 warning', () => {
    const r = v(JSON.stringify({
      rule_id: 'scenario.equipment_inspection',
      version: '0.1.0',
      description: '设备巡检分级',
      transform: [
        {
          type: 'branch',
          params: {
            domain: { type: 'instruction', instruction_type: 'equipment_inspection_check' },
            on_true: [
              {
                type: 'set',
                params: { attr: 'data', operation: 'set', value: '__exec__.instruction.params' }
              },
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
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }));
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.gate)).toEqual(['G6']); // 该场景无末条兜底 → 仅 G6 建议
  });

  test('旧口径规则(domains 嵌套+单数 io_result)被拦截——UV-074 回归锚', () => {
    const r = v(JSON.stringify({
      transform: [
        {
          type: 'branch',
          params: {
            domain: { type: 'exists', path: '__exec__.payload.__io_result__' },
            on_true: [],
            on_false: [{ type: 'io_request', params: { prompt: 'x' } }]
          }
        },
        { type: 'branch', params: { domain: { type: 'all', domains: [] }, on_true: [] } }
      ]
    }));
    expect(r.valid).toBe(false);
    // 单数 path + domains 嵌套 + io_request 缺 io_type 三处 error
    expect(r.errors.some((e) => e.gate === 'G5' && e.message.includes('__io_result__'))).toBe(true);
    expect(r.errors.some((e) => e.gate === 'G4' && e.message.includes('inner'))).toBe(true);
    expect(r.errors.some((e) => e.gate === 'G2' && e.message.includes('io_type'))).toBe(true);
  });
});
