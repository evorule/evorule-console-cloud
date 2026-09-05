// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// UV-078 W3 方向 b:向导批量包解析纯函数测试。
// 覆盖:合法包解析/entry_id 提取优先级/坏形态逐条透出/中文 UTF-8 解码。

import { describe, it, expect } from 'vitest';
import { parseWizardBatchPackage } from './rule-import-export';

/** 构造单文件批量包(base64 编码 UTF-8 安全) */
function makePkg(
  files: Array<{ path?: string; objectId?: string; rule: object | string | null }>,
): unknown {
  return {
    manifest: { manifest_version: '1.0', format: 'evorule-batch' },
    files: files.map((f, i) => ({
      path: f.path ?? `rules/rule-${i}.json`,
      objectId: f.objectId ?? `obj-${i}`,
      content_base64:
        f.rule === null
          ? undefined
          : typeof f.rule === 'string'
            ? btoa(f.rule) // 故意不转 UTF-8,测中文乱码路径在 JSON.parse 处报错
            : btoa(unescape(encodeURIComponent(JSON.stringify(f.rule)))),
    })),
  };
}

describe('parseWizardBatchPackage (UV-078 W3)', () => {
  it('合法包:提取 entry_id/rule_body/description', () => {
    const pkg = makePkg([
      {
        objectId: 'user.rule-compute-ik',
        rule: { rule_id: 'rule-compute-ik', version: 1, description: '计算规则', transform: [] },
      },
    ]);
    const { items, errors } = parseWizardBatchPackage(pkg);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0].entryId).toBe('rule-compute-ik');
    expect(items[0].sourceId).toBe('user.rule-compute-ik');
    const body = JSON.parse(items[0].ruleBody);
    expect(body.rule_id).toBe('rule-compute-ik');
    expect(items[0].description).toBe('计算规则');
  });

  it('entry_id 缺省 rule_id 时回退 objectId 并清洗 user. 前缀', () => {
    const pkg = makePkg([
      { objectId: 'user.fallback-id', rule: { transform: [] } },
      { objectId: 'no-prefix', rule: { transform: [] } },
    ]);
    const { items, errors } = parseWizardBatchPackage(pkg);
    expect(errors).toEqual([]);
    expect(items[0].entryId).toBe('fallback-id');
    expect(items[1].entryId).toBe('no-prefix');
  });

  it('中文规则体 UTF-8 解码正确(非 ASCII 描述回读无损)', () => {
    const pkg = makePkg([
      { rule: { rule_id: 'cn-rule', description: '金额超限拦截', transform: [] } },
    ]);
    const { items, errors } = parseWizardBatchPackage(pkg);
    expect(errors).toEqual([]);
    expect(items[0].description).toBe('金额超限拦截');
  });

  it('单条坏形态(缺 base64/JSON 非法)逐条透出,不吞其余', () => {
    const pkg = makePkg([
      { path: 'bad-missing.json', objectId: 'ok-1', rule: { rule_id: 'ok-1', transform: [] } },
      { path: 'bad-json.json', rule: 'not-json{{{' },
    ]);
    // makePkg 第二项:rule 为字符串时 btoa 直接编码 → JSON.parse 失败
    const { items, errors } = parseWizardBatchPackage(pkg);
    expect(items).toHaveLength(1);
    expect(items[0].entryId).toBe('ok-1');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('bad-json.json');
  });

  it('无 manifest / 错误版本号 → 整包拒绝', () => {
    expect(parseWizardBatchPackage({ files: [] }).errors[0]).toContain('manifest');
    expect(
      parseWizardBatchPackage({ manifest: { manifest_version: '9.9' }, files: [] }).errors[0],
    ).toContain('manifest');
  });

  it('空 files 数组 → 报"批量包为空"', () => {
    const r = parseWizardBatchPackage({ manifest: { manifest_version: '1.0' }, files: [] });
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toContain('空');
  });

  it('无 rule_id 且无 objectId → 该条报无法提取 entry_id', () => {
    const pkg = makePkg([{ objectId: undefined, rule: { transform: [] } }]);
    // makePkg 对 undefined objectId 兜底 obj-i,手工清除:
    (pkg as { files: Array<{ objectId?: string }> }).files[0].objectId = undefined;
    const { items, errors } = parseWizardBatchPackage(pkg);
    expect(items).toHaveLength(0);
    expect(errors[0]).toContain('entry_id');
  });

  // UV-078 W3 e2e 发现:导出中心批量默认 yaml,曾一律 JSON.parse 导致整包失败。
  // 修复后按 files[].format 分流,yaml 走 yamlParse(仅支持本仓导出的 YAML 子集)。
  it('yaml 格式包(files[].format=yaml)按 format 分流解析', () => {
    const yamlText = [
      'rule_id: rule-yaml-1',
      'description: YAML 批量包规则',
      'version: 1',
      'transform:',
      '-',
      '  type: set',
      '  params:',
      '    attr: data.ok',
      '    operation: set',
      '    value: true',
    ].join('\n');
    const pkg = {
      manifest: { manifest_version: '1.0' },
      files: [
        {
          path: 'rules/rule-yaml-1.yaml',
          objectId: 'rule-yaml-1',
          format: 'yaml',
          content_base64: btoa(unescape(encodeURIComponent(yamlText))),
        },
      ],
    };
    const { items, errors } = parseWizardBatchPackage(pkg);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0].entryId).toBe('rule-yaml-1');
    const body = JSON.parse(items[0].ruleBody);
    expect(body.rule_id).toBe('rule-yaml-1');
    expect(body.description).toBe('YAML 批量包规则');
    expect(body.transform[0].type).toBe('set');
    expect(body.transform[0].params.attr).toBe('data.ok');
  });

  it('yaml 格式但内容非法 → 该条逐条透出,不吞其余', () => {
    const pkg = {
      manifest: { manifest_version: '1.0' },
      files: [
        { path: 'bad.yaml', objectId: 'bad', format: 'yaml', content_base64: btoa('!!!') },
        {
          path: 'ok.json',
          objectId: 'ok-1',
          format: 'json',
          content_base64: btoa(unescape(encodeURIComponent(JSON.stringify({ rule_id: 'ok-1', transform: [] })))),
        },
      ],
    };
    const { items, errors } = parseWizardBatchPackage(pkg);
    expect(items).toHaveLength(1);
    expect(items[0].entryId).toBe('ok-1');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('bad.yaml');
  });
});
