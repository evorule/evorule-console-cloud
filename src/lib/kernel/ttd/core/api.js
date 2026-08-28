// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// API client — 修复 v0.1.0 的 4 个 API 调用 bug
//
// Bug 修复:
//   1. rewind: path /rewind/{v} → query /rewind?version={v}
//   2. diff: items 是数组 ["key", value] / ["key", old, new],不是对象 {key, value}
//   3. audit: 字段 fact_count + verified,不是 last_audited_version
//   4. verify: 字段 verified,不是 valid

import { store } from './store.js';

const BASE_DEFAULT = 'http://127.0.0.1:18080';

function base() {
  return (store.getState().apiUrl || BASE_DEFAULT).replace(/\/+$/, '');
}

async function fetchJson(path, opts = {}) {
  const url = base() + path;
  const r = await fetch(url, opts);
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

export const api = {
  // === Session 管理 ===
  listSessions() { return fetchJson('/api/sessions'); },
  createSession() { return fetchJson('/api/sessions', { method: 'POST' }); },
  closeSession(id) { return fetchJson(`/api/sessions/${id}`, { method: 'DELETE' }); },

  // === 修复 1: rewind 用 query ?version=N ===
  rewind(id, version) {
    return fetchJson(`/api/sessions/${id}/rewind?version=${version}`);
  },

  // === 修复 2: diff items 是数组格式,在 diff view 内部解析 ===
  diff(id, a, b) {
    return fetchJson(`/api/sessions/${id}/diff?a=${a}&b=${b}`);
  },

  // === 修复 3: audit 字段是 fact_count + verified ===
  audit(id) { return fetchJson(`/api/sessions/${id}/audit`); },
  // === 修复 4: verify 返回 verified,不是 valid ===
  auditVerify(id) { return fetchJson(`/api/sessions/${id}/audit/verify`); },

  // === replay 支持范围参数(大 session 必须用) ===
  replay(id, from = 0, to = null) {
    let q = `?from=${from}`;
    if (to !== null) q += `&to=${to}`;
    return fetchJson(`/api/sessions/${id}/replay${q}`);
  },

  history(id) { return fetchJson(`/api/sessions/${id}/history`); },
  state(id) { return fetchJson(`/api/sessions/${id}/state`); },
  causal(id, factId) {
    return fetchJson(`/api/sessions/${id}/audit/causal/${factId}`);
  },

  // === What-If 链路 ===
  fork(parentId, version) {
    return fetchJson(`/api/sessions/fork/${parentId}?version=${version}`, {
      method: 'POST'
    });
  },
  command(id, instruction) {
    return fetchJson(`/api/sessions/${id}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction })
    });
  },

  // === 辅助 ===
  facts(id, prefix) {
    const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    return fetchJson(`/api/sessions/${id}/facts${q}`);
  }
};
