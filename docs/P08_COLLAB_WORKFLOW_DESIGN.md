> **状态**:设计文档,2026-08-06 定稿。本文档是 evorule-doc-center `b2b2c-strategy.md §20.2 P0-8` 的可实施落地。
>
> **定位**:P0-8 协作工作流基础 — 把三层架构 §7-§8 的三级发布权限、Workspace 成员角色、权限矩阵、版本历史落地为可运行的协作子系统。是多人协作场景(医院 10 科室并行)的"流程骨架"。基础版本,不含合规审批(归 P1)。
>
> **关联**:
>
> - 战略依据:`b2b2c-strategy.md §20.2 P0-8`(步骤 8 处理运行时 — 多人协作 / 角色模型 / 版本历史,基础,不含合规审批)
> - 三层架构:`evorule-three-layer-architecture.md §7`(三级发布权限)+ §8(权限矩阵)+ §6.3(workspace_members)+ §6.7(publish_queue)+ §6.5(production_audit)
> - 首页设计:`HOME_DESIGN.md §5.x`(顶部导航用户菜单 / Workspace 切换 / 通知)
> - 前置设计:`P01_BUILD_SCHEMA_DESIGN.md`(workspace crate,Workspace 创建)
> - 后端 API:`evorule-server` 新增协作 + 权限 + 发布队列端点
> - 横向关联:P0-7(导出审计链含操作人)、P0-9(模板市场用户分享)

---

## 1. 背景与动机

### 1.1 战略意图(来自 §20.2 P0-8)

> P0-8 协作工作流(基础角色 + 权限)— 步骤 8 处理运行时 — 多人协作 / 角色模型 / 版本历史(基础,不含合规审批)

**P0-8 在 11 步功能流中的位置**(步骤 8):

```
... → 步骤 7 看运行时(P0-5 监控大屏)
    → 步骤 8 处理运行时数据(P0-8 协作工作流 + P1 双人审批) ← 本文档
    → 步骤 9 查看运行结果(P0-6 业务审计)
```

**步骤 8 的业务场景**(医院):
- 5 个科室并行编辑新规则,3 个协作(2 作者 + 1 审核者),2 个独立
- 科室主任审核本科室 Workspace,签字后提交到 Publish Queue
- 信息科审批全院 Publish Queue,批准后滚动 session 热重载
- 紧急异常时信息科一键回滚到旧版本
- 所有动作可追溯(谁在何时改了什么、审批了什么)

### 1.2 现有能力盘点

| 能力 | 来源 | 状态 | P0-8 复用方式 |
| --- | --- | --- | --- |
| 三层架构(Production/Workspaces/Sandbox) | evorule-three-layer-architecture §1-§3 | ✅ 已设计 | 直接落地 |
| Workspace 表 + 成员表 + 发布队列 | 三层架构 §6.2-§6.8 | 📐 已设计 schema | 直接落地 |
| 三级发布权限矩阵 | 三层架构 §7.1 + §8.1 | 📐 已设计 | 直接落地 |
| 滚动 session 热重载 | evorule-server `POST /api/rules/reload` + fork | ✅ 已实现 | P0-8 调用 |
| BLAKE3 审计链 | evorule-server audit API | ✅ 已实现 | production_audit 与之互补 |
| 内核 session store | `@evorule/console` sessions/currentSessionId | ✅ 已实现 | 复用,扩展为多用户态 |
| evorule-tcb 物理隔离 | SessionManager 多 Reactor | ✅ 已实现 | Sandbox 隔离基础 |

**结论**:数据 schema 和权限模型已在三层架构文档定稿,P0-8 只做"应用层落地 + UI + 协作流程编排",不重新设计权限模型。

### 1.3 现有"协作"能力的缺失

| 现状 | 不足 |
| --- | --- |
| 无用户身份 | 所有操作都是匿名,无法追溯"谁做的" |
| 无角色区分 | 任何人都能编辑/发布,无法满足医院三级分权 |
| 无 Workspace 成员管理 | Workspace 创建后无法邀请/移除成员 |
| 无发布队列 | Final 候选提交后无排队/审批流程 |
| 无版本历史 | 只能看 BLAKE3 Fact 链,看不到"v16 → v17 由谁审批" |
| 无评论讨论 | 协作只能在 Workspace 外(微信/邮件),无审计 |
| 无通知 | 提交/审批/回滚后无人知道,需要手动查 |
| 无活动日志 | 谁在何时登录/编辑/审批无记录 |

### 1.4 改造目标

```
三层架构 §7-§8(权限模型设计稿)
  ↓ P0-8 落地
协作工作流子系统(可运行)
  ├── 用户身份:登录 + session + 角色声明
  ├── 角色与权限:三级发布权限 + Workspace 内角色 + 权限守卫
  ├── Workspace 成员:邀请/移除/角色分配
  ├── 发布队列:Final 候选提交 + 审批 + 发布
  ├── 版本历史:production_audit 时间线(谁/何时/做什么)
  ├── 评论讨论:Workspace 内评论 + @提及
  ├── 通知:站内通知(提交/审批/回滚)
  └── 活动日志:所有动作可追溯
```

### 1.5 与其他 P0 的关系

| 前置设计 | P0-8 关系 |
| --- | --- |
| P01 建库向导 | Workspace 创建后,P0-8 接管成员管理 |
| P05 监控大屏 | InterventionBar 操作需权限守卫(P0-8 提供) |
| P06 业务审计 | production_audit 表是 P06 业务审计的数据源之一 |
| P07 通用导出 | 导出元数据含操作人(P0-8 提供用户身份) |
| 三层架构 §7-§8 | 权限模型已定稿,P0-8 落地实现 |

### 1.6 P0-8 vs P1 边界(明确"基础"范围)

| 维度 | P0-8 基础 | P1+ 进阶 |
| --- | --- | --- |
| 用户身份 | 单租户 + 本地账号 + session | 多租户 + SSO/OIDC |
| 权限粒度 | 角色 + Workspace 成员 | 细粒度(规则级、字段级) |
| 审批流 | 三级发布 + 单人审批 | 双人审批 + 多级会签 |
| 合规审批 | ❌ 不做 | ✅ P1-7 合规规则库双人审批 |
| 评论 | 文本 + @提及 | 富文本 + 附件 + 评论线程 |
| 通知 | 站内通知 | + 邮件 / IM webhook |
| 活动日志 | 基础动作审计 | + 异常行为检测 + 告警 |
| 外部身份 | ❌ | ✅ LDAP/AD 集成 |

---

## 2. 目标与非目标

### 2.1 目标(P0 范围)

1. **用户身份**:本地账号 + 密码登录 + session token,5 个内置角色(普通用户/科室主任/信息科/院领导/审计员)
2. **权限矩阵**:落地三层架构 §8.1 的 12 操作 × 4 角色权限,前端守卫 + 后端守卫双层
3. **Workspace 成员管理**:邀请/移除/改角色(author/reviewer/observer)
4. **发布队列 UI**:提交 Final 候选 + 审批(approve/reject)+ 滚动 session 发布
5. **版本历史**:production_audit 时间线视图(v1 → v2 → v3,谁/何时/做什么)
6. **评论讨论**:Workspace 内规则评论 + @提及成员
7. **站内通知**:提交/审批/回滚/邀请通知,顶部铃铛 + 下拉列表
8. **活动日志**:登录/编辑/审批/发布/回滚全记录,可查询
9. **审计员工作台**:独立路由 `/audit/`,只读,5 视图(对接 P06)

### 2.2 非目标(明确不做)

| 不做项 | 原因 | 归属 |
| --- | --- | --- |
| 合规审批工作流 | 需要合规规则库 + 法规依据 | P1-7 合规规则库 |
| 双人审批 / 多级会签 | 需要审批引擎 | P1 协作深化 |
| SSO / OIDC / LDAP | 需要 IdP 集成 | P1 企业身份 |
| 多租户 | 需要 tenant 隔离层 | P2 多租户 |
| 细粒度权限(规则级) | 角色已够用,过度设计 | P1 细粒度权限 |
| 邮件 / IM 通知 | 站内通知先满足需求 | P1 外部通知 |
| 富文本评论 | 文本够用 | P1 富文本 |
| 评论线程 / 回复嵌套 | 单层评论先满足 | P1 评论线程 |
| 实时协同编辑(OT/CRDT) | 复杂度高,P0 用"编辑锁" | P1 实时协同 |
| 移动端 | P0 桌面优先 | P2 移动端 |

### 2.3 设计原则

1. **权限双层守卫**:前端守卫(隐藏禁用按钮)+ 后端守卫(拒绝越权 API),不依赖单一层
2. **角色即配置**:角色权限矩阵是配置(JSON),不是代码,可调整
3. **审计优先**:所有写操作(编辑/审批/发布/回滚)进活动日志 + production_audit
4. **隔离不共享**:Workspace 间 Draft 互不可见,Final 候选对其他 Workspace 也不可见
5. **滚动 session 不阻塞**:发布/回滚走 §3.3 滚动模式,不中断 Production
6. **审计员只读**:审计员账号无任何写权限,独立工作台 `/audit/`

---

## 3. 关键设计决策

### 3.1 决策 1:5 个内置角色,不支持自定义

**决策**:5 个内置角色(普通用户/科室主任/信息科/院领导/审计员),不支持 P0 阶段自定义角色。

| 角色 ID | 角色名 | 定位 |
| --- | --- | --- |
| `user` | 普通用户 | 创建/编辑 Draft(成员 WS) |
| `lead` | 科室主任 | + Workspace 内审核 + 提交发布队列 |
| `it` | 信息科 | + 审批发布 + 紧急回滚 + 干预运行时 |
| `exec` | 院领导 | 同信息科(更高权限,可委托) |
| `auditor` | 审计员 | 只读,独立工作台,不参与任何写操作 |

**理由**:
1. 三层架构 §7.1 已定稿三级权限(医生/主任/信息科),P0-8 加审计员 + 院领导共 5 个
2. 医院场景已验证 5 个角色够用(走神 1-7 章医院叙事)
3. 自定义角色需 RBAC 引擎,P0 不做
4. 5 个角色对应 b2b2c-strategy §15.6 审计员工作台设计

**院领导 vs 信息科**:P0 等同(都是"信息科/院领导"权限组);P1 区分(院领导可委托、可看更高维度报表)。

### 3.2 决策 2:本地账号 + session token,不做 SSO

**决策**:P0 用本地账号(用户名 + 密码)+ session token(cookie),不做 SSO/OIDC/LDAP。

**理由**:
1. P0 目标是"基础协作",身份认证够用即可
2. SSO 集成需要 IdP(医院 AD / 企业 LDAP),依赖外部系统
3. 本地账号可快速落地,后续 P1 平滑升级到 SSO
4. 密码用 bcrypt 哈希存储,session token 用随机 UUID + HttpOnly cookie

**session 生命周期**:
- 登录成功 → 颁发 session token(7 天有效)
- 每次请求 → 后端校验 token + 加载用户身份 + 注入请求上下文
- 退出 → 删除 session token
- 7 天后过期 → 重新登录

**与 evorule-server 的关系**:session 管理在 evorule-server 应用层(新 `auth` crate),不复用 evorule-tcb 的 SessionManager(后者管 Reactor session,与用户 session 是两个概念)。

### 3.3 决策 3:权限双层守卫,前端 + 后端

**决策**:前端守卫(隐藏/禁用无权限按钮)+ 后端守卫(拒绝越权 API 请求),不依赖单一层。

**前端守卫**:
```typescript
// src/lib/stores/auth.ts
export const currentUser = writable<User | null>(null);

// 权限检查 hook
export function can(action: PermissionAction, scope?: PermissionScope): boolean {
  const user = get(currentUser);
  if (!user) return false;
  return checkPermission(user.role, action, scope);
}

// Svelte 组件中
{#if can('publish_approve')}
  <button on:click={approve}>批准发布</button>
{/if}
```

**后端守卫**(evorule-server 中间件):
```rust
// src/middleware/auth.rs
async fn require_permission(action: PermissionAction) -> Middleware {
    move |req, next| {
        let user = req.extensions().get::<User>().ok_or(401)?;
        if !check_permission(&user.role, &action, &scope) {
            return Err(403);
        }
        next(req).await
    }
}

// 应用到路由
router
    .route("/api/publish-queue/:id/approve",
        post(approve_publish)
            .layer(require_permission(PermissionAction::PublishApprove)))
```

**理由**:
1. 前端守卫提升 UX(用户看不到无权限按钮,不会点了才报错)
2. 后端守卫保证安全(防绕过前端直接调 API)
3. 双层冗余,任何一层失效另一层兜底

### 3.4 决策 4:Workspace 内 3 角色,不支持自定义

**决策**:Workspace 内 3 角色(author/reviewer/observer),对应三层架构 §6.3。

| Workspace 角色 | 权限 |
| --- | --- |
| `author` | 编辑 Draft + 启动 Sandbox + 评论 |
| `reviewer` | + 审核 Draft(批准/驳回)+ 提交发布队列 |
| `observer` | 只读(查看 Draft / 测试报告 / 评论) |

**与全局角色的关系**:
- 全局角色 `user` → 可被邀请为 `author` / `observer`
- 全局角色 `lead` → 自动获得 `reviewer`(创建 WS 时或邀请时)
- 全局角色 `auditor` → 不能加入任何 Workspace(只读审计)
- 全局角色 `it`/`exec` → 不参与 Workspace(只看 Publish Queue)

**理由**:
1. 三层架构 §6.3 已定稿 author/reviewer/observer
2. 全局角色管"全院范围权限",Workspace 角色管"单个 WS 内权限",两层正交
3. 3 个角色对应"编辑/审核/旁观"自然分工

### 3.5 决策 5:编辑锁(悲观锁),不做实时协同

**决策**:Draft 规则编辑用"编辑锁"(悲观锁),同一规则同一时刻只能一人编辑,不做 OT/CRDT 实时协同。

**编辑锁机制**:
```typescript
// 编辑前获取锁
async function acquireEditLock(ruleId: string): Promise<boolean> {
  const response = await fetch(`/api/rules/${ruleId}/edit-lock`, { method: 'POST' });
  if (response.status === 409) {
    // 锁已被他人持有
    const { holder } = await response.json();
    toast.warning(`规则正在被 ${holder.username} 编辑,请稍后再试`);
    return false;
  }
  return response.ok;
}

// 编辑完成 / 退出页面 → 释放锁
async function releaseEditLock(ruleId: string): Promise<void> {
  await fetch(`/api/rules/${ruleId}/edit-lock`, { method: 'DELETE' });
}

// 锁自动过期(5 分钟无操作)
// 锁续期(编辑中每 2 分钟续期一次)
```

**理由**:
1. OT/CRDT 实现复杂(differential dataflow / Yjs),P0 不做
2. 医院场景同一规则同时编辑概率低(规则粒度小,编辑时间短)
3. 编辑锁简单可靠,用户体验可接受(看到"XX 正在编辑"提示)
4. P1 可升级为实时协同(替换锁机制)

### 3.6 决策 6:版本号单调递增,不回退

**决策**:ruleset_version 单调递增,回滚也打新版本号,不回退版本号。

**示例**:
```
v16(基线)→ v17(发布新规则)→ v18(回滚到 v16 的规则集,但版本号是 v18)
```

**production_audit 记录**:
```
v17: published by 张三(IT), source: ws-A, ruleset_hash: abc...
v18: rollback by 张三(IT), rollback_to: v16, reason: "新规则误触发", ruleset_hash: def...(=v16 的 hash)
```

**理由**:
1. 版本号回退会让审计混乱("v17 到底是新的还是旧的?")
2. 单调递增符合 BLAKE3 链的不可篡改语义
3. 回滚 = 加载旧规则集 + 打新版本号,语义清晰
4. 与三层架构 §7.4 "版本号不回退"一致

### 3.7 决策 7:站内通知,不做外部推送

**决策**:P0 只做站内通知(顶部铃铛 + 下拉列表 + WebSocket 实时推送),不做邮件/IM 外部推送。

**通知类型**:
| 类型 | 触发 | 接收人 |
| --- | --- | --- |
| `publish_submitted` | Final 候选提交到队列 | 信息科/院领导 |
| `publish_approved` | 审批通过 | 提交者 + WS 成员 |
| `publish_rejected` | 审批驳回 | 提交者 + WS 成员 |
| `publish_completed` | 滚动 session 发布完成 | 全员(规则集变更) |
| `rollback_triggered` | 紧急回滚 | 全员 |
| `workspace_invite` | 被邀请加入 WS | 被邀请人 |
| `review_requested` | 审核请求(@提及) | 被提及人 |
| `comment_mention` | 评论 @提及 | 被提及人 |

**WebSocket 实时推送**:
- 客户端连接 `/ws/notifications`
- 服务端推送 JSON `{ type, title, body, created_at, read }`
- 客户端铃铛实时更新未读数

**理由**:
1. 站内通知满足 P0 协作需求(审批人能及时看到队列)
2. 邮件/IM 需要外部服务(SMTP/IM webhook),P0 不接
3. WebSocket 复用 evorule-server 已有 SSE 基础设施(升级为双向)

---

## 4. 数据模型

### 4.1 用户表(users)— 应用层新增

```
users(evorule-server 应用层表)
├── id              (UUID)
├── username        (唯一,登录用)
├── password_hash   (bcrypt)
├── display_name    (显示名,如 "张三")
├── email           (可选,通知用)
├── role            (user / lead / it / exec / auditor)
├── department      (科室,如 "内科",可选,用于数据可见性)
├── status          (active / disabled)
├── created_at
├── last_login_at
└── last_login_ip
```

**5 个内置账号**(初始化时创建,P0 演示用):
| username | display_name | role | department |
| --- | --- | --- | --- |
| `doctor1` | 李医生 | user | 内科 |
| `lead1` | 王主任 | lead | 内科 |
| `it1` | 张工 | it | 信息科 |
| `exec1` | 院长 | exec | - |
| `auditor1` | 赵审计 | auditor | - |

### 4.2 用户会话表(user_sessions)— 应用层新增

```
user_sessions
├── token           (UUID,主键,HttpOnly cookie 值)
├── user_id
├── created_at
├── expires_at      (默认 7 天)
├── last_active_at
└── ip
```

### 4.3 工作空间成员表(workspace_members)— 三层架构 §6.3 已定义

```
workspace_members
├── workspace_id
├── user_id
├── role            (author / reviewer / observer)
├── added_at
└── added_by
```

### 4.4 发布队列表(publish_queue)— 三层架构 §6.7 已定义

```
publish_queue
├── id
├── workspace_id
├── final_candidate_rules   (待发布的规则集 JSON)
├── ruleset_hash            (BLAKE3)
├── test_report_id
├── status                  (pending / approved / rejected / published / cancelled)
├── submitted_by
├── submitted_at
├── reviewed_by
├── reviewed_at
├── review_comment
├── published_ruleset_version
└── published_at
```

### 4.5 Production 审计表(production_audit)— 三层架构 §6.5 已定义

```
production_audit
├── id
├── event_type              (ruleset_published / ruleset_rollback)
├── ruleset_version
├── previous_version
├── ruleset_hash            (BLAKE3)
├── tcb_session_id
├── source_workspace_ids
├── operated_by
├── operated_at
├── reason
└── test_report_ids
```

### 4.6 评论表(comments)— 应用层新增

```
comments
├── id
├── workspace_id
├── target_type            (rule / workspace / publish_request)
├── target_id              (规则 ID / WS ID / publish_queue ID)
├── author_id
├── body                   (文本,P0 不做富文本)
├── mentions               (JSON 数组,被 @提及的 user_id)
├── created_at
└── updated_at
```

### 4.7 通知表(notifications)— 应用层新增

```
notifications
├── id
├── user_id                (接收人)
├── type                   (publish_submitted / publish_approved / ...)
├── title
├── body
├── link                   (点击跳转 URL)
├── read                   (boolean)
├── created_at
└── read_at
```

### 4.8 活动日志表(activity_log)— 应用层新增

```
activity_log
├── id
├── user_id
├── action                 (login / edit_rule / approve_publish / rollback / ...)
├── target_type
├── target_id
├── details                (JSON,动作详情)
├── ip
├── user_agent
└── created_at
```

### 4.9 编辑锁表(edit_locks)— 应用层新增

```
edit_locks
├── rule_id                (主键,一规则一锁)
├── workspace_id
├── holder_id              (持锁用户)
├── acquired_at
├── expires_at             (默认 5 分钟后过期)
└── last_renewed_at
```

---

## 5. 权限矩阵详设

### 5.1 权限动作清单(12 个)

```typescript
// src/lib/stores/auth.ts

export type PermissionAction =
  | 'view_monitor'           // 查看监控大屏
  | 'view_audit_chain'       // 查看审计链
  | 'intervene_runtime'      // 干预运行时(暂停/调参/中断)
  | 'rollback_ruleset'       // 紧急回滚
  | 'create_workspace'       // 创建 Workspace
  | 'edit_draft'             // 编辑 Draft(需 WS 成员)
  | 'review_in_workspace'    // WS 内审核(需 reviewer)
  | 'submit_to_publish'      // 提交到发布队列
  | 'start_sandbox'          // 启动沙盒(需 WS 成员)
  | 'approve_publish'        // 审批发布
  | 'view_publish_queue'     // 查看发布队列
  | 'view_test_report';      // 查看测试报告

export type PermissionScope = {
  workspaceId?: string;
  department?: string;
  // P0 不实现规则级 scope
};
```

### 5.2 角色 × 动作权限矩阵

```typescript
// src/lib/stores/permission-matrix.ts

import type { PermissionAction } from './auth';

/** 角色 → 动作 → 是否允许(无 scope 限制) */
export const ROLE_PERMISSIONS: Record<string, Set<PermissionAction>> = {
  // 普通用户:看 + 编辑 Draft + 启动沙盒
  user: new Set([
    'view_monitor',
    'create_workspace',
    'edit_draft',
    'start_sandbox',
    'view_test_report',
  ]),

  // 科室主任:普通用户 + WS 内审核 + 提交发布
  lead: new Set([
    'view_monitor',
    'create_workspace',
    'edit_draft',
    'review_in_workspace',
    'submit_to_publish',
    'start_sandbox',
    'view_test_report',
    'view_publish_queue',
  ]),

  // 信息科:看 + 干预 + 回滚 + 审批发布 + 看审计链
  it: new Set([
    'view_monitor',
    'view_audit_chain',
    'intervene_runtime',
    'rollback_ruleset',
    'approve_publish',
    'view_publish_queue',
    'view_test_report',
  ]),

  // 院领导:同信息科(P0 等同)
  exec: new Set([
    'view_monitor',
    'view_audit_chain',
    'intervene_runtime',
    'rollback_ruleset',
    'approve_publish',
    'view_publish_queue',
    'view_test_report',
  ]),

  // 审计员:只读审计链
  auditor: new Set([
    'view_monitor',
    'view_audit_chain',
  ]),
};
```

### 5.3 Scope 校验(Workspace 成员 + 科室可见性)

```typescript
// src/lib/stores/permission-matrix.ts

/**
 * 检查权限(带 scope)。
 * 1. 角色级权限(ROLE_PERMISSIONS)
 * 2. Workspace 成员校验(若 action 涉及 WS 内操作)
 * 3. 科室可见性校验(若 action 涉及数据查看)
 */
export function checkPermission(
  user: User,
  action: PermissionAction,
  scope?: PermissionScope,
): boolean {
  // 1. 角色级
  if (!ROLE_PERMISSIONS[user.role]?.has(action)) return false;

  // 2. Workspace 成员校验
  const wsActions: PermissionAction[] = [
    'edit_draft',
    'review_in_workspace',
    'submit_to_publish',
    'start_sandbox',
    'view_test_report',
  ];
  if (wsActions.includes(action) && scope?.workspaceId) {
    return isWorkspaceMember(user.id, scope.workspaceId);
  }

  // 3. 科室可见性(普通用户只看本科室数据)
  if (action === 'view_monitor' && user.role === 'user') {
    // 实际实现:数据查询时按 department 过滤
    // 这里只返回 true,过滤在后端 API
    return true;
  }

  return true;
}

/** Workspace 成员校验(查 workspace_members 表,带缓存) */
function isWorkspaceMember(userId: string, workspaceId: string): boolean {
  // 实际实现从 workspaceMembersStore 查
  return true; // placeholder
}
```

---

## 6. Store 设计

### 6.1 authStore(用户身份 + 权限)

```typescript
// src/lib/stores/auth.ts

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { PermissionAction, PermissionScope } from './permission-matrix';
import { checkPermission } from './permission-matrix';

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  role: 'user' | 'lead' | 'it' | 'exec' | 'auditor';
  department?: string;
  status: 'active' | 'disabled';
}

const AUTH_STORAGE_KEY = 'evorule-console-cloud:auth';

/** 当前登录用户(null = 未登录) */
export const currentUser = writable<User | null>(loadUser());

/** 权限检查(组件用) */
export function can(action: PermissionAction, scope?: PermissionScope): boolean {
  const user = get(currentUser);
  if (!user) return false;
  return checkPermission(user, action, scope);
}

/** 派生:是否登录 */
export const isLoggedIn = derived(currentUser, ($u) => $u !== null);

/** 派生:角色标签 */
export const roleLabel = derived(currentUser, ($u) => {
  if (!$u) return '';
  const labels: Record<User['role'], string> = {
    user: '普通用户',
    lead: '科室主任',
    it: '信息科',
    exec: '院领导',
    auditor: '审计员',
  };
  return labels[$u.role];
});

function loadUser(): User | null {
  if (!browser) return null;
  const stored = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as User;
  } catch {
    return null;
  }
}

function persistUser(user: User | null): void {
  if (!browser) return;
  if (user) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

/** 登录 */
export async function login(
  username: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { success: false, error: err.message ?? '登录失败' };
  }
  const { user } = await response.json();
  currentUser.set(user);
  persistUser(user);
  return { success: true };
}

/** 退出 */
export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser.set(null);
  persistUser(null);
}

/** 刷新当前用户信息(角色变更后) */
export async function refreshCurrentUser(): Promise<void> {
  const response = await fetch('/api/auth/me');
  if (response.ok) {
    const { user } = await response.json();
    currentUser.set(user);
    persistUser(user);
  }
}
```

### 6.2 workspaceMembersStore(Workspace 成员管理)

```typescript
// src/lib/stores/workspace-members.ts

import { writable, get } from 'svelte/store';
import type { User } from './auth';

export type WorkspaceRole = 'author' | 'reviewer' | 'observer';

export interface WorkspaceMember {
  userId: string;
  username: string;
  displayName: string;
  role: WorkspaceRole;
  addedAt: string;
  addedBy: string;
}

export const workspaceMembers = writable<WorkspaceMember[]>([]);
export const membersLoading = writable(false);
export const membersError = writable<string | null>(null);

/** 加载 Workspace 成员 */
export async function loadMembers(workspaceId: string): Promise<void> {
  membersLoading.set(true);
  membersError.set(null);
  try {
    const response = await fetch(`/api/workspaces/${workspaceId}/members`);
    if (!response.ok) throw new Error(`加载成员失败: ${response.status}`);
    const data = await response.json();
    workspaceMembers.set(data.members);
  } catch (e) {
    membersError.set((e as Error).message);
  } finally {
    membersLoading.set(false);
  }
}

/** 邀请成员 */
export async function inviteMember(
  workspaceId: string,
  username: string,
  role: WorkspaceRole,
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, role }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { success: false, error: err.message ?? '邀请失败' };
  }
  await loadMembers(workspaceId);
  return { success: true };
}

/** 修改成员角色 */
export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  await loadMembers(workspaceId);
}

/** 移除成员 */
export async function removeMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
    method: 'DELETE',
  });
  await loadMembers(workspaceId);
}

/** 当前用户在 WS 内的角色 */
export function myRoleInWorkspace(workspaceId: string): WorkspaceRole | null {
  const user = get(/* currentUser */ {} as any); // 实际从 authStore
  const members = get(workspaceMembers);
  return members.find((m) => m.userId === user?.id)?.role ?? null;
}
```

### 6.3 publishQueueStore(发布队列)

```typescript
// src/lib/stores/publish-queue.ts

import { writable, get } from 'svelte/store';

export type PublishStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'cancelled';

export interface PublishRequest {
  id: string;
  workspaceId: string;
  workspaceName: string;
  finalCandidateRules: unknown;
  rulesetHash: string;
  testReportId?: string;
  status: PublishStatus;
  submittedBy: { id: string; displayName: string };
  submittedAt: string;
  reviewedBy?: { id: string; displayName: string };
  reviewedAt?: string;
  reviewComment?: string;
  publishedRulesetVersion?: number;
  publishedAt?: string;
}

export const publishQueue = writable<PublishRequest[]>([]);
export const queueLoading = writable(false);
export const queueError = writable<string | null>(null);

/** 加载发布队列(信息科/院领导看全院,其他人看本科室) */
export async function loadPublishQueue(): Promise<void> {
  queueLoading.set(true);
  try {
    const response = await fetch('/api/publish-queue');
    if (!response.ok) throw new Error(`加载队列失败: ${response.status}`);
    const data = await response.json();
    publishQueue.set(data.requests);
  } catch (e) {
    queueError.set((e as Error).message);
  } finally {
    queueLoading.set(false);
  }
}

/** 提交 Final 候选到发布队列 */
export async function submitToPublish(
  workspaceId: string,
  reviewComment?: string,
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch('/api/publish-queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, reviewComment }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { success: false, error: err.message ?? '提交失败' };
  }
  await loadPublishQueue();
  return { success: true };
}

/** 批准发布 */
export async function approvePublish(
  requestId: string,
  comment?: string,
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`/api/publish-queue/${requestId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { success: false, error: err.message ?? '批准失败' };
  }
  await loadPublishQueue();
  return { success: true };
}

/** 驳回 */
export async function rejectPublish(
  requestId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`/api/publish-queue/${requestId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { success: false, error: err.message ?? '驳回失败' };
  }
  await loadPublishQueue();
  return { success: true };
}

/** 派生:待审批的请求 */
export const pendingRequests = derived(publishQueue, ($q) =>
  $q.filter((r) => r.status === 'pending'),
);
```

### 6.4 productionAuditStore(版本历史)

```typescript
// src/lib/stores/production-audit.ts

import { writable } from 'svelte/store';

export interface ProductionAuditEntry {
  id: string;
  eventType: 'ruleset_published' | 'ruleset_rollback';
  rulesetVersion: number;
  previousVersion: number;
  rulesetHash: string;
  tcbSessionId: number;
  sourceWorkspaceIds: string[];
  operatedBy: { id: string; displayName: string; role: string };
  operatedAt: string;
  reason?: string;
  testReportIds?: string[];
}

export const productionAuditEntries = writable<ProductionAuditEntry[]>([]);
export const auditLoading = writable(false);

/** 加载版本历史 */
export async function loadProductionAudit(limit = 50): Promise<void> {
  auditLoading.set(true);
  try {
    const response = await fetch(`/api/production-audit?limit=${limit}`);
    if (!response.ok) throw new Error(`加载版本历史失败: ${response.status}`);
    const data = await response.json();
    productionAuditEntries.set(data.entries);
  } finally {
    auditLoading.set(false);
  }
}

/** 当前版本(派生) */
export const currentVersion = derived(productionAuditEntries, ($entries) => {
  if ($entries.length === 0) return null;
  return $entries[0]; // 最新的在最前
});
```

### 6.5 commentsStore(评论讨论)

```typescript
// src/lib/stores/comments.ts

import { writable } from 'svelte/store';

export type CommentTarget = 'rule' | 'workspace' | 'publish_request';

export interface Comment {
  id: string;
  workspaceId: string;
  targetType: CommentTarget;
  targetId: string;
  author: { id: string; displayName: string; role: string };
  body: string;
  mentions: string[]; // user IDs
  createdAt: string;
  updatedAt?: string;
}

export const comments = writable<Comment[]>([]);

/** 加载某个目标的评论 */
export async function loadComments(
  targetType: CommentTarget,
  targetId: string,
): Promise<void> {
  const response = await fetch(
    `/api/comments?target_type=${targetType}&target_id=${targetId}`,
  );
  if (!response.ok) return;
  const data = await response.json();
  comments.set(data.comments);
}

/** 发表评论 */
export async function postComment(
  workspaceId: string,
  targetType: CommentTarget,
  targetId: string,
  body: string,
  mentions: string[] = [],
): Promise<void> {
  await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: workspaceId,
      target_type: targetType,
      target_id: targetId,
      body,
      mentions,
    }),
  });
  await loadComments(targetType, targetId);
}

/** 删除评论(仅作者或管理员) */
export async function deleteComment(commentId: string): Promise<void> {
  await fetch(`/api/comments/${commentId}`, { method: 'DELETE' });
}
```

### 6.6 notificationsStore(站内通知)

```typescript
// src/lib/stores/notifications.ts

import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: string;
  readAt?: string;
}

export const notifications = writable<Notification[]>([]);
export const wsConnection = writable<'connected' | 'disconnected'>('disconnected');

let ws: WebSocket | null = null;

/** 初始化 WebSocket 通知订阅(登录后调用) */
export function initNotifications(): void {
  if (!browser) return;
  if (ws) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws/notifications`);

  ws.onopen = () => wsConnection.set('connected');
  ws.onclose = () => {
    wsConnection.set('disconnected');
    // 自动重连(指数退避)
    setTimeout(() => initNotifications(), 3000);
  };
  ws.onmessage = (event) => {
    const notif: Notification = JSON.parse(event.data);
    notifications.update((all) => [notif, ...all]);
  };
}

/** 加载历史通知 */
export async function loadNotifications(): Promise<void> {
  const response = await fetch('/api/notifications?limit=50');
  if (!response.ok) return;
  const data = await response.json();
  notifications.set(data.notifications);
}

/** 标记已读 */
export async function markAsRead(notificationId: string): Promise<void> {
  await fetch(`/api/notifications/${notificationId}/read`, { method: 'POST' });
  notifications.update((all) =>
    all.map((n) =>
      n.id === notificationId ? { ...n, read: true, readAt: new Date().toISOString() } : n,
    ),
  );
}

/** 全部标记已读 */
export async function markAllAsRead(): Promise<void> {
  await fetch('/api/notifications/read-all', { method: 'POST' });
  notifications.update((all) =>
    all.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() })),
  );
}

/** 未读数(派生) */
export const unreadCount = derived(notifications, ($n) =>
  $n.filter((x) => !x.read).length,
);
```

### 6.7 editLockStore(编辑锁)

```typescript
// src/lib/stores/edit-lock.ts

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface EditLock {
  ruleId: string;
  holder: { id: string; displayName: string };
  acquiredAt: string;
  expiresAt: string;
}

export const currentLocks = writable<Record<string, EditLock>>({});

let renewTimers: Record<string, ReturnType<typeof setInterval>> = {};

/** 获取编辑锁 */
export async function acquireLock(ruleId: string): Promise<boolean> {
  const response = await fetch(`/api/rules/${ruleId}/edit-lock`, {
    method: 'POST',
  });
  if (response.status === 409) {
    const { holder } = await response.json();
    currentLocks.update((locks) => ({
      ...locks,
      [ruleId]: { ruleId, holder, acquiredAt: '', expiresAt: '' },
    }));
    return false;
  }
  if (!response.ok) return false;

  const lock = await response.json();
  currentLocks.update((locks) => ({ ...locks, [ruleId]: lock }));

  // 启动续期定时器(每 2 分钟续期一次,锁 5 分钟过期)
  renewTimers[ruleId] = setInterval(() => renewLock(ruleId), 2 * 60 * 1000);

  return true;
}

/** 续期 */
async function renewLock(ruleId: string): Promise<void> {
  await fetch(`/api/rules/${ruleId}/edit-lock`, { method: 'PUT' });
}

/** 释放锁 */
export async function releaseLock(ruleId: string): Promise<void> {
  if (renewTimers[ruleId]) {
    clearInterval(renewTimers[ruleId]);
    delete renewTimers[ruleId];
  }
  await fetch(`/api/rules/${ruleId}/edit-lock`, { method: 'DELETE' });
  currentLocks.update((locks) => {
    const next = { ...locks };
    delete next[ruleId];
    return next;
  });
}

/** 页面卸载时释放所有锁 */
if (browser) {
  window.addEventListener('beforeunload', () => {
    const locks = Object.keys(renewTimers);
    // 用 sendBeacon 保证请求发出
    locks.forEach((ruleId) => {
      navigator.sendBeacon(`/api/rules/${ruleId}/edit-lock/release`);
    });
  });
}
```

### 6.8 activityLogStore(活动日志)

```typescript
// src/lib/stores/activity-log.ts

import { writable } from 'svelte/store';

export interface ActivityLogEntry {
  id: string;
  user: { id: string; displayName: string; role: string };
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

export const activityLog = writable<ActivityLogEntry[]>([]);
export const logLoading = writable(false);

/** 加载活动日志(支持筛选) */
export async function loadActivityLog(filters?: {
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<void> {
  logLoading.set(true);
  try {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined) params.set(k, String(v));
      });
    }
    const response = await fetch(`/api/activity-log?${params}`);
    if (!response.ok) return;
    const data = await response.json();
    activityLog.set(data.entries);
  } finally {
    logLoading.set(false);
  }
}
```

---

## 7. 前端组件设计

### 7.1 组件树

```
顶部导航栏(顶部)
├── UserMenu.svelte                  (用户菜单:头像 + 下拉)
│   ├── 角色标签
│   ├── 切换角色(P0 演示用)
│   └── 退出
├── NotificationBell.svelte          (通知铃铛)
│   └── NotificationDropdown.svelte  (下拉列表)
└── WorkspaceSwitcher.svelte         (Workspace 切换器)

Login page
└── LoginForm.svelte                 (登录表单)

Workspace 视图
├── WorkspaceMembersPanel.svelte     (成员管理)
│   ├── InviteMemberDialog.svelte    (邀请成员)
│   └── MemberRoleSelector.svelte    (角色选择)
├── CommentThread.svelte             (评论线程)
│   ├── CommentItem.svelte
│   └── CommentEditor.svelte         (评论编辑 + @提及)
└── ReviewActions.svelte             (WS 内审核动作)

PublishQueue 视图(/publish-queue)
├── PublishQueueList.svelte          (队列列表)
├── PublishRequestCard.svelte        (单个请求卡片)
└── ReviewDialog.svelte              (审批弹窗:批准/驳回)

VersionHistory 视图(/version-history)
├── VersionTimeline.svelte           (版本时间线)
└── VersionDetailPanel.svelte        (单个版本详情)

Audit 视图(/audit/,审计员工作台)
├── AuditWorkbench.svelte            (审计员工作台)
└── (复用 P06 BusinessAuditView)

ActivityLog 视图(/activity-log)
└── ActivityLogTable.svelte          (活动日志表格)
```

### 7.2 LoginForm.svelte(登录页)

```svelte
<!-- src/lib/views/Auth/LoginForm.svelte -->
<script lang="ts">
  import { login, currentUser } from '$lib/stores/auth';
  import { goto } from '$app/navigation';

  let username = '';
  let password = '';
  let error: string | null = null;
  let loading = false;

  async function handleSubmit(): Promise<void> {
    loading = true;
    error = null;
    const result = await login(username, password);
    loading = false;
    if (result.success) {
      const user = $currentUser!;
      // 审计员跳转独立工作台
      if (user.role === 'auditor') {
        goto('/audit/');
      } else {
        goto('/');
      }
    } else {
      error = result.error ?? '登录失败';
    }
  }

  /** 快速登录(P0 演示用,5 个内置账号) */
  function quickLogin(u: string): void {
    username = u;
    password = 'demo123'; // P0 演示密码
    handleSubmit();
  }
</script>

<div class="login-page">
  <div class="login-card">
    <h1>evorule 控制台</h1>
    <p class="subtitle">协作工作流</p>

    <form on:submit|preventDefault={handleSubmit}>
      <label>
        用户名
        <input type="text" bind:value={username} required />
      </label>
      <label>
        密码
        <input type="password" bind:value={password} required />
      </label>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <button type="submit" disabled={loading}>
        {loading ? '登录中...' : '登录'}
      </button>
    </form>

    <details class="quick-login">
      <summary>快速登录(P0 演示)</summary>
      <div class="quick-buttons">
        <button on:click={() => quickLogin('doctor1')}>李医生(user)</button>
        <button on:click={() => quickLogin('lead1')}>王主任(lead)</button>
        <button on:click={() => quickLogin('it1')}>张工(it)</button>
        <button on:click={() => quickLogin('exec1')}>院长(exec)</button>
        <button on:click={() => quickLogin('auditor1')}>赵审计(auditor)</button>
      </div>
    </details>
  </div>
</div>

<style>
  .login-page {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%);
  }
  .login-card {
    background: white; padding: 32px; border-radius: 8px;
    width: 360px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);
  }
  h1 { margin: 0 0 4px; color: #1a365d; font-size: 24px; text-align: center; }
  .subtitle { text-align: center; color: #718096; margin: 0 0 24px; }
  label { display: block; margin-bottom: 12px; font-size: 13px; color: #4a5568; }
  input { display: block; width: 100%; padding: 8px; margin-top: 4px; border: 1px solid #cbd5e0; border-radius: 4px; }
  button[type="submit"] { width: 100%; padding: 10px; background: #3182ce; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 8px; }
  button[type="submit"]:disabled { background: #a0aec0; }
  .error { color: #c53030; font-size: 12px; margin-top: 8px; }
  .quick-login { margin-top: 24px; font-size: 12px; color: #718096; }
  .quick-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 8px; }
  .quick-buttons button { padding: 4px; font-size: 11px; background: #edf2f7; border: 1px solid #cbd5e0; border-radius: 3px; cursor: pointer; }
</style>
```

### 7.3 UserMenu.svelte(用户菜单)

```svelte
<!-- src/lib/views/Auth/UserMenu.svelte -->
<script lang="ts">
  import { currentUser, roleLabel, logout } from '$lib/stores/auth';
  import { goto } from '$app/navigation';

  let showMenu = false;
</script>

<div class="user-menu">
  <button class="avatar" on:click={() => (showMenu = !showMenu)}>
    <span class="avatar-circle">
      {$currentUser?.displayName.charAt(0) ?? '?'}
    </span>
    <span class="user-info">
      <span class="name">{$currentUser?.displayName}</span>
      <span class="role">{$roleLabel}</span>
    </span>
  </button>

  {#if showMenu}
    <div class="dropdown" on:click|self={() => (showMenu = false)}>
      <button on:click={() => goto('/profile')}>个人设置</button>
      {#if $currentUser?.role === 'auditor'}
        <button on:click={() => goto('/audit/')}>审计员工作台</button>
      {/if}
      {#if ['it', 'exec'].includes($currentUser?.role ?? '')}
        <button on:click={() => goto('/activity-log')}>活动日志</button>
      {/if}
      <hr />
      <button class="logout" on:click={() => logout()}>退出登录</button>
    </div>
  {/if}
</div>

<style>
  .user-menu { position: relative; }
  .avatar { display: flex; align-items: center; gap: 8px; background: none; border: none; cursor: pointer; }
  .avatar-circle { width: 32px; height: 32px; border-radius: 50%; background: #3182ce; color: white; display: flex; align-items: center; justify-content: center; font-weight: 600; }
  .user-info { display: flex; flex-direction: column; align-items: flex-start; }
  .name { font-size: 13px; color: #2d3748; }
  .role { font-size: 11px; color: #718096; }
  .dropdown { position: absolute; right: 0; top: 100%; background: white; border: 1px solid #e2e8f0; border-radius: 4px; min-width: 160px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
  .dropdown button { display: block; width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; cursor: pointer; font-size: 13px; }
  .dropdown button:hover { background: #edf2f7; }
  .dropdown hr { margin: 4px 0; border: none; border-top: 1px solid #e2e8f0; }
  .dropdown .logout { color: #c53030; }
</style>
```

### 7.4 NotificationBell.svelte(通知铃铛)

```svelte
<!-- src/lib/views/Notifications/NotificationBell.svelte -->
<script lang="ts">
  import {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
  } from '$lib/stores/notifications';
  import { goto } from '$app/navigation';

  let showDropdown = false;

  function handleClick(n: Notification): void {
    markAsRead(n.id);
    if (n.link) goto(n.link);
    showDropdown = false;
  }
</script>

<div class="notification-bell">
  <button class="bell-btn" on:click={() => (showDropdown = !showDropdown)}>
    🔔
    {#if $unreadCount > 0}
      <span class="badge">{$unreadCount}</span>
    {/if}
  </button>

  {#if showDropdown}
    <div class="dropdown" on:click|self={() => (showDropdown = false)}>
      <header class="dropdown-header">
        <span>通知</span>
        {#if $unreadCount > 0}
          <button class="mark-all" on:click={markAllAsRead}>全部已读</button>
        {/if}
      </header>
      <div class="dropdown-body">
        {#if $notifications.length === 0}
          <div class="empty">暂无通知</div>
        {:else}
          {#each $notifications.slice(0, 20) as n}
            <button
              class="notification-item"
              class:unread={!n.read}
              on:click={() => handleClick(n)}
            >
              <div class="notif-title">{n.title}</div>
              <div class="notif-body">{n.body}</div>
              <div class="notif-time">{new Date(n.createdAt).toLocaleString('zh-CN')}</div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .notification-bell { position: relative; }
  .bell-btn { background: none; border: none; font-size: 18px; cursor: pointer; position: relative; padding: 4px 8px; }
  .badge { position: absolute; top: 0; right: 0; background: #e53e3e; color: white; font-size: 10px; border-radius: 10px; padding: 1px 5px; min-width: 16px; }
  .dropdown { position: absolute; right: 0; top: 100%; width: 320px; background: white; border: 1px solid #e2e8f0; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
  .dropdown-header { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 13px; }
  .mark-all { background: none; border: none; color: #3182ce; font-size: 12px; cursor: pointer; }
  .dropdown-body { max-height: 400px; overflow-y: auto; }
  .notification-item { display: block; width: 100%; text-align: left; padding: 10px 12px; background: none; border: none; border-bottom: 1px solid #f7fafc; cursor: pointer; }
  .notification-item.unread { background: #ebf8ff; }
  .notif-title { font-weight: 500; font-size: 13px; color: #2d3748; }
  .notif-body { font-size: 12px; color: #4a5568; margin-top: 2px; }
  .notif-time { font-size: 11px; color: #a0aec0; margin-top: 4px; }
  .empty { padding: 20px; text-align: center; color: #a0aec0; font-size: 13px; }
</style>
```

### 7.5 PublishQueueList.svelte(发布队列)

```svelte
<!-- src/lib/views/PublishQueue/PublishQueueList.svelte -->
<script lang="ts">
  import {
    publishQueue,
    pendingRequests,
    approvePublish,
    rejectPublish,
  } from '$lib/stores/publish-queue';
  import { can } from '$lib/stores/auth';
  import ReviewDialog from './ReviewDialog.svelte';

  let reviewingId: string | null = null;
  let reviewAction: 'approve' | 'reject' | null = null;

  async function handleReview(action: 'approve' | 'reject', comment: string): Promise<void> {
    if (!reviewingId) return;
    if (action === 'approve') {
      await approvePublish(reviewingId, comment);
    } else {
      await rejectPublish(reviewingId, comment);
    }
    reviewingId = null;
    reviewAction = null;
  }
</script>

<div class="publish-queue-page">
  <h1>发布队列</h1>

  <section class="pending-section">
    <h2>待审批({$pendingRequests.length})</h2>
    {#if $pendingRequests.length === 0}
      <div class="empty">暂无待审批请求</div>
    {:else}
      {#each $pendingRequests as req}
        <div class="request-card pending">
          <header>
            <span class="ws-name">{req.workspaceName}</span>
            <span class="status pending">待审批</span>
          </header>
          <div class="meta">
            <span>提交人: {req.submittedBy.displayName}</span>
            <span>提交时间: {new Date(req.submittedAt).toLocaleString('zh-CN')}</span>
            <span>规则集哈希: <code>{req.rulesetHash.slice(0, 16)}...</code></span>
          </div>
          {#if req.testReportId}
            <a href={`/test-reports/${req.testReportId}`} class="test-report-link">查看测试报告</a>
          {/if}
          {#if can('approve_publish')}
            <div class="actions">
              <button class="approve" on:click={() => { reviewingId = req.id; reviewAction = 'approve'; }}>
                ✅ 批准
              </button>
              <button class="reject" on:click={() => { reviewingId = req.id; reviewAction = 'reject'; }}>
                ❌ 驳回
              </button>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </section>

  <section class="history-section">
    <h2>历史记录</h2>
    {#each $publishQueue.filter((r) => r.status !== 'pending') as req}
      <div class="request-card">
        <header>
          <span class="ws-name">{req.workspaceName}</span>
          <span class="status {req.status}">{req.status}</span>
        </header>
        <div class="meta">
          <span>提交人: {req.submittedBy.displayName}</span>
          {#if req.reviewedBy}
            <span>审批人: {req.reviewedBy.displayName}</span>
          {/if}
          {#if req.publishedRulesetVersion}
            <span>发布版本: v{req.publishedRulesetVersion}</span>
          {/if}
        </div>
      </div>
    {/each}
  </section>
</div>

{#if reviewingId}
  <ReviewDialog
    action={reviewAction!}
    on:submit={(e) => handleReview(e.detail.action, e.detail.comment)}
    on:cancel={() => { reviewingId = null; reviewAction = null; }}
  />
{/if}

<style>
  .publish-queue-page { padding: 20px; max-width: 900px; margin: 0 auto; }
  h1 { color: #1a365d; }
  .pending-section { margin-bottom: 32px; }
  .request-card { background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin-bottom: 12px; }
  .request-card.pending { border-left: 4px solid #d69e2e; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .ws-name { font-weight: 600; color: #2d3748; }
  .status { font-size: 12px; padding: 2px 8px; border-radius: 12px; }
  .status.pending { background: #fefcbf; color: #744210; }
  .status.approved { background: #c6f6d5; color: #22543d; }
  .status.rejected { background: #fed7d7; color: #742a2a; }
  .status.published { background: #bee3f8; color: #2a4365; }
  .meta { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #4a5568; }
  code { background: #f7fafc; padding: 2px 4px; border-radius: 3px; font-family: monospace; }
  .actions { margin-top: 12px; display: flex; gap: 8px; }
  .approve { background: #38a169; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
  .reject { background: #e53e3e; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
  .empty { padding: 20px; text-align: center; color: #a0aec0; }
</style>
```

### 7.6 VersionTimeline.svelte(版本历史时间线)

```svelte
<!-- src/lib/views/VersionHistory/VersionTimeline.svelte -->
<script lang="ts">
  import {
    productionAuditEntries,
    loadProductionAudit,
  } from '$lib/stores/production-audit';
  import { onMount } from 'svelte';

  onMount(() => loadProductionAudit(50));
</script>

<div class="timeline-page">
  <h1>版本历史</h1>
  <p class="subtitle">Production 规则集的所有发布和回滚记录(production_audit 表)</p>

  <div class="timeline">
    {#each $productionAuditEntries as entry}
      <div class="timeline-item" class:publish={entry.eventType === 'ruleset_published'} class:rollback={entry.eventType === 'ruleset_rollback'}>
        <div class="marker">
          {entry.eventType === 'ruleset_published' ? '⬆️' : '⬇️'}
        </div>
        <div class="content">
          <header>
            <span class="version">v{entry.rulesetVersion}</span>
            {#if entry.eventType === 'ruleset_published'}
              <span class="event-type publish">发布</span>
            {:else}
              <span class="event-type rollback">回滚</span>
              <span class="rollback-to">回滚到 v{entry.previousVersion}</span>
            {/if}
            <span class="time">{new Date(entry.operatedAt).toLocaleString('zh-CN')}</span>
          </header>
          <div class="details">
            <div>操作人: {entry.operatedBy.displayName}({entry.operatedBy.role})</div>
            <div>规则集哈希: <code>{entry.rulesetHash}</code></div>
            {#if entry.sourceWorkspaceIds.length > 0}
              <div>来源 Workspace: {entry.sourceWorkspaceIds.join(', ')}</div>
            {/if}
            {#if entry.reason}
              <div class="reason">原因: {entry.reason}</div>
            {/if}
            {#if entry.testReportIds && entry.testReportIds.length > 0}
              <div>测试报告: {entry.testReportIds.join(', ')}</div>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .timeline-page { padding: 20px; max-width: 900px; margin: 0 auto; }
  h1 { color: #1a365d; }
  .subtitle { color: #718096; font-size: 13px; margin-top: 4px; }
  .timeline { margin-top: 24px; position: relative; }
  .timeline::before { content: ''; position: absolute; left: 16px; top: 0; bottom: 0; width: 2px; background: #e2e8f0; }
  .timeline-item { display: flex; gap: 16px; margin-bottom: 24px; position: relative; }
  .marker { width: 32px; height: 32px; border-radius: 50%; background: white; border: 2px solid #cbd5e0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; z-index: 1; }
  .timeline-item.publish .marker { border-color: #38a169; }
  .timeline-item.rollback .marker { border-color: #e53e3e; }
  .content { flex: 1; background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .version { font-weight: 600; color: #1a365d; font-size: 16px; }
  .event-type { font-size: 12px; padding: 2px 8px; border-radius: 12px; }
  .event-type.publish { background: #c6f6d5; color: #22543d; }
  .event-type.rollback { background: #fed7d7; color: #742a2a; }
  .rollback-to { font-size: 12px; color: #718096; }
  .time { margin-left: auto; font-size: 12px; color: #a0aec0; }
  .details { font-size: 13px; color: #4a5568; display: flex; flex-direction: column; gap: 4px; }
  code { background: #f7fafc; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 11px; word-break: break-all; }
  .reason { color: #c53030; }
</style>
```

---

## 8. 后端 API 设计

### 8.1 认证 API

| API | 方法 | 功能 | 权限 |
| --- | --- | --- | --- |
| `/api/auth/login` | POST | 登录(用户名 + 密码) | 公开 |
| `/api/auth/logout` | POST | 退出 | 已登录 |
| `/api/auth/me` | GET | 获取当前用户信息 | 已登录 |
| `/api/users` | GET | 用户列表(邀请成员时搜索) | 已登录 |
| `/api/users/:id` | GET | 用户详情 | 已登录或本人 |

### 8.2 Workspace 成员 API

| API | 方法 | 功能 | 权限 |
| --- | --- | --- | --- |
| `/api/workspaces/:id/members` | GET | 成员列表 | WS 成员 |
| `/api/workspaces/:id/members` | POST | 邀请成员 | WS 创建者 / lead+ |
| `/api/workspaces/:id/members/:uid` | PATCH | 改角色 | WS 创建者 / lead+ |
| `/api/workspaces/:id/members/:uid` | DELETE | 移除成员 | WS 创建者 / lead+ |

### 8.3 发布队列 API

| API | 方法 | 功能 | 权限 |
| --- | --- | --- | --- |
| `/api/publish-queue` | GET | 队列列表(it/exec 看全院,lead 看本科室) | `view_publish_queue` |
| `/api/publish-queue` | POST | 提交 Final 候选 | `submit_to_publish` |
| `/api/publish-queue/:id` | GET | 请求详情 | `view_publish_queue` |
| `/api/publish-queue/:id/approve` | POST | 批准发布 | `approve_publish` |
| `/api/publish-queue/:id/reject` | POST | 驳回 | `approve_publish` |
| `/api/publish-queue/:id/cancel` | POST | 取消(提交者) | `submit_to_publish`(本人) |

### 8.4 Production 审计 API

| API | 方法 | 功能 | 权限 |
| --- | --- | --- | --- |
| `/api/production-audit` | GET | 版本历史 | 已登录 |
| `/api/production-audit/:id` | GET | 单条详情 | 已登录 |
| `/api/production-state` | GET | 当前 production 状态 | 已登录 |

### 8.5 评论 API

| API | 方法 | 功能 | 权限 |
| --- | --- | --- | --- |
| `/api/comments` | GET | 评论列表(按 target) | WS 成员 |
| `/api/comments` | POST | 发表评论 | WS 成员 |
| `/api/comments/:id` | DELETE | 删除评论 | 作者或 lead+ |

### 8.6 通知 API

| API | 方法 | 功能 | 权限 |
| --- | --- | --- | --- |
| `/api/notifications` | GET | 通知列表 | 已登录 |
| `/api/notifications/:id/read` | POST | 标记已读 | 已登录(本人) |
| `/api/notifications/read-all` | POST | 全部已读 | 已登录(本人) |
| `/ws/notifications` | WS | 实时通知推送 | 已登录 |

### 8.7 活动日志 API

| API | 方法 | 功能 | 权限 |
| --- | --- | --- | --- |
| `/api/activity-log` | GET | 活动日志(支持筛选) | `it` / `exec` / `auditor` |

### 8.8 编辑锁 API

| API | 方法 | 功能 | 权限 |
| --- | --- | --- | --- |
| `/api/rules/:id/edit-lock` | POST | 获取锁 | WS 成员 + `edit_draft` |
| `/api/rules/:id/edit-lock` | PUT | 续期 | 锁持有者 |
| `/api/rules/:id/edit-lock` | DELETE | 释放锁 | 锁持有者 |
| `/api/rules/:id/edit-lock/release` | POST | 释放锁(sendBeacon,页面卸载) | 锁持有者 |

### 8.9 紧急回滚 API

| API | 方法 | 功能 | 权限 |
| --- | --- | --- | --- |
| `/api/production/rollback` | POST | 紧急回滚到指定版本 | `rollback_ruleset` |

**请求**:
```json
{
  "target_version": 16,
  "reason": "新规则误触发,紧急回滚"
}
```

**流程**(服务端):
1. 加载 v16 的规则集(从 production_audit 表查 ruleset_hash,从 rules 表查历史版本)
2. 调用 `POST /api/rules/reload` + `POST /api/sessions/from/{old_id}`(fork)
3. 切换 production_state.current_session_id
4. 打新 ruleset_version(如 v18)
5. 写 production_audit(event_type=ruleset_rollback, previous_version=17)
6. 通知所有客户端(session_switched + rollback_triggered)

---

## 9. 协作流程编排

### 9.1 完整协作流程(医院场景)

```
[T0] 张医生(user)登录 → 看监控大屏
   ↓
[T1] 张医生创建 Workspace "ws-内科-发烧CT规则修订"
     ├── 自动成为 WS 创建者(reviewer 角色)
     └── 邀请李医生(author)+ 王主任(reviewer,本科室 lead)
   ↓
[T2] 李医生在 WS 内创建 Draft 规则
     ├── 获取编辑锁(5 分钟)
     ├── 编辑 Draft(业务表单 + LLM 翻译)
     └── 释放锁
   ↓
[T3] 张医生在 WS 内评论规则:"@王主任 请审核这条规则"
     └── 王主任收到 @提及通知
   ↓
[T4] 王主任登录,看通知 → 进入 WS
     ├── 查看 Draft + 评论
     ├── 启动沙盒测试(见三层架构 §5)
     ├── 查看测试报告(18/20 通过)
     └── 批准 Draft → Final 候选
   ↓
[T5] 王主任提交 Final 候选到 Publish Queue
     ├── 附测试报告
     └── 信息科收到 publish_submitted 通知
   ↓
[T6] 张工(it)登录,看 Publish Queue
     ├── 审批请求(查看测试报告 + 影响预览)
     ├── 批准 → status = approved
     └── 触发滚动 session 热重载(§3.3)
   ↓
[T7] 滚动 session 发布完成
     ├── production_audit 写入(event_type=ruleset_published, v17)
     ├── 全员收到 publish_completed 通知
     └── WS 归档(可查历史)
   ↓
[T8] 异常:新规则误触发
     ├── 张工紧急回滚到 v16(打 v18 版本号)
     ├── production_audit 写入(event_type=ruleset_rollback, v18)
     └── 全员收到 rollback_triggered 通知
```

### 9.2 评论 @提及流程

```typescript
// CommentEditor.svelte 中
async function handlePost(): Promise<void> {
  const body = commentText;
  // 解析 @mentions(正则匹配 @username)
  const mentionRegex = /@(\w+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(body)) !== null) {
    const username = match[1];
    const user = await findUserByUsername(username);
    if (user) mentions.push(user.id);
  }
  await postComment(workspaceId, targetType, targetId, body, mentions);
  // mentions 中的用户会收到 comment_mention 通知
}
```

### 9.3 编辑锁冲突处理

```svelte
<!-- RuleEditor.svelte 中 -->
<script lang="ts">
  import { acquireLock, releaseLock, currentLocks } from '$lib/stores/edit-lock';
  import { onMount, onDestroy } from 'svelte';

  export let ruleId: string;
  let canEdit = false;
  let lockHolder: string | null = null;

  onMount(async () => {
    canEdit = await acquireLock(ruleId);
    if (!canEdit) {
      const lock = $currentLocks[ruleId];
      lockHolder = lock?.holder.displayName ?? '其他人';
    }
  });

  onDestroy(() => {
    if (canEdit) releaseLock(ruleId);
  });
</script>

{#if canEdit}
  <!-- 编辑器 -->
  <textarea bind:value={ruleContent}></textarea>
{:else}
  <div class="lock-notice">
    ⚠️ {lockHolder} 正在编辑此规则,请稍后再试。
    <button on:click={() => acquireLock(ruleId)}>重试获取锁</button>
  </div>
{/if}
```

---

## 10. 与现有文档/代码的集成

### 10.1 P05 InterventionBar 权限守卫

**修改文件**:[P05_MONITOR_DASHBOARD_DESIGN.md](file:///d:/evorule-console-cloud/docs/P05_MONITOR_DASHBOARD_DESIGN.md)

P05 InterventionBar 所有按钮增加权限守卫:

```svelte
<!-- P05 InterventionBar 修改 -->
<div class="intervention-bar">
  <!-- 通用按钮(所有登录用户可见) -->
  <button onclick={() => goto('/view/audit')}>📜 审计</button>
  <button onclick={() => goto('/view/timetravel')}>⏪ 时间旅行</button>

  <!-- 高风险操作(仅 it/exec) -->
  {#if can('intervene_runtime')}
    <button onclick={requestConfirm('中断', doInterrupt)}>⛔ 中断</button>
    <button onclick={requestConfirm('单步', doStep)}>👣 单步</button>
    <button onclick={doSnapshot}>📸 快照</button>
  {/if}

  <!-- 回滚(仅 it/exec) -->
  {#if can('rollback_ruleset')}
    <button onclick={() => goto('/rollback')}>↩ 回滚</button>
  {/if}

  <!-- 热重载(仅 it) -->
  {#if can('approve_publish')}
    <button onclick={() => goto('/workspace')}>🔄 热重载</button>
  {/if}
</div>
```

### 10.2 HOME_DESIGN 顶部导航

**修改文件**:[HOME_DESIGN.md](file:///d:/evorule-console-cloud/docs/HOME_DESIGN.md)

顶部导航增加用户菜单 + 通知铃铛 + Workspace 切换器:

```svelte
<!-- 顶部导航 -->
<header class="top-nav">
  <div class="left">
    <img src="/logo.svg" alt="evorule" />
    <WorkspaceSwitcher />
  </div>
  <div class="right">
    <NotificationBell />
    <UserMenu />
  </div>
</header>
```

### 10.3 P06 审计员工作台

**修改文件**:[P06_BUSINESS_AUDIT_TT_DESIGN.md](file:///d:/evorule-console-cloud/docs/P06_BUSINESS_AUDIT_TT_DESIGN.md)

P06 BusinessAuditView 路由守卫:`/audit/` 路由仅 `auditor` 角色可访问。

```typescript
// src/routes/audit/+layout.ts
import { redirect } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { currentUser } from '$lib/stores/auth';

export function load() {
  const user = get(currentUser);
  if (!user) throw redirect(302, '/login');
  if (user.role !== 'auditor') throw redirect(302, '/');
  return {};
}
```

### 10.4 P01 Workspace 创建后集成

**修改文件**:[P01_BUILD_SCHEMA_DESIGN.md](file:///d:/evorule-console-cloud/docs/P01_BUILD_SCHEMA_DESIGN.md)

P01 创建 Workspace 后,P0-8 接管成员管理:

```typescript
// P01 Workspace 创建后
async function createWorkspace(name: string, description: string): Promise<string> {
  const wsId = await api.createWorkspace({ name, description });
  // P0-8:创建者自动成为 reviewer
  await inviteMember(wsId, currentUser.username, 'reviewer');
  // P0-8:加载默认成员(可选)
  return wsId;
}
```

---

## 11. 测试用例

### 11.1 单元测试

| 测试 | 输入 | 期望 |
| --- | --- | --- |
| 权限矩阵 - 普通用户 | user.can('approve_publish') | false |
| 权限矩阵 - 信息科 | it.can('approve_publish') | true |
| 权限矩阵 - 审计员写操作 | auditor.can('edit_draft') | false |
| Workspace 成员校验 | 非成员 user.can('edit_draft', { workspaceId: 'ws-x' }) | false |
| 编辑锁获取 | 用户 A 获取锁 → 用户 B 获取 | A 成功,B 收到 409 |
| 编辑锁续期 | 持有者 2 分钟后续期 | 锁过期时间更新 |
| 编辑锁释放 | 持有者释放 → 另一用户获取 | 成功 |
| 编辑锁自动过期 | 5 分钟无操作 | 锁自动释放 |
| 通知未读数 | 3 条通知,1 条已读 | unreadCount = 2 |

### 11.2 集成测试

| 测试 | 步骤 | 期望 |
| --- | --- | --- |
| 登录流程 | 输入用户名密码 → 提交 | currentUser 设置,跳转首页 |
| 退出流程 | 点退出 | currentUser 清空,跳转登录页 |
| 邀请成员 | WS 创建者邀请用户 | 成员列表新增,被邀请人收到通知 |
| 提交发布队列 | reviewer 提交 Final 候选 | 队列新增 pending,信息科收到通知 |
| 审批发布 | it 批准 → 滚动 session | status=published,production_audit 新增,全员收到通知 |
| 紧急回滚 | it 回滚到 v16 | production_audit 新增(ruleset_rollback),版本号 v18,全员收到通知 |
| 评论 @提及 | 用户 A 评论 @用户B | 用户 B 收到 comment_mention 通知 |
| 编辑锁冲突 | 用户 A 编辑中,用户 B 尝试编辑 | B 看到"X 正在编辑"提示 |
| 角色权限隔离 | user 尝试调 approve_publish API | 后端返回 403 |
| 审计员工作台访问 | auditor 访问 /audit/ | 可访问;user 访问 /audit/ | 跳转 / |
| 版本历史时间线 | 查看版本历史 | 显示 v16→v17→v18(回滚)时间线 |

### 11.3 E2E 测试(医院 10 科室场景)

| 测试 | 步骤 | 期望 |
| --- | --- | --- |
| 5 科室并行编辑 | 5 个 WS 各自创建 Draft | 互不可见,Production 不受影响 |
| 协作审核 | WS 内 author 编辑 → reviewer 审核 | reviewer 收到 @提及通知,审核通过 |
| 队列发布 | 5 个 WS 提交 → it 审批 | FIFO 队列,逐个发布,版本号递增 |
| 紧急回滚 | 发布后异常 → it 回滚 | 滚动 session 切换,版本号 v18,通知全员 |
| 审计员独立工作台 | auditor 登录 | 跳转 /audit/,只读,无任何写按钮 |

---

## 12. 实施路径

### 12.1 实施步骤(6 步)

| 步骤 | 内容 | 文件 | 依赖 |
| --- | --- | --- | --- |
| 1 | 用户身份 + 权限矩阵 | `auth.ts`、`permission-matrix.ts`、后端 `auth` crate | 无 |
| 2 | 后端协作 API(成员/队列/评论/通知/活动日志/锁) | evorule-server `api/collab.rs` | 步骤 1 |
| 3 | 前端 authStore + UserMenu + LoginForm | `Auth/*.svelte` | 步骤 1 |
| 4 | 前端 Workspace 成员 + 评论 + 通知组件 | `Collab/*.svelte` | 步骤 2-3 |
| 5 | 前端 PublishQueue + VersionHistory + ActivityLog | `PublishQueue/*.svelte`、`VersionHistory/*.svelte` | 步骤 2-3 |
| 6 | 集成 P05/P06/HOME_DESIGN 权限守卫 | 修改 P05/P06/HOME_DESIGN | 步骤 3-5 |

### 12.2 与其他 P0 的实施顺序

```
P01 → P02 → P03 → P04 → P05 → P06 → P07 → P08(本文档,可与 P07 并行)
                                              ↓
                                             P09(导入导出基础设施)
```

P08 依赖 P01(Workspace 创建)、P05(InterventionBar 权限守卫)、P06(审计员工作台路由)。

---

## 13. 长期演进路径

### 13.1 P0 → P1

| P0 | P1+ |
| --- | --- |
| 本地账号 + 密码 | SSO/OIDC/LDAP 集成 |
| 5 个内置角色 | 自定义角色(RBAC 引擎) |
| 单人审批 | 双人审批 + 多级会签 |
| 编辑锁(悲观) | 实时协同(OT/CRDT) |
| 站内通知 | + 邮件 / IM webhook |
| 文本评论 | 富文本 + 附件 + 线程 |
| 基础活动日志 | 异常行为检测 + 告警 |
| 单租户 | 多租户隔离 |
| 角色级权限 | 细粒度(规则级/字段级) |

### 13.2 P1

- P1-7 合规规则库双人审批:合规规则变更需合规官 + 业务负责人双签
- P1-10 审计员独立身份深化:审计员工作台 5 视图完整化
- P1-11 不可篡改复用:活动日志进 BLAKE3 链

### 13.3 P2

- 多租户:医院 / 部门级 tenant 隔离
- 工作流引擎:BPMN 流程定义,支持复杂审批流
- 权限策略引擎:OPA(Open Policy Agent)集成

---

## 14. 代码变更列表

### 14.1 新增文件(前端)

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/lib/stores/auth.ts` | Store | 用户身份 + 权限检查 |
| `src/lib/stores/permission-matrix.ts` | Const | 角色权限矩阵 |
| `src/lib/stores/workspace-members.ts` | Store | Workspace 成员管理 |
| `src/lib/stores/publish-queue.ts` | Store | 发布队列 |
| `src/lib/stores/production-audit.ts` | Store | 版本历史 |
| `src/lib/stores/comments.ts` | Store | 评论讨论 |
| `src/lib/stores/notifications.ts` | Store | 站内通知(WebSocket) |
| `src/lib/stores/edit-lock.ts` | Store | 编辑锁 |
| `src/lib/stores/activity-log.ts` | Store | 活动日志 |
| `src/lib/views/Auth/LoginForm.svelte` | Component | 登录表单 |
| `src/lib/views/Auth/UserMenu.svelte` | Component | 用户菜单 |
| `src/lib/views/Notifications/NotificationBell.svelte` | Component | 通知铃铛 |
| `src/lib/views/Notifications/NotificationDropdown.svelte` | Component | 通知下拉 |
| `src/lib/views/Collab/WorkspaceSwitcher.svelte` | Component | Workspace 切换 |
| `src/lib/views/Collab/WorkspaceMembersPanel.svelte` | Component | 成员管理 |
| `src/lib/views/Collab/InviteMemberDialog.svelte` | Component | 邀请成员 |
| `src/lib/views/Collab/CommentThread.svelte` | Component | 评论线程 |
| `src/lib/views/Collab/CommentEditor.svelte` | Component | 评论编辑 |
| `src/lib/views/Collab/ReviewActions.svelte` | Component | WS 内审核 |
| `src/lib/views/PublishQueue/PublishQueueList.svelte` | Component | 队列列表 |
| `src/lib/views/PublishQueue/PublishRequestCard.svelte` | Component | 请求卡片 |
| `src/lib/views/PublishQueue/ReviewDialog.svelte` | Component | 审批弹窗 |
| `src/lib/views/VersionHistory/VersionTimeline.svelte` | Component | 版本时间线 |
| `src/lib/views/VersionHistory/VersionDetailPanel.svelte` | Component | 版本详情 |
| `src/lib/views/ActivityLog/ActivityLogTable.svelte` | Component | 活动日志表 |
| `src/routes/login/+page.svelte` | Route | 登录页 |
| `src/routes/publish-queue/+page.svelte` | Route | 发布队列页 |
| `src/routes/version-history/+page.svelte` | Route | 版本历史页 |
| `src/routes/activity-log/+page.svelte` | Route | 活动日志页 |
| `src/routes/audit/+layout.ts` | Guard | 审计员路由守卫 |

### 14.2 新增文件(后端 evorule-server)

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/auth/mod.rs` | Module | 认证模块(session + bcrypt) |
| `src/auth/middleware.rs` | Middleware | 请求级权限守卫 |
| `src/collab/mod.rs` | Module | 协作模块(成员/队列/评论/通知/锁) |
| `src/collab/publish_queue.rs` | Module | 发布队列 + 滚动 session 发布 |
| `src/collab/notifications.rs` | Module | WebSocket 通知推送 |
| `src/collab/edit_lock.rs` | Module | 编辑锁 |
| `src/collab/rollback.rs` | Module | 紧急回滚 |
| `migrations/001_users.sql` | SQL | users + user_sessions 表 |
| `migrations/002_collab.sql` | SQL | comments + notifications + activity_log + edit_locks 表 |

### 14.3 修改文件

| 文件 | 修改 |
| --- | --- |
| P05 `InterventionBar.svelte` | 所有按钮加 `can()` 权限守卫 |
| P06 `BusinessAuditView.svelte` | `/audit/` 路由加 auditor 守卫 |
| HOME_DESIGN 顶部导航 | 加 UserMenu + NotificationBell + WorkspaceSwitcher |
| P01 Workspace 创建 | 创建者自动成为 reviewer + 邀请成员入口 |
| evorule-server `api/server.rs` | 注册 `/api/auth/*`、`/api/collab/*`、`/api/publish-queue/*`、`/ws/notifications` 路由 |
| evorule-server `Cargo.toml` | 加 `bcrypt`、`uuid`、`tokio-tungstenite`(WebSocket)依赖 |

---

## 15. 待办

- [ ] 后端 auth crate + bcrypt 密码哈希(步骤 1)
- [ ] 后端 collab crate + 所有协作 API(步骤 2)
- [ ] WebSocket 通知推送(步骤 2)
- [ ] 前端 authStore + LoginForm + UserMenu(步骤 3)
- [ ] 前端 Workspace 成员 + 评论 + 通知组件(步骤 4)
- [ ] 前端 PublishQueue + VersionHistory + ActivityLog(步骤 5)
- [ ] 集成 P05/P06/HOME_DESIGN 权限守卫(步骤 6)
- [ ] 紧急回滚端到端流程(步骤 6)
- [ ] 5 个内置账号初始化脚本
- [ ] SSO/OIDC 集成(P1)
- [ ] 双人审批工作流(P1)
- [ ] 实时协同编辑 OT/CRDT(P1)

---

> 设计文档 — 2026-08-06 定稿
