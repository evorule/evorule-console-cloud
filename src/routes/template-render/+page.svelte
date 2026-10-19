<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 EvoRule Project
  evorule-console-cloud 模板渲染调试页 /template-render
-->
<!--
  职责:
    - 对接 evorule-server template-services 渲染面(POST /api/templates/render)
    - 模板 + 上下文(JSON) + 格式 三输入 → 渲染 → 产物预览 + 复制
    - 错误原样透传(服务端 fail-fast 文案含 1 基行列诊断)
  契约:
    - 渲染 = 确定性纯函数(同输入逐字节同输出);时间等非确定量由 context 显式传入
    - 纯函数无落库;语法 v1:{{path}} 变量 / {% if %}{% else %}{% endif %} /
      {% for x in path %}{% endfor %};路径缺失(变量位)显式报错不静默空串
  设计参考:plugin-packs.ts(独立轻客户端)+ /flow(netConfig 解析模式)
-->

<script lang="ts">
  import { get } from "svelte/store";
  import { onMount } from "svelte";
  import { authTokenForRequest, resolveServerBaseUrl } from "$lib/backend/server-base";
  import { netConfig } from "$lib/config/net-config";
  import { TemplatesClient, TemplatesError, type RenderFormat } from "$lib/backend/templates";

  let client: TemplatesClient | null = null;

  let template = $state(
    `审计对象: {{user.name}}{% if user.vip %}(VIP){% end if %}
{% for o in user.orders %}- {{o.item}} x {{o.qty}}
{% endfor %}`,
  );
  let contextText = $state(
    JSON.stringify(
      {
        user: {
          name: "张三",
          vip: true,
          orders: [
            { item: "报表订阅", qty: 1 },
            { item: "审计工时", qty: 3 },
          ],
        },
      },
      null,
      2,
    ),
  );
  let format = $state<RenderFormat>("text");

  let rendering = $state(false);
  let error = $state<string | null>(null);
  let result = $state<string | null>(null);
  let resultFormat = $state<RenderFormat | null>(null);
  let copied = $state(false);

  onMount(() => {
    // cloud 适配:baseUrl/authToken 取自 netConfig(解析单点 server-base.ts,
    // 与 /flow 同源;proxy 态走同源 '/console-api')
    const cfg = get(netConfig);
    const baseUrl = resolveServerBaseUrl(cfg);
    client = new TemplatesClient(
      baseUrl,
      authTokenForRequest(cfg.mode, cfg.authToken.trim() || null)
    );
  });

  async function render() {
    if (!client) return;
    rendering = true;
    error = null;
    result = null;
    resultFormat = null;
    copied = false;

    let context: Record<string, unknown> | undefined;
    if (contextText.trim() !== "") {
      try {
        context = JSON.parse(contextText);
      } catch {
        error = "上下文不是合法 JSON,请修正后再渲染。";
        rendering = false;
        return;
      }
    }

    try {
      const r = await client.render({ template, context, format });
      result = r.content;
      resultFormat = r.format;
    } catch (e) {
      error = e instanceof TemplatesError ? e.message : String(e);
    } finally {
      rendering = false;
    }
  }

  async function copyResult() {
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(result);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // 剪贴板不可用(权限/非安全上下文)时静默——产物文本框本身可手动复制
    }
  }
</script>

<div class="page">
  <header>
    <h1>模板渲染</h1>
    <p class="subtitle">
      确定性模板调试器 — 上下文 + 模板 → JSON / Markdown / 纯文本(同输入逐字节同输出,无时钟无随机)
    </p>
  </header>

  <div class="grid">
    <section class="panel">
      <h2>模板</h2>
      <textarea
        class="mono"
        bind:value={template}
        rows="10"
        placeholder={"你好, {{user.name}}"}
        aria-label="模板内容"
      ></textarea>

      <h2>上下文(JSON,可留空)</h2>
      <textarea
        class="mono"
        bind:value={contextText}
        rows="8"
        placeholder={'{ "user": { "name": "张三" } }'}
        aria-label="上下文 JSON"
      ></textarea>

      <div class="row">
        <label for="fmt">产出格式</label>
        <select id="fmt" bind:value={format}>
          <option value="text">text(纯文本)</option>
          <option value="markdown">markdown</option>
          <option value="json">json(产物额外做合法性校验)</option>
        </select>
        <button class="btn" onclick={render} disabled={rendering || template.trim() === ""}>
          {rendering ? "渲染中…" : "渲染"}
        </button>
      </div>
    </section>

    <section class="panel">
      <h2>产物{resultFormat ? `(${resultFormat})` : ""}</h2>
      {#if error}
        <div class="error" role="alert">{error}</div>
      {:else if result !== null}
        <div class="result-wrap">
          <button class="ghost" onclick={copyResult}>{copied ? "已复制 ✓" : "复制"}</button>
          <pre class="mono result">{result}</pre>
        </div>
      {:else}
        <p class="hint">填写模板与上下文后点击「渲染」。路径缺失、迭代源非数组、预算超限都会显式报错(不静默回退)。</p>
      {/if}

      <details class="cheatsheet">
        <summary>语法速查(v1)</summary>
        <pre class="mono">{`{{user.name}}                   变量替换(路径缺失显式报错)
{% if user.vip %}VIP{% else %}普通{% endif %}  条件(路径缺失按假)
{% for o in orders %}{{o.item}}{% endfor %}    循环(仅数组,缺失/非数组报错)`}</pre>
        <p class="hint">
          数值仅整数(无浮点);无过滤器/无字面转义;时间等非确定量请作为 context 显式参数传入(确定性红线)。
        </p>
      </details>
    </section>
  </div>
</div>

<style>
  .page {
    padding: 24px;
    max-width: 1200px;
    margin: 0 auto;
  }
  h1 {
    font-size: 22px;
    margin: 0 0 4px;
  }
  .subtitle {
    color: var(--text-secondary, #64748b);
    font-size: 13px;
    margin: 0 0 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  @media (max-width: 860px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .panel {
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 10px;
    padding: 16px;
    background: var(--panel, #ffffff);
  }
  .panel h2 {
    font-size: 14px;
    margin: 0 0 8px;
  }
  .panel h2:not(:first-child) {
    margin-top: 14px;
  }
  textarea,
  select {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    padding: 8px;
    font-size: 13px;
    background: var(--bg, #f8fafc);
    color: var(--text, #0f172a);
  }
  select {
    width: auto;
    min-width: 220px;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
  }
  .row label {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
  }
  .btn {
    margin-left: auto;
    padding: 8px 18px;
    border: none;
    border-radius: 8px;
    background: var(--brand, #2563eb);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .error {
    border: 1px solid #fca5a5;
    background: #fef2f2;
    color: #b91c1c;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .result-wrap {
    position: relative;
  }
  .ghost {
    position: absolute;
    top: 8px;
    right: 8px;
    border: 1px solid var(--border, #e2e8f0);
    background: var(--panel, #fff);
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
    color: var(--text-secondary, #64748b);
  }
  .result {
    border: 1px solid var(--border, #e2e8f0);
    background: var(--bg, #f8fafc);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 13px;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    min-height: 120px;
    max-height: 420px;
    overflow: auto;
  }
  .hint {
    color: var(--text-secondary, #64748b);
    font-size: 13px;
  }
  .cheatsheet {
    margin-top: 14px;
    font-size: 13px;
  }
  .cheatsheet pre {
    border: 1px dashed var(--border, #e2e8f0);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12px;
    background: var(--bg, #f8fafc);
    overflow: auto;
  }
</style>
