<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:规则形态翻译浮层（G7:server translate 端点 L2 封装此前零 UI 消费）
    - transform → condition + action_set（可能 lossy,lost_items 逐条列出）
    - condition + action_set → transform
  产物仅进浮层结果区由用户复制/自行采用,不自动写回规则内容(红线:人确认)。
  挂载:规则库开发者模式 header(开发者工具语义)。
-->

<script lang="ts">
  import type { WorkspaceBackend } from "$lib/kernel";
  import { toastError } from "$lib/stores/toast";

  interface Props {
    wb: WorkspaceBackend;
    onClose: () => void;
  }

  let { wb, onClose }: Props = $props();

  type Dir = "to_conditional" | "to_transform";
  let dir = $state<Dir>("to_conditional");
  let input = $state("");
  let result = $state<unknown>(null);
  let warnings = $state<string[]>([]);
  let lossy = $state(false);
  let lostItems = $state<string[]>([]);
  let translating = $state(false);

  async function handleTranslate(): Promise<void> {
    translating = true;
    result = null;
    warnings = [];
    lossy = false;
    lostItems = [];
    try {
      const parsed = JSON.parse(input);
      if (dir === "to_conditional") {
        const req = parsed as { transform?: unknown[] };
        const r = await wb.translateToConditional({
          transform: req.transform ?? []
        });
        result = { condition: r.condition, action_set: r.action_set };
        lossy = r.lossy;
        lostItems = r.lost_items ?? [];
      } else {
        const req = parsed as {
          condition?: unknown[];
          action_set?: unknown[];
          metadata?: unknown;
        };
        const r = await wb.translateToTransform({
          condition: req.condition ?? [],
          action_set: req.action_set ?? [],
          metadata: req.metadata
        });
        result = { transform: r.transform };
        warnings = r.warnings ?? [];
      }
    } catch (e) {
      toastError(`翻译失败: ${(e as Error).message}`);
    } finally {
      translating = false;
    }
  }

  async function copyResult(): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    } catch {
      /* 剪贴板不可用时静默——JSON 区本可直接复制 */
    }
  }
</script>

<div
  class="tr-overlay"
  role="presentation"
  onclick={(e) => {
    if (e.currentTarget === e.target) onClose();
  }}
>
  <div class="tr-panel" role="dialog" aria-modal="true" aria-label="规则形态翻译">
    <header class="tr-header">
      <h3>⇄ 规则形态翻译</h3>
      <button type="button" class="tr-btn" onclick={onClose}>✕</button>
    </header>

    <div class="tr-dir" role="radiogroup">
      <label class:active={dir === "to_conditional"}>
        <input
          type="radio"
          bind:group={dir}
          value="to_conditional"
          onchange={() => (result = null)}
        />
        transform → condition + action_set
        <em>(可能 lossy)</em>
      </label>
      <label class:active={dir === "to_transform"}>
        <input
          type="radio"
          bind:group={dir}
          value="to_transform"
          onchange={() => (result = null)}
        />
        condition + action_set → transform
      </label>
    </div>

    <textarea
      class="tr-input"
      rows="8"
      spellcheck="false"
      bind:value={input}
      placeholder={dir === "to_conditional"
        ? '{"transform": [ ... ]}'
        : '{"condition": [...], "action_set": [...]}'}
    ></textarea>

    <div class="tr-actions">
      <button
        type="button"
        class="tr-btn primary"
        disabled={translating || !input.trim()}
        onclick={() => void handleTranslate()}
      >
        {translating ? "翻译中…" : "翻译"}
      </button>
    </div>

    {#if lossy}
      <div class="tr-lossy">
        ⚠️ 本次翻译有损,以下项无法回译:
        <ul>
          {#each lostItems as item (item)}
            <li>{item}</li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if warnings.length > 0}
      <div class="tr-warn">
        {#each warnings as w (w)}
          <p>{w}</p>
        {/each}
      </div>
    {/if}

    {#if result}
      <div class="tr-result">
        <div class="tr-result-head">
          <span>翻译产物</span>
          <button type="button" class="tr-btn" onclick={() => void copyResult()}>
            复制
          </button>
        </div>
        <pre class="tr-json">{JSON.stringify(result, null, 2)}</pre>
      </div>
    {/if}
  </div>
</div>

<style>
  .tr-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }
  .tr-panel {
    background: var(--bg-card, #fff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 10px;
    width: min(680px, 94vw);
    max-height: 84vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
  }
  .tr-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tr-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
  }
  .tr-dir {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .tr-dir label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    cursor: pointer;
  }
  .tr-dir label.active {
    border-color: var(--brand, #2563eb);
    background: var(--info-bg, #eff6ff);
  }
  .tr-dir em {
    font-style: normal;
    color: #9a3412;
    font-size: 11px;
  }
  .tr-input {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    padding: 8px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 6px;
    resize: vertical;
  }
  .tr-actions {
    display: flex;
  }
  .tr-btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
  }
  .tr-btn.primary {
    border-color: var(--brand, #2563eb);
    background: var(--brand, #2563eb);
    color: #fff;
  }
  .tr-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .tr-lossy {
    font-size: 11px;
    padding: 8px;
    border: 1px solid #fdba74;
    background: #fff7ed;
    border-radius: 6px;
    color: #9a3412;
  }
  .tr-lossy ul {
    margin: 4px 0 0;
    padding-left: 18px;
  }
  .tr-warn {
    font-size: 11px;
    color: #9a3412;
  }
  .tr-warn p {
    margin: 2px 0;
  }
  .tr-result-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .tr-json {
    margin: 0;
    padding: 10px;
    background: var(--bg-page, #f8fafc);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    font-size: 11px;
    overflow: auto;
    max-height: 260px;
  }
</style>
