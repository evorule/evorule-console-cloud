<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /governance 路由 — Phase 2 F1 治理接线(真实后端,非 mock)。
  通过 GovernanceBackend 直连 evorule-rule(:18081) REST:
    连接 → 数据集列表/创建 → 条目(规则)灌入 → 5 态生命周期 + 独立审批发布 → 版本链。
  生命周期:Draft → Candidate → Active → Published → Rejected(权限由 evorule-rule 后端强制,
  错误不静默,toast 展示后端 error.message)。
  边界:本页治理数据来自 evorule-rule(资产库),与 evorule-server(执行)解耦。
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { toastSuccess, toastError, toastInfo } from '$lib/stores/toast';
  import {
    governanceStore,
    connect,
    disconnect,
    refreshDatasets,
    createDataset,
    selectDataset,
    addEntry,
    transition,
    publish,
    unpublish,
    createVersion
  } from '$lib/governance/governance-store';
  import { governanceConfig, updateGovernanceConfig } from '$lib/config/governance-config';
  import type { EntryDiffResponse, EntryVersionPayloadResponse, EntryVersionSummary, LifecycleStatus } from '$lib/governance/types';
  import { isKnowledgeEntry } from '$lib/governance/governance-store';
  import { useWorkspaceBackendOrNull } from '$lib/kernel';
  import type { ActiveBundleInfo, BundleDryRunResult, BundleImportResult } from '$lib/kernel';
  import GuidedHint from '$lib/views/Feedback/GuidedHint.svelte';
  import JsonViewer from '$lib/views/Dataset/JsonViewer.svelte';

  // WorkspaceBackend 必须在组件初始化期从 context 取出并缓存——
  // getContext/hasContext 只能在组件初始化期间调用,异步回调(部署/预检/刷新)中调用
  // 会抛 Svelte lifecycle_outside_component 错误(32 号 UI 实测发现)。
  const workspaceBackend = useWorkspaceBackendOrNull();

  // ===== 连接面板 =====
  let connecting = $state(false);
  let connError = $state<string | null>(null);

  // ===== 创建数据集 =====
  let showCreate = $state(false);
  let newDs = $state({
    dataset_id: '',
    name: '',
    description: '',
    domain: '',
    tags: '',
    visibility: 'private' as 'private' | 'public'
  });

  // ===== 添加条目 =====
  let showAddEntry = $state(false);
  let newEntry = $state({
    entry_id: '',
    version: 1,
    domain: '',
    rule_body: ''
  });
  let entryError = $state<string | null>(null);

  // ===== 发布确认 =====
  let publishConfirm = $state(false);
  let publishReason = $state('');

  // 文本域占位(Svelte 不解析单引号属性内的花括号表达式,故用变量)
  const RULE_BODY_PLACEHOLDER = '{ "rule_id": "...", "transform": [ ... ] }';

  onMount(() => {
    // 已连接(刷新后内存 token 丢失)则不自动重连;仅清空过期状态
    const s = get(governanceStore);
    if (!s.connected) {
      disconnect();
    }
  });

  // ===== 连接 =====
  /**
   * 可达性探测(UV-007 连通性自检):no-cors 模式下仅判网络层通断,
   * resolve=服务可达(reject=不可达),不读响应内容( opaque,无 CORS 依赖)。
   */
  async function probeReachable(baseUrl: string): Promise<boolean> {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      await fetch(baseUrl.replace(/\/+$/, '') + '/', {
        method: 'GET',
        mode: 'no-cors',
        signal: ctl.signal
      });
      clearTimeout(timer);
      return true;
    } catch {
      return false;
    }
  }

  async function handleConnect(): Promise<void> {
    const cfg = get(governanceConfig);
    if (!cfg.baseUrl.trim() || !cfg.username || !cfg.password) {
      connError = '请填写完整连接信息(baseUrl/用户名/密码)';
      return;
    }
    connecting = true;
    connError = null;
    try {
      await connect(cfg.baseUrl.trim(), cfg.tenantId.trim() || 'default', cfg.username, cfg.password);
      toastSuccess('已连接 evorule-rule', '治理');
    } catch (e) {
      // UV-007 连通性自检:区分「服务不可达」与「凭据/权限错误」,分别给出自服务引导
      const reachable = await probeReachable(cfg.baseUrl.trim());
      const raw = e instanceof Error ? e.message : String(e);
      connError = reachable
        ? `服务可达但登录失败:${raw}\n请检查用户名/密码(治理凭据与主系统独立;体验包演示凭据 admin/evorule-demo,见 README-STARTUP.txt)。`
        : `无法连接治理服务 ${cfg.baseUrl.trim()}。\n请确认 evorule-rule-serve(:18081)已启动 —— 分发包由 start-evorule.bat 自动拉起,手动部署见 README-STARTUP.txt;若刚启动请稍候重试。`;
    } finally {
      connecting = false;
    }
  }

  function handleDisconnect(): void {
    disconnect();
    toastInfo('已断开治理服务连接', '治理');
  }

  // ===== 数据集 =====
  async function handleCreateDataset(): Promise<void> {
    if (!newDs.dataset_id.trim() || !newDs.name.trim()) {
      toastError('dataset_id 与 name 必填', '创建数据集');
      return;
    }
    try {
      await createDataset({
        dataset_id: newDs.dataset_id.trim(),
        name: newDs.name.trim(),
        description: newDs.description.trim() || undefined,
        domain: newDs.domain.split(',').map((s) => s.trim()).filter(Boolean),
        tags: newDs.tags.split(',').map((s) => s.trim()).filter(Boolean),
        visibility: newDs.visibility
      });
      toastSuccess(`数据集 ${newDs.name} 已创建(Draft)`, '治理');
      showCreate = false;
      newDs = { dataset_id: '', name: '', description: '', domain: '', tags: '', visibility: 'private' };
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), '创建数据集');
    }
  }

  async function handleDeleteDataset(id: string, name: string): Promise<void> {
    if (!confirm(`确认删除数据集「${name}」?仅 Draft/Rejected 可删,且需管理员权限。`)) return;
    try {
      const bk = get(governanceStore).backend;
      if (!bk) throw new Error('未连接');
      await bk.deleteDataset(id);
      toastSuccess(`数据集 ${name} 已删除`, '治理');
      await refreshDatasets();
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), '删除数据集');
    }
  }

  // ===== 生命周期 =====
  async function handleTransition(to: 'candidate' | 'active' | 'rejected'): Promise<void> {
    const label = { candidate: '提交候选', active: '激活(Active)', rejected: '驳回' }[to];
    try {
      await transition(to);
      toastSuccess(`生命周期 → ${label}`, '治理');
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), label);
    }
  }

  async function handlePublish(): Promise<void> {
    if (!publishConfirm) {
      toastError('独立发布需二次确认:请勾选确认框', '发布审批');
      return;
    }
    try {
      await publish(publishReason.trim() || undefined);
      toastSuccess('已发布(Published)', '治理');
      publishConfirm = false;
      publishReason = '';
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), '发布审批');
    }
  }

  async function handleUnpublish(): Promise<void> {
    if (!confirm('确认撤销发布(Published → Rejected)?仅管理员可操作。')) return;
    try {
      await unpublish();
      toastSuccess('已撤销发布(Rejected)', '治理');
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), '撤销发布');
    }
  }

  // ===== 版本 =====
  async function handleCreateVersion(kind: 'major' | 'patch'): Promise<void> {
    const label = kind === 'major' ? '升版(Major)' : '打补丁(Patch)';
    try {
      await createVersion(kind);
      toastSuccess(`版本 ${label} 已创建`, '治理');
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), label);
    }
  }

  // ===== 部署到执行域(32 号 UI 接线:治理 Published → 导出 bundle → 执行域导入激活) =====
  let showDeploy = $state(false);
  let deployConfirmed = $state(false);
  let deploying = $state(false);
  let dryRunning = $state(false);
  let deployError = $state<string | null>(null);
  let deployResult = $state<BundleImportResult | null>(null);
  let dryRunResult = $state<BundleDryRunResult | null>(null);
  /** 当前执行域激活 bundle(按 dataset_id 匹配选中数据集,部署徽标数据源) */
  let activeBundles = $state<ActiveBundleInfo[]>([]);

  function selectedActiveBundle(): ActiveBundleInfo | null {
    const s = get(governanceStore);
    if (!s.selectedId) return null;
    return activeBundles.find((b) => b.dataset_id === s.selectedId) ?? null;
  }

  /** 拉取执行域当前激活 bundle(失败不静默:console.warn 可观测,徽标显示"未知") */
  async function refreshActiveBundles(): Promise<void> {
    const wb = workspaceBackend;
    if (!wb) return;
    try {
      activeBundles = await wb.listActiveBundles();
    } catch (e) {
      console.warn('[governance] 拉取执行域激活 bundle 失败:', e);
    }
  }

  function openDeploy(): void {
    showDeploy = true;
    deployConfirmed = false;
    deployError = null;
    deployResult = null;
    dryRunResult = null;
    void refreshActiveBundles();
  }

  /**
   * 导出带人工确认证据的 bundle(闸门一:verdict=pass 由操作者背书,32 号 §3 方案 B)。
   * 仅在 deployConfirmed 勾选后可调用 — 证据声明先于一切部署动作。
   */
  async function exportBundleForDeploy(): Promise<unknown> {
    const s = get(governanceStore);
    const bk = s.backend;
    if (!bk || !s.selectedId) throw new Error('未连接治理服务或未选中数据集');
    const version = s.versioning?.current
      ?? s.datasets.find((d) => d.dataset_id === s.selectedId)?.versioning.current;
    if (!version) throw new Error('无法确定数据集当前版本');
    return bk.exportBundle(s.selectedId, version, true);
  }

  /** 预检:导出 → dry-run 导入(校验链全跑,不落盘不 reload) */
  async function handleDeployDryRun(): Promise<void> {
    if (!deployConfirmed) return;
    dryRunning = true;
    dryRunResult = null;
    deployError = null;
    try {
      const bundle = await exportBundleForDeploy();
      const wb = workspaceBackend;
      if (!wb) throw new Error('执行域通道不可用:请连接 evorule-server');
      dryRunResult = await wb.dryRunImportBundle(bundle);
      toastSuccess('预检通过(校验链全绿,未落盘)', '部署预检');
    } catch (e) {
      deployError = e instanceof Error ? e.message : String(e);
      toastError(deployError, '部署预检');
    } finally {
      dryRunning = false;
    }
  }

  /** 确认部署:导出(带人工确认证据) → 导入执行域 → 激活反馈 */
  async function handleDeploy(): Promise<void> {
    if (!deployConfirmed) return;
    deploying = true;
    deployError = null;
    deployResult = null;
    try {
      const bundle = await exportBundleForDeploy();
      const wb = workspaceBackend;
      if (!wb) throw new Error('执行域通道不可用:请连接 evorule-server');
      deployResult = await wb.importBundle(bundle);
      toastSuccess(
        `已激活 ${deployResult.activated_version} · ${deployResult.entry_count} 条规则 · 新会话即生效`,
        '部署到执行域'
      );
      await refreshActiveBundles();
    } catch (e) {
      deployError = e instanceof Error ? e.message : String(e);
      toastError(deployError, '部署到执行域');
    } finally {
      deploying = false;
    }
  }

  // ===== 条目 =====
  async function handleAddEntry(): Promise<void> {
    const s = get(governanceStore);
    if (!s.selectedId) return;
    entryError = null;
    if (!newEntry.entry_id.trim()) {
      entryError = 'entry_id 必填';
      return;
    }
    let ruleBody: unknown;
    try {
      ruleBody = JSON.parse(newEntry.rule_body);
    } catch {
      entryError = 'rule_body 不是合法 JSON(规则体须为 evorule 原生 JSON)';
      return;
    }
    try {
      await addEntry(s.selectedId, {
        entry_id: newEntry.entry_id.trim(),
        version: Number(newEntry.version) || 1,
        domain: newEntry.domain.trim() || undefined,
        rule_body: ruleBody
      });
      toastSuccess(`规则 ${newEntry.entry_id} 已入库`, '治理');
      showAddEntry = false;
      newEntry = { entry_id: '', version: 1, domain: '', rule_body: '' };
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), '添加规则');
    }
  }

  // ===== 条目版本与对比（条目 diff 工具专项；规则/数据条目通用，后端已同构分流） =====
  let diffOpen = $state<Record<string, boolean>>({});
  let versionCache = $state<Record<string, EntryVersionSummary[]>>({});
  let diffCache = $state<Record<string, EntryDiffResponse>>({});
  let diffFrom = $state<Record<string, number>>({});
  let diffTo = $state<Record<string, number>>({});
  let diffLoading = $state<Record<string, boolean>>({});
  let diffError = $state<Record<string, string | null>>({});
  // D-B③ 双栏载荷缓存（key = "from:to"，版本不可变故可安全缓存）
  let payloadCache = $state<Record<string, { key: string; fromPayload: unknown; toPayload: unknown }>>({});

  /** 载荷提取：规则条目展示 rule_body，数据条目展示 payload（D-B③ 口径） */
  function payloadOf(e: unknown): unknown {
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      if ('payload' in o) return o.payload;
      if ('rule_body' in o) return o.rule_body;
    }
    return e;
  }

  /** 展开/收起条目的"版本与对比"区（首次展开拉取版本链，默认选最后两版） */
  async function toggleDiff(entryId: string): Promise<void> {
    diffOpen[entryId] = !diffOpen[entryId];
    if (diffOpen[entryId] && !versionCache[entryId]) {
      const bk = get(governanceStore).backend;
      if (!bk) {
        diffError[entryId] = '未连接治理服务';
        return;
      }
      diffError[entryId] = null;
      diffLoading[entryId] = true;
      try {
        const r = await bk.entryVersions(entryId);
        versionCache[entryId] = r.versions;
        const vs = r.versions;
        if (vs.length >= 2) {
          diffFrom[entryId] = vs[vs.length - 2].version;
          diffTo[entryId] = vs[vs.length - 1].version;
        } else if (vs.length === 1) {
          diffFrom[entryId] = vs[0].version;
          diffTo[entryId] = vs[0].version;
        }
      } catch (e) {
        diffError[entryId] = e instanceof Error ? e.message : String(e);
      } finally {
        diffLoading[entryId] = false;
      }
    }
  }

  /** 执行对比（from < to；结果缓存到 diffCache） */
  async function runDiff(entryId: string): Promise<void> {
    const from = diffFrom[entryId];
    const to = diffTo[entryId];
    if (!from || !to || from >= to) {
      toastError('对比区间非法:from 须小于 to', '条目 diff');
      return;
    }
    const bk = get(governanceStore).backend;
    if (!bk) {
      diffError[entryId] = '未连接治理服务';
      return;
    }
    diffError[entryId] = null;
    diffLoading[entryId] = true;
    try {
      diffCache[entryId] = await bk.entryDiff(entryId, from, to);
      // D-B③：回查双版本完整载荷（同区间命中缓存则跳过）
      const key = `${from}:${to}`;
      if (payloadCache[entryId]?.key !== key) {
        const [pf, pt]: [EntryVersionPayloadResponse, EntryVersionPayloadResponse] = await Promise.all([
          bk.entryVersionPayload(entryId, from),
          bk.entryVersionPayload(entryId, to)
        ]);
        payloadCache[entryId] = { key, fromPayload: payloadOf(pf.entry), toPayload: payloadOf(pt.entry) };
      }
    } catch (e) {
      diffError[entryId] = e instanceof Error ? e.message : String(e);
    } finally {
      diffLoading[entryId] = false;
    }
  }

  function shortHash(h?: string): string {
    if (!h) return '-';
    return h.length > 14 ? `${h.slice(0, 14)}…` : h;
  }

  // ===== 派生 =====
  // 注意:必须用 $governanceStore 直接引用(Svelte 5 $derived 不追踪 get(store)),
  //       否则选中数据集/角色在 store 变化后不会更新。
  const selected = $derived(
    $governanceStore.datasets.find((d) => d.dataset_id === $governanceStore.selectedId) ?? null
  );
  const selectedStatus = $derived(selected?.lifecycle.status ?? null);
  const role = $derived($governanceStore.role);
  const roleHint = $derived(
    role === 'admin'
      ? '管理员:全部操作'
      : role === 'approver'
        ? '审批者:可 激活/发布(二次确认)/驳回;不可建数据集'
        : role === 'rule_engineer'
          ? '规则工程师:可 建数据集/灌规则/提交候选/打版本;激活与发布需审批者'
          : '查看者:只读'
  );

  const statusLabel: Record<LifecycleStatus, string> = {
    Draft: '草稿',
    Candidate: '候选',
    Active: '激活',
    Published: '已发布',
    Rejected: '已驳回'
  };

  // Q12 段2 P5:数据集类型徽标(缺省 = rule_set,兼容旧后端)
  function kindLabel(ds: { dataset_kind?: string }): string {
    return ds.dataset_kind === 'knowledge' ? '数据资产' : '规则集';
  }
  function kindClass(ds: { dataset_kind?: string }): string {
    return ds.dataset_kind === 'knowledge' ? 'kind-knowledge' : 'kind-ruleset';
  }
  const selectedIsKnowledge = $derived(selected?.dataset_kind === 'knowledge');

  function statusClass(s: LifecycleStatus): string {
    return `status-${s.toLowerCase()}`;
  }

  function fmtTime(iso?: string | null): string {
    if (!iso) return '-';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN');
  }

  function rulePreview(body: unknown): string {
    const s = JSON.stringify(body);
    return s && s.length > 160 ? `${s.slice(0, 160)}…` : (s ?? '');
  }
</script>

<!-- 条目「版本与对比」区（条目 diff 工具专项;规则/数据条目共用片段） -->
{#snippet entryDiff(entryId: string)}
  <button class="btn btn-sm diff-toggle" onclick={() => toggleDiff(entryId)}>
    {diffOpen[entryId] ? '收起版本对比' : '版本与对比'}
  </button>
  {#if diffOpen[entryId]}
    <div class="diff-panel">
      {#if diffError[entryId]}
        <p class="diff-error">{diffError[entryId]}</p>
      {:else if diffLoading[entryId]}
        <p class="muted">加载中…</p>
      {:else if (versionCache[entryId] ?? []).length === 0}
        <p class="muted">无版本记录。</p>
      {:else}
        <div class="vchain">
          {#each versionCache[entryId] as v (v.version)}
            <span class="vrow">
              <span class="muted">v{v.version}</span>
              {#if v.status && v.status !== 'Active'}
                <span class="badge {statusClass(v.status)}">{statusLabel[v.status] ?? v.status}</span>
              {/if}
              <span class="chip" title="BLAKE3 内容哈希(content_hash 刻定内容)">{shortHash(v.content_hash)}</span>
            </span>
          {/each}
        </div>
        {#if (versionCache[entryId] ?? []).length >= 2}
          <div class="diff-controls">
            <select bind:value={diffFrom[entryId]} aria-label="起始版本">
              {#each versionCache[entryId] as v (v.version)}
                <option value={v.version}>v{v.version}</option>
              {/each}
            </select>
            <span class="muted">→</span>
            <select bind:value={diffTo[entryId]} aria-label="目标版本">
              {#each versionCache[entryId] as v (v.version)}
                <option value={v.version}>v{v.version}</option>
              {/each}
            </select>
            <button class="btn btn-sm" onclick={() => runDiff(entryId)}>对比</button>
          </div>
          {#if diffCache[entryId]}
            {@const d = diffCache[entryId] as EntryDiffResponse}
            {@const p = payloadCache[entryId]}
            <div class="diff-result">
              <span class="badge {d.changed ? 'diff-changed' : 'diff-same'}">
                {d.changed ? `内容已变 v${d.from} → v${d.to}` : `内容未变 v${d.from} → v${d.to}`}
              </span>
              <span class="chip" title="起始版本内容哈希">{shortHash(d.from_content_hash)}</span>
              <span class="muted">→</span>
              <span class="chip" title="目标版本内容哈希">{shortHash(d.to_content_hash)}</span>
              {#if d.keys}
                <div class="keys">
                  {#each d.keys.added as key (key)}<span class="key-badge key-added" title="新增">+ {key}</span>{/each}
                  {#each d.keys.removed as key (key)}<span class="key-badge key-removed" title="移除">− {key}</span>{/each}
                  {#each d.keys.changed as key (key)}<span class="key-badge key-changed" title="变更">± {key}</span>{/each}
                </div>
              {/if}
              {#if p && p.key === `${d.from}:${d.to}`}
                <!-- D-B③：双版本载荷并排（规则条目=rule_body，数据条目=payload） -->
                <div class="payload-cols">
                  <div class="payload-col">
                    <p class="muted payload-title">v{d.from} 载荷</p>
                    <JsonViewer value={p.fromPayload} maxHeight="320px" />
                  </div>
                  <div class="payload-col">
                    <p class="muted payload-title">v{d.to} 载荷</p>
                    <JsonViewer value={p.toPayload} maxHeight="320px" />
                  </div>
                </div>
              {/if}
              <p class="muted diff-note">键级归因口径（content_hash + 顶层路径）；载荷为各版本完整内容快照（全版本留痕可回查）。</p>
            </div>
          {/if}
        {:else}
          <p class="muted">仅一个版本,无对比区间。</p>
        {/if}
      {/if}
    </div>
  {/if}
{/snippet}

<!-- PR7:治理中心首访提示 -->
<GuidedHint
  hintId="governance"
  variant="tip"
  title="治理中心 · 规则即资产"
  body="先连接规则资产库(:18081),再建数据集、灌入规则,走 Draft → Candidate → Active → Published 五态生命周期。完整的生命周期说明见「帮助」页。"
/>

<!-- ==================== 未连接:连接面板 ==================== -->
{#if !$governanceStore.connected}
  <div class="conn-wrap">
    <div class="card conn-card">
      <h2>治理服务连接(evorule-rule)</h2>
      <p class="hint">
        连接规则资产库(:18081)以管理数据集、规则与发布。密码仅存本地(localStorage),不上传。
      </p>
      <p class="hint boundary-note">
        <strong>为什么是两个系统?</strong>治理中心是独立子系统 evorule-rule(规则资产库:
        五态生命周期、审批发布、版本链),主系统 evorule-server(:18080)负责规则执行与审计。
        资产与执行解耦,凭据也相互独立 —— 这是设计而非故障。体验包演示凭据:admin / evorule-demo(见 README-STARTUP.txt);
        正式部署须先换密钥与密码(幂等引导仅首启生效,详见 README-STARTUP.txt「安全提示」)。
      </p>
      <label class="field">
        <span>服务地址</span>
        <input
          type="text"
          value={$governanceConfig.baseUrl}
          oninput={(e) => updateGovernanceConfig({ baseUrl: (e.currentTarget as HTMLInputElement).value })}
          placeholder="http://127.0.0.1:18081"
        />
      </label>
      <label class="field">
        <span>租户 ID</span>
        <input
          type="text"
          value={$governanceConfig.tenantId}
          oninput={(e) => updateGovernanceConfig({ tenantId: (e.currentTarget as HTMLInputElement).value })}
          placeholder="default"
        />
      </label>
      <div class="field-row">
        <label class="field">
          <span>用户名</span>
          <input
            type="text"
            value={$governanceConfig.username}
            oninput={(e) => updateGovernanceConfig({ username: (e.currentTarget as HTMLInputElement).value })}
            placeholder="admin"
          />
        </label>
        <label class="field">
          <span>密码</span>
          <input
            type="password"
            value={$governanceConfig.password}
            oninput={(e) => updateGovernanceConfig({ password: (e.currentTarget as HTMLInputElement).value })}
            placeholder="••••••••"
          />
        </label>
      </div>
      {#if connError}
        <div class="err-box">{connError}</div>
      {/if}
      <button class="btn btn-primary" onclick={handleConnect} disabled={connecting}>
        {connecting ? '连接中…' : '连接'}
      </button>
    </div>
  </div>

  <!-- ==================== 已连接:数据集管理 ==================== -->
{:else}
  <div class="gov-header">
    <div>
      <h2>规则资产库</h2>
      <p class="hint">
        {$governanceStore.baseUrl} · 租户「{$governanceStore.tenantId}」· 用户「{$governanceStore.username}」
        · 角色:{$governanceStore.role ?? '-'}
      </p>
    </div>
    <div class="gov-header-right">
      <button class="btn" onclick={() => refreshDatasets().catch(() => undefined)} title="刷新数据集列表">
        ⟳ 刷新
      </button>
      <button class="btn btn-ghost" onclick={handleDisconnect}>断开</button>
    </div>
  </div>

  <div class="gov-layout">
    <!-- 左:数据集列表 -->
    <aside class="card ds-panel">
      <div class="ds-panel-head">
        <span>数据集({$governanceStore.datasets.length})</span>
        <button class="btn btn-sm" onclick={() => (showCreate = !showCreate)}>
          {showCreate ? '收起' : '+ 新建'}
        </button>
      </div>

      {#if showCreate}
        <div class="create-form">
          <label class="field">
            <span>dataset_id *</span>
            <input bind:value={newDs.dataset_id} placeholder="ds-yuanze-01" />
          </label>
          <label class="field">
            <span>名称 *</span>
            <input bind:value={newDs.name} placeholder="yuanze 机器人质量管控规则集" />
          </label>
          <label class="field">
            <span>描述</span>
            <textarea bind:value={newDs.description} rows="2" placeholder="可选"></textarea>
          </label>
          <label class="field">
            <span>领域(逗号分隔)</span>
            <input bind:value={newDs.domain} placeholder="robot,quality" />
          </label>
          <label class="field">
            <span>标签(逗号分隔)</span>
            <input bind:value={newDs.tags} placeholder="合规,机器人" />
          </label>
          <label class="field">
            <span>可见性</span>
            <select bind:value={newDs.visibility}>
              <option value="private">private</option>
              <option value="public">public</option>
            </select>
          </label>
          <button class="btn btn-primary btn-sm" onclick={handleCreateDataset}>创建</button>
        </div>
      {/if}

      {#if $governanceStore.loadingDatasets}
        <div class="muted">加载中…</div>
      {:else if $governanceStore.datasets.length === 0}
        <div class="muted empty">尚无数据集。点「+ 新建」创建。</div>
      {:else}
        <ul class="ds-list">
          {#each $governanceStore.datasets as ds (ds.dataset_id)}
            <li>
              <button
                class="ds-item"
                class:active={ds.dataset_id === $governanceStore.selectedId}
                onclick={() => selectDataset(ds.dataset_id)}
              >
                <span class="ds-item-top">
                  <span class="ds-name">{ds.name || ds.dataset_id}</span>
                  <span class="ds-item-badges">
                    <span class="badge {kindClass(ds)}">{kindLabel(ds)}</span>
                    <span class="badge {statusClass(ds.lifecycle.status)}">{statusLabel[ds.lifecycle.status]}</span>
                  </span>
                </span>
                <span class="ds-item-sub">
                  {ds.dataset_id} · {ds.versioning.current} · {fmtTime(ds.meta.created_at)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>

    <!-- 右:选中数据集详情 -->
    <section class="card ds-detail">
      {#if selected}
        <div class="detail-head">
          <div>
            <h3>{selected.name}</h3>
            <p class="muted">{selected.dataset_id} · 租户 {selected.tenant_id} · {selected.visibility}</p>
            {#if selected.description}<p class="desc">{selected.description}</p>{/if}
          </div>
          <span class="ds-item-badges">
            <span class="badge badge-lg {kindClass(selected)}">{kindLabel(selected)}</span>
            <span class="badge badge-lg {statusClass(selected.lifecycle.status)}">
              {statusLabel[selected.lifecycle.status]}
            </span>
          </span>
        </div>

        <p class="hint">{roleHint}</p>

        <!-- 生命周期动作 -->
        <div class="lc-actions">
          {#if selectedStatus === 'Draft'}
            <button class="btn btn-sm" onclick={() => handleTransition('candidate')}>提交候选(Candidate)</button>
            <button class="btn btn-sm btn-danger" onclick={() => handleDeleteDataset(selected.dataset_id, selected.name)}>
              删除(需管理员)
            </button>
          {:else if selectedStatus === 'Candidate'}
            <button class="btn btn-sm btn-primary" onclick={() => handleTransition('active')}>激活(Active)</button>
            <button class="btn btn-sm btn-danger" onclick={() => handleTransition('rejected')}>驳回(Rejected)</button>
          {:else if selectedStatus === 'Active'}
            <div class="publish-box">
              <label class="check">
                <input type="checkbox" bind:checked={publishConfirm} />
                <span>我确认已完成独立发布审批(发布后对外可见可拉取)</span>
              </label>
              <input
                class="reason"
                type="text"
                bind:value={publishReason}
                placeholder="发布原因(可选,进审计 cause)"
              />
              <button class="btn btn-sm btn-primary" onclick={handlePublish}>发布(Published)</button>
            </div>
          {:else if selectedStatus === 'Published'}
            <button class="btn btn-sm btn-primary" onclick={openDeploy}>🚀 部署到执行域</button>
            <button class="btn btn-sm btn-danger" onclick={handleUnpublish}>撤销发布(Rejected,需管理员)</button>
          {:else if selectedStatus === 'Rejected'}
            <button class="btn btn-sm" onclick={() => handleTransition('candidate')}>重新提交候选</button>
          {/if}
        </div>

        <!-- 部署到执行域(32 号 UI 接线:Published 数据集 → 导出 bundle → 执行域导入激活) -->
        {#if selectedStatus === 'Published' && showDeploy}
          <div class="deploy-box">
            <div class="deploy-head">
              <strong>🚀 部署到执行域</strong>
              <button class="btn btn-sm btn-ghost" onclick={() => (showDeploy = false)}>收起</button>
            </div>
            <p class="muted">
              数据集 <strong>{selected.name}</strong>({selected.dataset_id})
              · 版本 <strong>{$governanceStore.versioning?.current ?? selected.versioning.current}</strong>
              · 规则条目 {$governanceStore.entries.length} 条
              · 目标:执行域 evorule-server(规则落盘激活,新会话即生效,已有会话不受影响)
            </p>

            {#if selectedActiveBundle() !== null}
              {@const ab = selectedActiveBundle()!}
              <p class="deploy-active">
                当前执行域激活:{ab.source_version} · {ab.entry_count} 条 ·
                <span class="chip" title="BLAKE3 内容哈希">{ab.content_hash.slice(0, 14)}…</span>
              </p>
            {/if}

            <label class="check">
              <input type="checkbox" bind:checked={deployConfirmed} />
              <span>
                <strong>证据声明(闸门一)</strong>
                本数据集未关联沙箱自动验证证据。部署即声明:该版本已经过验证,可进入生产。
                我确认该版本已完成验证。
              </span>
            </label>

            <div class="btn-row">
              <button
                class="btn btn-sm"
                onclick={handleDeployDryRun}
                disabled={!deployConfirmed || dryRunning || deploying}
              >
                {dryRunning ? '预检中…' : '预检(dry-run,不落盘)'}
              </button>
              <button
                class="btn btn-sm btn-primary"
                onclick={handleDeploy}
                disabled={!deployConfirmed || deploying || dryRunning}
              >
                {deploying ? '部署中…' : '确认部署'}
              </button>
            </div>

            {#if dryRunResult}
              <p class="deploy-ok">
                ✅ 预检通过:{dryRunResult.entry_count} 条 · 版本 {dryRunResult.source_version}
                · 校验链全绿(未落盘)
              </p>
            {/if}

            {#if deployResult}
              <p class="deploy-ok">
                ✅ 已激活 {deployResult.activated_version} · {deployResult.entry_count} 条规则
                · 新会话即生效
              </p>
            {/if}

            {#if deployError}
              <div class="err-box">{deployError}</div>
            {/if}
          </div>
        {/if}

        <!-- 版本链 -->
        <div class="sec">
          <div class="sec-head">
            <span>版本链</span>
            <span class="muted">当前 {$governanceStore.versioning?.current ?? selected.versioning.current}</span>
          </div>
          <div class="chip-row">
            {#each selected.versioning.chain as v (v)}
              <span class="chip">{v}</span>
            {/each}
          </div>
          <div class="btn-row">
            <button class="btn btn-sm" onclick={() => handleCreateVersion('major')} title="法规条款级变化 → 主版本 +1">
              升版(Major)
            </button>
            <button class="btn btn-sm" onclick={() => handleCreateVersion('patch')} title="内部小改 → v2.p1">
              打补丁(Patch)
            </button>
          </div>
        </div>

        <!-- 状态历史 -->
        {#if selected.lifecycle.state_history.length > 0}
          <div class="sec">
            <div class="sec-head"><span>状态历史(只增不改)</span></div>
            <ul class="hist">
              {#each selected.lifecycle.state_history as h, i (i)}
                <li>
                  <span class="badge {statusClass(h.to as LifecycleStatus)}">{statusLabel[h.to as LifecycleStatus] ?? h.to}</span>
                  <span class="muted">{fmtTime(h.at)} · {h.by}</span>
                  <span class="cause">{h.cause}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- 条目(Q12 段2 P5:按数据集类型分流 —— rule_set = 规则条目;knowledge = 数据资产条目) -->
        <div class="sec">
          <div class="sec-head">
            <span>
              {selectedIsKnowledge ? `数据条目(${$governanceStore.entries.length})` : `规则条目(${$governanceStore.entries.length})`}
            </span>
            {#if !selectedIsKnowledge}
              <button class="btn btn-sm" onclick={() => (showAddEntry = !showAddEntry)}>
                {showAddEntry ? '收起' : '+ 灌入规则'}
              </button>
            {/if}
          </div>

          {#if showAddEntry && !selectedIsKnowledge}
            <div class="entry-form">
              <div class="field-row">
                <label class="field">
                  <span>entry_id *</span>
                  <input bind:value={newEntry.entry_id} placeholder="rule-compute-ik" />
                </label>
                <label class="field">
                  <span>版本</span>
                  <input type="number" min="1" bind:value={newEntry.version} />
                </label>
                <label class="field">
                  <span>领域</span>
                  <input bind:value={newEntry.domain} placeholder="robot" />
                </label>
              </div>
              <label class="field">
                <span>rule_body(evorule 原生 JSON,零转译)</span>
                <textarea bind:value={newEntry.rule_body} rows="6" placeholder={RULE_BODY_PLACEHOLDER}></textarea>
              </label>
              {#if entryError}<div class="err-box">{entryError}</div>{/if}
              <button class="btn btn-sm btn-primary" onclick={handleAddEntry}>入库</button>
            </div>
          {/if}

          {#if $governanceStore.loadingEntries}
            <div class="muted">加载中…</div>
          {:else if $governanceStore.entries.length === 0}
            <div class="muted empty">
              {selectedIsKnowledge ? '尚无数据条目。数据资产条目经治理 API 或快照包导入。' : '尚无规则条目。点「+ 灌入规则」粘贴 evorule 规则 JSON。'}
            </div>
          {:else if selectedIsKnowledge}
            <ul class="entry-list">
              {#each $governanceStore.entries as e (e.entry_id)}
                {@const k = e as import('$lib/governance/types').KnowledgeEntry}
                <li>
                  <div class="entry-top">
                    <span class="entry-id">{k.entry_id}</span>
                    <span class="muted">v{k.version}{k.domain ? ` · ${k.domain}` : ''}</span>
                    {#if k.status && k.status !== 'Active'}
                      <span class="badge {statusClass(k.status)}">{statusLabel[k.status] ?? k.status}</span>
                    {/if}
                  </div>
                  <div class="kn-meta">
                    <span class="chip" title="领域 JSON Schema 引用(D3 强校验锚)">{k.schema_ref}</span>
                    {#each k.tags as t (t)}
                      <span class="chip">{t}</span>
                    {/each}
                  </div>
                  {#if k.provenance?.source}
                    <p class="muted kn-source">溯源:{k.provenance.source}{k.provenance.clause ? ` · ${k.provenance.clause}` : ''}</p>
                  {/if}
                  <JsonViewer value={k.payload} maxHeight="320px" />
                  {@render entryDiff(k.entry_id)}
                </li>
              {/each}
            </ul>
          {:else}
            <ul class="entry-list">
              {#each $governanceStore.entries as e (e.entry_id)}
                {#if !isKnowledgeEntry(e)}
                  <li>
                    <div class="entry-top">
                      <span class="entry-id">{e.entry_id}</span>
                      <span class="muted">v{e.version}{e.domain ? ` · ${e.domain}` : ''}</span>
                      {#if e.status && e.status !== 'Active'}
                        <span class="badge {statusClass(e.status)}">{statusLabel[e.status] ?? e.status}</span>
                      {/if}
                    </div>
                    <pre class="entry-body">{rulePreview(e.rule_body)}</pre>
                    {@render entryDiff(e.entry_id)}
                  </li>
                {/if}
              {/each}
            </ul>
          {/if}
        </div>
      {:else}
        <div class="muted empty">← 从左侧选择数据集,或新建一个开始治理。</div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .conn-wrap {
    display: flex;
    justify-content: center;
    padding: var(--spacing-2xl) var(--spacing-lg);
  }
  .conn-card {
    width: 100%;
    max-width: 480px;
  }
  .conn-card h2 {
    margin: 0 0 var(--spacing-xs);
  }
  .hint {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin: 0 0 var(--spacing-md);
  }
  .boundary-note {
    border-left: 3px solid var(--brand);
    padding-left: var(--spacing-sm);
    background: color-mix(in srgb, var(--brand) 5%, transparent);
    padding-top: var(--spacing-xs);
    padding-bottom: var(--spacing-xs);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-md);
  }
  .field > span {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .field input,
  .field textarea,
  .field select,
  .reason {
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-page);
    font-size: var(--text-sm);
    color: inherit;
  }
  .field textarea {
    font-family: monospace;
    resize: vertical;
  }
  .field-row {
    display: flex;
    gap: var(--spacing-md);
  }
  .field-row .field {
    flex: 1;
  }
  .err-box {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    padding: var(--spacing-sm) var(--spacing-md);
    font-size: var(--text-sm);
    margin-bottom: var(--spacing-md);
    white-space: pre-wrap;
  }
  .btn {
    padding: var(--spacing-sm) var(--spacing-lg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-hover);
    color: inherit;
    cursor: pointer;
    font-size: var(--text-sm);
    transition: all var(--transition-fast);
  }
  .btn:hover {
    background: var(--border);
  }
  .btn-primary {
    background: var(--brand);
    border-color: var(--brand);
    color: #fff;
  }
  .btn-primary:hover {
    background: var(--brand-hover);
  }
  .btn-danger {
    border-color: var(--danger);
    color: var(--danger);
    background: transparent;
  }
  .btn-danger:hover {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }
  .btn-ghost {
    background: transparent;
  }
  .btn-sm {
    padding: var(--spacing-xs) var(--spacing-md);
    font-size: var(--text-xs);
  }
  .card {
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--spacing-lg);
    box-shadow: var(--shadow-sm);
  }
  .muted {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .empty {
    padding: var(--spacing-lg);
    text-align: center;
  }

  /* === 治理布局 === */
  .gov-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: var(--spacing-lg) var(--spacing-xl) 0;
    gap: var(--spacing-md);
    flex-wrap: wrap;
  }
  .gov-header h2 {
    margin: 0 0 var(--spacing-xs);
  }
  .gov-header-right {
    display: flex;
    gap: var(--spacing-sm);
  }
  .gov-layout {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: var(--spacing-lg);
    padding: var(--spacing-lg) var(--spacing-xl) var(--spacing-2xl);
    align-items: start;
  }

  /* 数据集面板 */
  .ds-panel {
    position: sticky;
    top: calc(var(--spacing-lg) + 60px);
    max-height: calc(100vh - 140px);
    overflow: auto;
  }
  .ds-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-md);
    font-weight: 600;
  }
  .create-form {
    border-top: 1px dashed var(--border);
    padding-top: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }
  .ds-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }
  .ds-item {
    width: 100%;
    text-align: left;
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ds-item:hover {
    background: var(--bg-hover);
  }
  .ds-item.active {
    background: color-mix(in srgb, var(--brand) 12%, transparent);
    border-color: var(--brand);
  }
  .ds-item-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
  }
  .ds-name {
    font-weight: 500;
    font-size: var(--text-sm);
  }
  .ds-item-sub {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  /* 详情 */
  .ds-detail {
    min-height: 300px;
  }
  .detail-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-sm);
  }
  .detail-head h3 {
    margin: 0 0 var(--spacing-xs);
  }
  .desc {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin: var(--spacing-xs) 0 0;
  }
  .lc-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
    padding: var(--spacing-md) 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: var(--spacing-md);
  }
  .publish-box {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    width: 100%;
    max-width: 460px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: var(--text-sm);
  }
  .sec {
    margin-bottom: var(--spacing-lg);
  }
  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
    margin-bottom: var(--spacing-sm);
  }
  .chip-row {
    display: flex;
    gap: var(--spacing-xs);
    flex-wrap: wrap;
    margin-bottom: var(--spacing-sm);
  }
  .chip {
    padding: 2px 10px;
    border-radius: var(--radius-full);
    background: var(--border);
    font-size: var(--text-xs);
    font-family: monospace;
  }
  .deploy-box {
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 6px);
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }
  .deploy-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .deploy-active {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted, #888);
  }
  .deploy-ok {
    margin: 0;
    color: var(--ok, #2e7d32);
    font-size: var(--text-xs);
  }
  .btn-row {
    display: flex;
    gap: var(--spacing-sm);
  }
  .hist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }
  .hist li {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: var(--text-sm);
    flex-wrap: wrap;
  }
  .cause {
    color: var(--text-secondary);
    font-style: italic;
  }
  .entry-form {
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }
  .entry-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }
  .entry-list li {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--spacing-sm) var(--spacing-md);
  }
  .entry-top {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-xs);
  }
  .entry-id {
    font-weight: 600;
    font-family: monospace;
    font-size: var(--text-sm);
  }
  .entry-body {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
    padding: var(--spacing-sm);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* 状态徽标 */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: 500;
    background: var(--border);
    color: var(--text-primary);
  }

  /* 条目「版本与对比」区(条目 diff 工具专项) */
  .diff-toggle {
    margin-top: var(--spacing-xs);
  }
  .diff-panel {
    margin-top: var(--spacing-sm);
    padding: var(--spacing-sm);
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }
  .diff-error {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-xs);
  }
  .vchain {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
  }
  .vrow {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
  }
  .diff-controls {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
  }
  .diff-controls select {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
    color: var(--text-primary);
    font-size: var(--text-xs);
  }
  .diff-result {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
  }
  .diff-changed { background: color-mix(in srgb, var(--warning) 20%, transparent); color: #92400e; }
  .diff-same { background: color-mix(in srgb, var(--success) 18%, transparent); color: #065f46; }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
    width: 100%;
  }
  .key-badge {
    display: inline-block;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-family: monospace;
  }
  .key-added { background: color-mix(in srgb, var(--success) 18%, transparent); color: #065f46; }
  .key-removed { background: color-mix(in srgb, var(--danger) 15%, transparent); color: #991b1b; }
  .key-changed { background: color-mix(in srgb, var(--warning) 20%, transparent); color: #92400e; }
  /* D-B③ 双版本载荷并排（条目 diff 工具专项） */
  .payload-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-sm);
    width: 100%;
  }
  @media (max-width: 720px) {
    .payload-cols {
      grid-template-columns: 1fr;
    }
  }
  .payload-title {
    margin: 0 0 var(--spacing-xs);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .diff-note {
    margin: 0;
    font-size: var(--text-xs);
    width: 100%;
  }
  .badge-lg {
    padding: 4px 12px;
    font-size: var(--text-sm);
  }
  .status-draft { background: var(--border); color: var(--text-primary); }
  .status-candidate { background: color-mix(in srgb, var(--warning) 18%, transparent); color: #92400e; }
  .status-active { background: color-mix(in srgb, var(--info) 18%, transparent); color: #1e40af; }
  .status-published { background: color-mix(in srgb, var(--success) 18%, transparent); color: #065f46; }
  .status-rejected { background: color-mix(in srgb, var(--danger) 15%, transparent); color: #991b1b; }

  /* 数据集类型徽标(Q12 段2 P5/C1) */
  .ds-item-badges {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    flex-shrink: 0;
  }
  .kind-ruleset { background: var(--border); color: var(--text-secondary); }
  .kind-knowledge {
    background: color-mix(in srgb, var(--brand) 14%, transparent);
    color: var(--brand);
  }

  /* knowledge 数据条目(C2/C3) */
  .kn-meta {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    flex-wrap: wrap;
    margin-bottom: var(--spacing-xs);
  }
  .kn-source {
    margin: 0 0 var(--spacing-xs);
  }

  @media (max-width: 900px) {
    .gov-layout {
      grid-template-columns: 1fr;
    }
    .ds-panel {
      position: static;
      max-height: none;
    }
  }
</style>
