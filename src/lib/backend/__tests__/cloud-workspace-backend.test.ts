// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// CloudWorkspaceBackend actor 注入单测 — 审计归属跟随登录用户(D2 闭合)
//
// 运行: npx vitest run src/lib/backend/__tests__/cloud-workspace-backend.test.ts
//
// 测试范围:
//   - 构造时传入 actor → 内核 HttpWorkspaceBackend 请求体携带 actor.name/role
//   - reconfigure 换 actor → 新请求用新身份(实例不变,内部实现重建)
//   - reconfigure 置空 actor → 回落 "console"(内核语义,此处验证链路)
//
// 不测:
//   - 内核身份透传细节(见内核仓 http-workspace-backend.test.ts)
//   - noServer mock 模式(行为未变)

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { CloudWorkspaceBackend } from '../cloud-workspace-backend';
import type { SubmitPublishRequest } from '$lib/kernel';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({}),
    text: async () => '{}',
  } as unknown as Response);
});

function lastCallBody(): Record<string, unknown> {
  const init = mockFetch.mock.calls.at(-1)![1] as RequestInit;
  return JSON.parse(init.body as string);
}

const SUBMIT_REQ: SubmitPublishRequest = {
  workspace_id: 'w1',
  rule_id: 'r1',
  rule_version: 2,
} as unknown as SubmitPublishRequest;

describe('CloudWorkspaceBackend actor 注入', () => {
  test('构造传入 actor → 发布请求体携带真实身份', async () => {
    const wb = new CloudWorkspaceBackend({
      mode: 'offline',
      localBaseUrl: 'http://localhost:18080',
      actor: { name: 'u-admin', role: 'admin' },
    });

    await wb.submitPublish(SUBMIT_REQ);

    const body = lastCallBody();
    expect(body.submitted_by).toBe('u-admin');
    expect(body.role).toBe('admin');
  });

  test('reconfigure 换 actor → 新请求用新身份(登录切换生效)', async () => {
    const wb = new CloudWorkspaceBackend({
      mode: 'offline',
      localBaseUrl: 'http://localhost:18080',
      actor: { name: 'u-admin', role: 'admin' },
    });

    wb.reconfigure({ actor: { name: 'u-lead', role: 'department_head' } });
    await wb.submitPublish(SUBMIT_REQ);

    const body = lastCallBody();
    expect(body.submitted_by).toBe('u-lead');
    expect(body.role).toBe('department_head');
  });

  test('reconfigure 置空 actor → 回落 "console"(登出语义)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wb = new CloudWorkspaceBackend({
      mode: 'offline',
      localBaseUrl: 'http://localhost:18080',
      actor: { name: 'u-admin', role: 'admin' },
    });

    wb.reconfigure({ actor: null });
    await wb.submitPublish(SUBMIT_REQ);

    const body = lastCallBody();
    expect(body.submitted_by).toBe('console');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('CloudWorkspaceBackend forkRule 接线(UV-062 Wave 2 补充项)', () => {
  test('POST /api/workspaces/{id}/rules/{rule_id}/fork,actor 注入 created_by', async () => {
    const wb = new CloudWorkspaceBackend({
      mode: 'offline',
      localBaseUrl: 'http://localhost:18080',
      actor: { name: 'u-lead', role: 'admin' },
    });

    await wb.forkRule('ws-1', 'rule-9', { new_name: 'rule-9-fork' });

    const [url, init] = mockFetch.mock.calls.at(-1)! as [string, RequestInit];
    expect(url).toBe('http://localhost:18080/api/workspaces/ws-1/rules/rule-9/fork');
    expect(init.method).toBe('POST');
    const body = lastCallBody();
    expect(body.new_name).toBe('rule-9-fork');
    expect(body.created_by).toBe('u-lead');
  });

  test('未配置 actor → created_by 回落 "console" 并 warn(审计失真警示)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wb = new CloudWorkspaceBackend({
      mode: 'offline',
      localBaseUrl: 'http://localhost:18080',
    });

    await wb.forkRule('ws-1', 'rule-9', { new_name: 'rule-9-fork' });

    const body = lastCallBody();
    expect(body.created_by).toBe('console');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
