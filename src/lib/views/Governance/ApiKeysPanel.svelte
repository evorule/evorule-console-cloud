<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:API Key 管理面板（G5）——清单/创建(名称+scope)/吊销
  约束:仅管理员(server 403 原样透传);明文 key 仅创建时返回一次,面板强制
  一次性展示并要求用户自行保存(不落 localStorage)。
  scope 白名单(server):pull(执行侧拉快照包)|entries:propose|entries:transition
-->

<script lang="ts">
  import { get } from "svelte/store";
  import {
    governanceStore,
  } from "$lib/governance/governance-store";
  import type {
    ApiKeySummary,
  } from "$lib/governance/governance-backend";
  import { toastSuccess, toastError } from "$lib/stores/toast";

  let keys = $state<ApiKeySummary[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let newName = $state("");
  let newScope = $state<"pull" | "entries:propose" | "entries:transition">("pull");
  let oneTimeKey = $state<{ id: string; key: string } | null>(null);
  let revokingId = $state<string | null>(null);

  async function load(): Promise<void> {
    const g = get(governanceStore);
    if (!g.backend) return;
    loading = true;
    error = null;
    try {
      const page = await g.backend.listApiKeys();
      keys = page.items ?? [];
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function handleCreate(): Promise<void> {
    const g = get(governanceStore);
    if (!g.backend || !newName.trim()) return;
    try {
      const created = await g.backend.createApiKey(
        newName.trim(),
        newScope,
      );
      oneTimeKey = { id: created.key_id, key: created.key };
      toastSuccess(`API Key ${created.key_id} 已创建(明文仅显示这一次)`);
      newName = "";
      await load();
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  async function handleRevoke(k: ApiKeySummary): Promise<void> {
    const g = get(governanceStore);
    if (!g.backend) return;
    if (!window.confirm(`吊销 API Key ${k.key_id}(${k.name})?吊销后立即失效。`))
      return;
    revokingId = k.key_id;
    try {
      await g.backend.revokeApiKey(k.key_id);
      toastSuccess(`API Key ${k.key_id} 已吊销`);
      await load();
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      revokingId = null;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="ak" aria-label="API Key 管理">
  <form
    class="ak-form"
    onsubmit={(e) => {
      e.preventDefault();
      void handleCreate();
    }}
  >
    <input
      placeholder="Key 名称(如 执行侧-pull)"
      bind:value={newName}
      required
    />
    <select bind:value={newScope}>
      <option value="pull">pull(执行侧拉快照包)</option>
      <option value="entries:propose">entries:propose(机器提议入账)</option>
      <option value="entries:transition">entries:transition(机器行权)</option>
    </select>
    <button type="submit" class="ak-btn primary" disabled={!newName.trim()}>
      + 创建 Key
    </button>
  </form>

  {#if oneTimeKey}
    <div class="ak-onetime">
      ⚠️ 明文 key（仅此一次,请立即保存,关窗后不可再取）:
      <code>{oneTimeKey.key}</code>
    </div>
  {/if}

  {#if loading}
    <p class="ak-status">加载中…</p>
  {:else if error}
    <div class="ak-status ak-err">{error}</div>
  {:else if keys.length === 0}
    <p class="ak-status">无 API Key。</p>
  {:else}
    <table class="ak-table">
      <thead>
        <tr><th>Key ID</th><th>名称</th><th>scope</th><th>创建</th><th>状态</th><th></th></tr>
      </thead>
      <tbody>
        {#each keys as k (k.key_id)}
          <tr class:revoked={k.revoked_at}>
            <td><code>{k.key_id}</code></td>
            <td>{k.name}</td>
            <td><code class="ak-scope">{k.scope}</code></td>
            <td>{k.created_at?.slice(0, 10)}</td>
            <td>
              {k.revoked_at
                ? `已吊销(${k.revoked_at.slice(0, 10)})`
                : "生效中"}
            </td>
            <td>
              {#if !k.revoked_at}
                <button
                  type="button"
                  class="ak-btn danger"
                  disabled={revokingId !== null}
                  onclick={() => void handleRevoke(k)}
                >
                  吊销
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .ak {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ak-form {
    display: flex;
    gap: 6px;
  }
  .ak-form input {
    flex: 1;
    font-size: 12px;
    padding: 5px 8px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 5px;
  }
  .ak-form select {
    font-size: 12px;
    padding: 5px 8px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 5px;
  }
  .ak-btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
    white-space: nowrap;
  }
  .ak-btn.primary {
    border-color: var(--brand, #2563eb);
    background: var(--brand, #2563eb);
    color: #fff;
  }
  .ak-btn.danger {
    border-color: var(--danger, #fca5a5);
    color: var(--danger, #dc2626);
  }
  .ak-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ak-onetime {
    font-size: 11px;
    padding: 8px;
    border: 1px solid #fdba74;
    background: #fff7ed;
    border-radius: 6px;
    word-break: break-all;
  }
  .ak-status {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
    margin: 0;
  }
  .ak-err {
    color: var(--danger, #dc2626);
  }
  .ak-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  .ak-table th {
    text-align: left;
    color: var(--text-secondary, #6b7280);
    border-bottom: 1px solid var(--border, #e5e7eb);
    padding: 4px 6px;
  }
  .ak-table td {
    padding: 4px 6px;
    border-bottom: 1px solid var(--border, #f1f5f9);
  }
  .ak-table tr.revoked td {
    opacity: 0.5;
  }
  .ak-table code {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
  }
  .ak-scope {
    background: var(--bg-page, #f3f4f6);
    padding: 1px 5px;
    border-radius: 4px;
  }
</style>
