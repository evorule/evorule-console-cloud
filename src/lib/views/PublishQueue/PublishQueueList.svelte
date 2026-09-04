<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:发布队列列表 + 状态徽标 + approve/reject 按钮(权限守卫)
  依赖:publish-queue-api.ts / auth.ts / notifications.ts / toast.ts / net-config.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.5(PublishQueueList)

  F3 接线(2026-08-24,偏差修正):
    - 在线(联网模式):数据来自远程 evorule-server(remoteBaseUrl)GET /api/publish/queue;
      审批/驳回走 POST /review,回滚走 POST /publish/rollback(单步,pending→published/rejected)。
    - 离线(本地模式):连本地 evorule-server(localBaseUrl,默认 http://localhost:18080)。
      本地服务器不可达时展示明确错误状态,不静默显示"暂无发布请求"。
    - 不再回退 localStorage mock store(mock 两步流 submitted→reviewing→published
      仅存于 Collab 演示视图 ReviewActions/DecisionMaker,发布队列页已全部走后端)。
    - 后端状态机 pending/approved/published/rejected/cancelled 统一映射展示。
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { useBackend, useWorkspaceBackendOrNull } from "$lib/kernel";
  import type { PublishQueueItem } from "$lib/kernel";
  import { CloudHttpBackend } from "$lib/backend/cloud-http-backend";
  import { DEFAULT_LOCAL_BASE_URL } from "$lib/backend/types";
  import { netConfig } from "$lib/config/net-config";
  import {
    type PublishQueueItemView,
  } from "$lib/backend/production-views";
  import { can } from "$lib/stores/auth";
  import { pushNotification } from "$lib/stores/notifications";
  import { toastSuccess, toastError } from "$lib/stores/toast";

  let queue = $state<PublishQueueItemView[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let backend: CloudHttpBackend;

  let reviewComment = $state<Record<string, string>>({});
  let rejectingId = $state<string | null>(null);
  let rejectComment = $state("");

  // WorkspaceBackend 须在组件初始化期从 context 取出并缓存(Svelte 5 context
  // 不支持事件处理器内调用);队列项详情走内核通道 GET /api/publish/queue/{id}。
  const workspaceBackend = useWorkspaceBackendOrNull();

  // ===== 队列项详情(UV-062 接线④:完整请求体查看) =====
  let detailOpen = $state<Record<string, boolean>>({});
  /** 详情缓存(队列项不可变历史记录,首次拉取后缓存) */
  let detailCache = $state<Record<string, PublishQueueItem>>({});
  let detailLoading = $state<Record<string, boolean>>({});
  let detailError = $state<Record<string, string | null>>({});

  async function toggleDetail(item: PublishQueueItemView): Promise<void> {
    const id = item.id;
    detailOpen[id] = !detailOpen[id];
    if (!detailOpen[id] || detailCache[id]) return;
    if (!workspaceBackend) {
      detailError[id] = "执行域通道不可用,无法获取队列项详情";
      toastError(detailError[id]!, "队列详情");
      return;
    }
    detailLoading[id] = true;
    detailError[id] = null;
    try {
      detailCache[id] = await workspaceBackend.getPublishQueueItem(Number(id));
    } catch (e) {
      detailError[id] = e instanceof Error ? e.message : String(e);
      toastError(`获取队列项详情失败:${detailError[id]}`, "队列详情");
    } finally {
      detailLoading[id] = false;
    }
  }

  /** final_candidate_rules 原文 → pretty JSON(解析失败时原样展示,不静默) */
  function prettyRules(raw: string | null): string {
    if (!raw) return "(空)";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  /** final_candidate_rules 规则数(解析失败 = -1,展示为"—") */
  function rulesCount(raw: string | null): number {
    if (!raw) return 0;
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? v.length : -1;
    } catch {
      return -1;
    }
  }

  function fmtTime(iso?: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN");
  }

  const canApprove = $derived(can("approve_publish"));
  const canRollback = $derived(can("rollback_ruleset"));

  function statusLabel(s: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      submitted: "待审核",
      reviewing: "审核中",
      pending: "待审核",
      approved: "已批准",
      rejected: "已驳回",
      published: "已发布",
      cancelled: "已取消",
      rolled_back: "已回滚",
    };
    return labels[s] ?? s;
  }

  function statusClass(s: string): string {
    return `status-${s}`;
  }

  /** 重新加载队列(数据来自当前模式对应的 evorule-server;不可达时展示错误状态)。 */
  async function reloadQueue(): Promise<void> {
    try {
      queue = await backend.getPublishQueue();
      error = null;
    } catch (e) {
      queue = [];
      const detail = e instanceof Error && e.message ? e.message : "网络错误";
      error = `无法连接 evorule-server(${backend.baseUrl}):${detail}`;
    }
  }

  onMount(async () => {
    const b = useBackend();
    // cloud 版始终注入 CloudHttpBackend(在线/离线统一走 HTTP),详见文件头注
    backend = b as CloudHttpBackend;
    await reloadQueue();
    loading = false;
  });

  async function handleApprove(item: PublishQueueItemView): Promise<void> {
    const comment = reviewComment[item.id] ?? "通过";
    const res = await backend.reviewPublishRequest(Number(item.id), "approved", comment);
    if (!res.ok) {
      toastError(res.error ?? "审批失败", "发布队列");
      return;
    }
    toastSuccess("已批准发布", "发布队列");
    await reloadQueue();
  }

  async function handleRejectConfirm(): Promise<void> {
    if (!rejectingId) return;
    const id = rejectingId;
    const res = await backend.reviewPublishRequest(Number(id), "rejected", rejectComment || "驳回");
    if (!res.ok) {
      toastError(res.error ?? "驳回失败", "发布队列");
      return;
    }
    toastSuccess("已驳回发布请求", "发布队列");
    rejectingId = null;
    rejectComment = "";
    await reloadQueue();
  }

  async function handleRollback(item: PublishQueueItemView): Promise<void> {
    if (!confirm("确认紧急回滚?此操作将立即生效。")) return;
    // 后端回滚按"目标版本"操作:回滚到该发布项的发布版本(rulesetVersion = published_version)
    const targetVersion = item.rulesetVersion;
    if (targetVersion == null || targetVersion === 0) {
      toastError("该发布项无发布版本,无法回滚", "发布队列");
      return;
    }
    const res = await backend.emergencyRollbackRequest(targetVersion, "发布队列紧急回滚");
    if (!res.ok) {
      toastError(res.error ?? "回滚失败", "发布队列");
      return;
    }
    pushNotification({
      type: "publish_status",
      title: "⚠️ 紧急回滚",
      body: `已回滚到 v${targetVersion} (新版本号递增)`,
      link: "/version-history",
    });
    toastSuccess("已紧急回滚", "发布队列");
    await reloadQueue();
  }
</script>

<section class="publish-queue">
  <header class="queue-header">
    <h2>📤 发布队列</h2>
    <span class="queue-count">{queue.length} 条请求</span>
    <span
      class="source-badge"
      class:offline={$netConfig.mode === "offline"}
      title={$netConfig.mode === "online"
        ? `数据来自远程 evorule-server(${$netConfig.remoteBaseUrl})`
        : `数据来自本地 evorule-server(${DEFAULT_LOCAL_BASE_URL})`}
    >
      {$netConfig.mode === "online" ? "联网" : "本地"}
    </span>
  </header>

  {#if loading}
    <div class="queue-empty">⏳ 加载发布队列...</div>
  {:else if error}
    <div class="queue-error">⚠️ {error}</div>
  {:else if queue.length === 0}
    <div class="queue-empty">
      📭 暂无发布请求
      <p class="queue-empty-hint">
        发布请求经治理审批流产生:在「治理中心」将数据集推进到 Active 后提交发布,
        请求会出现在这里等待处理。当前队列健康为空属正常状态。
      </p>
    </div>
  {:else}
    <div class="queue-list">
      {#each queue as req (req.id)}
        <div class="queue-item {statusClass(req.status)}">
          <div class="item-header">
            <span class="item-version">v{req.rulesetVersion}</span>
            <span class="item-status {statusClass(req.status)}">
              {statusLabel(req.status)}
            </span>
            <span class="item-id">{req.id}</span>
          </div>
          <div class="item-meta">
            <span>提交人:{req.submittedBy}</span>
            <span
              >提交时间:{new Date(req.submittedAt).toLocaleString(
                "zh-CN",
              )}</span
            >
            {#if req.reviewedBy}
              <span>审核人:{req.reviewedBy}</span>
            {/if}
            {#if req.reviewComment}
              <span class="item-comment">备注:{req.reviewComment}</span>
            {/if}
          </div>

          <!-- 队列项详情(UV-062 接线④:GET /api/publish/queue/{id} 完整请求体) -->
          <div class="item-actions detail-row">
            <button class="btn btn-ghost" onclick={() => toggleDetail(req)}>
              {detailOpen[req.id] ? "收起详情" : "📋 详情"}
            </button>
            {#if detailCache[req.id]}
              <span class="detail-count">
                规则 {rulesCount(detailCache[req.id].final_candidate_rules) >= 0
                  ? rulesCount(detailCache[req.id].final_candidate_rules)
                  : "—"}{" "}
                条(来源:执行域 server)
              </span>
            {/if}
          </div>
          {#if detailOpen[req.id]}
            {#if detailLoading[req.id]}
              <p class="detail-hint">详情加载中…</p>
            {:else if detailError[req.id]}
              <div class="detail-error">⚠️ {detailError[req.id]}</div>
            {:else if detailCache[req.id]}
              {@const d = detailCache[req.id]}
              <div class="detail-panel">
                <dl class="detail-grid">
                  <div>
                    <dt>队列项 ID</dt>
                    <dd>{d.id}</dd>
                  </div>
                  <div>
                    <dt>workspace</dt>
                    <dd>{d.workspace_id}</dd>
                  </div>
                  <div>
                    <dt>状态</dt>
                    <dd>{statusLabel(d.status)}</dd>
                  </div>
                  <div>
                    <dt>规则集哈希</dt>
                    <dd class="mono">{d.ruleset_hash}</dd>
                  </div>
                  <div>
                    <dt>测试报告沙盒</dt>
                    <dd>{d.test_report_sandbox_id ?? "未关联"}</dd>
                  </div>
                  <div>
                    <dt>发布版本</dt>
                    <dd>{d.published_version ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>描述</dt>
                    <dd>{d.description ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>审核人</dt>
                    <dd>
                      {d.reviewed_by ?? "—"}{d.reviewed_at
                        ? ` · ${fmtTime(d.reviewed_at)}`
                        : ""}
                    </dd>
                  </div>
                </dl>
                <details class="detail-rules">
                  <summary>
                    完整请求体 final_candidate_rules(待发布规则集原文)
                  </summary>
                  <pre>{prettyRules(d.final_candidate_rules)}</pre>
                </details>
              </div>
            {/if}
          {/if}

          {#if req.status === "pending" && canApprove}
            <div class="item-actions">
              <input
                class="comment-input"
                placeholder="审核备注..."
                bind:value={reviewComment[req.id]}
              />
              <button
                class="btn btn-success"
                onclick={() => handleApprove(req)}
              >
                ✅ 批准
              </button>
              <button
                class="btn btn-danger"
                onclick={() => (rejectingId = req.id)}
              >
                ❌ 驳回
              </button>
            </div>
          {/if}

          {#if req.status === "published" && canRollback}
            <div class="item-actions">
              <button
                class="btn btn-warning"
                onclick={() => handleRollback(req)}
              >
                ⏮️ 紧急回滚
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if rejectingId}
    <div class="reject-modal" role="dialog" aria-modal="true">
      <div class="modal-content">
        <h3>驳回发布请求</h3>
        <textarea
          bind:value={rejectComment}
          placeholder="请输入驳回原因..."
          rows="3"
        ></textarea>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick={() => (rejectingId = null)}>
            取消
          </button>
          <button class="btn btn-danger" onclick={handleRejectConfirm}>
            确认驳回
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .publish-queue {
    max-width: 900px;
    margin: 0 auto;
    padding: 24px;
  }
  .queue-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .queue-header h2 {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }
  .queue-count {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
  }
  .source-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--success-bg, #dcfce7);
    color: var(--success, #166534);
  }
  .source-badge.offline {
    background: var(--bg-hover, #f1f5f9);
    color: var(--text-secondary, #64748b);
  }
  .queue-empty {
    padding: 48px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    background: var(--bg-card);
    border-radius: 8px;
  }
  .queue-empty-hint {
    margin: 8px auto 0;
    max-width: 460px;
    font-size: 13px;
    color: var(--text-secondary, #64748b);
    opacity: 0.85;
  }
  .queue-error {
    padding: 48px;
    text-align: center;
    color: var(--danger, #dc2626);
    background: var(--bg-card);
    border-radius: 8px;
  }
  .queue-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .queue-item {
    padding: 16px;
    background: var(--bg-card);
    border-radius: 8px;
    border-left: 4px solid var(--border, #cbd5e1);
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
  }
  .queue-item.status-submitted,
  .queue-item.status-pending {
    border-left-color: var(--warning, #f59e0b);
  }
  .queue-item.status-reviewing {
    border-left-color: var(--info, #3b82f6);
  }
  .queue-item.status-published {
    border-left-color: var(--success, #22c55e);
  }
  .queue-item.status-rejected {
    border-left-color: var(--danger, #dc2626);
  }
  .queue-item.status-rolled_back {
    border-left-color: var(--text-secondary, #64748b);
  }
  .item-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  .item-version {
    font-size: 16px;
    font-weight: 700;
    color: var(--brand, #2563eb);
  }
  .item-status {
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    background: var(--bg-hover, #f1f5f9);
    color: var(--text-secondary, #64748b);
  }
  .item-status.status-submitted,
  .item-status.status-pending {
    background: var(--warning-bg, #fef3c7);
    color: var(--warning, #92400e);
  }
  .item-status.status-reviewing {
    background: var(--info-bg, #dbeafe);
    color: var(--info, #1e40af);
  }
  .item-status.status-published {
    background: var(--success-bg, #dcfce7);
    color: var(--success, #166534);
  }
  .item-status.status-rejected {
    background: var(--danger-bg, #fee2e2);
    color: var(--danger, #991b1b);
  }
  .item-status.status-rolled_back {
    background: var(--bg-hover, #f1f5f9);
    color: var(--text-secondary, #475569);
  }
  .item-id {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-secondary, #94a3b8);
    margin-left: auto;
  }
  .item-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
    margin-bottom: 12px;
  }
  .item-comment {
    color: var(--text-primary, #1e293b);
  }
  .item-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-top: 12px;
    border-top: 1px solid var(--bg-hover, #f1f5f9);
  }
  .comment-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    font-size: 13px;
  }
  .btn {
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .btn-success {
    background: var(--success, #22c55e);
    color: white;
  }
  .btn-danger {
    background: var(--danger, #dc2626);
    color: white;
  }
  .btn-warning {
    background: var(--warning, #f59e0b);
    color: white;
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary, #64748b);
    border: 1px solid var(--border, #cbd5e1);
  }
  .reject-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .modal-content {
    background: var(--bg-card);
    padding: 24px;
    border-radius: 8px;
    width: 90%;
    max-width: 480px;
  }
  .modal-content h3 {
    margin: 0 0 16px 0;
    font-size: 16px;
  }
  .modal-content textarea {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    font-size: 13px;
    resize: vertical;
    margin-bottom: 16px;
  }
  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  /* === 队列项详情(UV-062 接线④) === */
  .item-actions.detail-row {
    justify-content: flex-start;
    margin-bottom: 0;
    padding-bottom: 0;
    border-top: none;
    padding-top: 8px;
  }
  .detail-count {
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }
  .detail-hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }
  .detail-error {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--danger, #dc2626);
  }
  .detail-panel {
    margin-top: 8px;
    padding: 12px;
    background: var(--bg-page, #f8fafc);
    border-radius: 6px;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 8px 16px;
    margin: 0 0 10px;
  }
  .detail-grid div {
    font-size: 12px;
    min-width: 0;
  }
  .detail-grid dt {
    color: var(--text-secondary, #64748b);
  }
  .detail-grid dd {
    margin: 2px 0 0;
    word-break: break-all;
  }
  .mono {
    font-family: monospace;
  }
  .detail-rules summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }
  .detail-rules pre {
    max-height: 320px;
    overflow: auto;
    background: var(--bg-card, #fff);
    padding: 8px;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 4px;
    font-size: 11px;
    margin: 6px 0 0;
  }
</style>
