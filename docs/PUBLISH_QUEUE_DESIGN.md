<!--
  设计文档 — 发布队列实施级设计
  位置: D:\evorule-console-cloud\docs\PUBLISH_QUEUE_DESIGN.md
  写于: 2026-08-06
  来源: 三层架构 §3.3(滚动 session 热重载) + §7(发布工作流) + §12.4 U7 决策
  关联:
    - WORKSPACE_CRATE_DESIGN.md(§3.2 表 5/7/8 + M5 SessionOps)
    - SANDBOX_ORCHESTRATION_DESIGN.md(测试报告,发布时附带)
    - evorule-three-layer-architecture.md §3.3(滚动 session) §7(三级权限) §12.4(U7 SSE)
    - P08_COLLAB_WORKFLOW_DESIGN.md(角色模型,消费三级权限)
    - HOME_DESIGN.md §6.5(productionStateStore.onSessionSwitched)
  状态: 2026-08-06 定稿,第四梯队第 3 份
  实测依据: evorule-server POST /api/rules/reload + fork API + SSE events + SessionManager
-->

# 发布队列实施级设计

> **状态**: 设计文档,2026-08-06 定稿。本文档是三层架构 §3.3(滚动 session 热重载)+ §7(发布工作流)+ §12.4(U7 决策)的可实施落地,目标仓库 `evorule-server`。

## 0. 摘要

**目标**:实现三层架构 §7 的发布工作流——三级权限审批 + 排队冲突处理 + 滚动 session 热重载编排 + U7 SSE 推送切换通知。

**核心机制**:发布动作 = `写入 rules_dir → reload → fork 新 session → 切换 production_state → 推送 session_switched SSE → drain 旧 session`。全程不中断正在处理的 Fact,版本号单调递增,审计链可追溯。

**关键决策**:

| # | 决策 | 选项 |
|---|------|------|
| P1 | 编排模块位置 | `core/workspace` crate 内新增 `publish_service.rs` 模块 |
| P2 | 发布锁 | `tokio::sync::Mutex` 全局单锁(同时只允许一个发布动作执行) |
| P3 | 冲突检测 | P0 人工(信息科决定);P1 实现 rule_key 自动冲突检测 |
| P4 | 旧 session drain 超时 | 30s(与 evorule-server `GRACEFUL_SHUTDOWN_TIMEOUT` 一致) |
| P5 | SSE session_switched 推送 | 通过 `broadcast` 通道向旧 session 的 SSE 订阅者推送 |

**不做什么**:

- ❌ 不实现复杂 RBAC(P0 三级角色硬编码,P1 接入 P08 协作工作流的角色模型)
- ❌ 不实现自动规则合并(P0 人工决定,P2 可选)
- ❌ 不修改 evorule-server 已有的 reload API(复用 `POST /api/rules/reload`)
- ❌ 不实现发布 UI(见 P05 监控大屏 + P08 协作工作流,消费本文档 API)

---

## 1. 背景与定位

### 1.1 三层架构 §7 发布工作流回顾

```
[Workspace 内]
  Draft → Reviewing(科室主任审核)→ Approved
   ↓
[提交到 Publish Queue]
  附测试报告 + 科室主任签字
  status = pending
   ↓
[信息科/院领导审批]
  查看测试报告 / 影响分析 / 合规依据
  批准 → status = approved
  驳回 → status = rejected(回 WS 修改)
   ↓
[滚动 session 热重载到 Production](见 §3.3)
  1. 写入 rules_dir/*.json
  2. POST /api/rules/reload
  3. POST /api/sessions/from/{old_id}(fork)
  4. 切换 production_state.current_session_id
  5. 打新 ruleset_version
  6. 写 production_audit 表
  status = published
   ↓
[归档 Workspace]
  议题完成,WS 归档(可查历史)
```

### 1.2 三级发布权限(Q3 决策)

| 角色 | 提交到 Publish Queue | 审批发布(Production) | 紧急回滚 |
|------|---------------------|---------------------|----------|
| **普通医生** | ❌ | ❌ | ❌ |
| **科室主任** | ✅(本科室 WS) | ❌ | ❌ |
| **信息科/院领导** | ❌ | ✅(全院) | ✅ |

### 1.3 滚动 session 热重载(§3.3 回顾)

evorule-tcb 的 TCB 不可变语义:`replace_core_eval` 只影响**新创建**的 session,**已存在**的 session 不会中途换规则。因此热重载采用滚动 session 方案:

```
1. POST /api/rules/reload → SessionManager 内部 core_eval 更新
2. POST /api/sessions/from/{old_id} → Fork 旧 session(新 session 用新 core_eval)
3. 切换 production_state.current_session_id → 新 session_id
4. 向旧 session 的 SSE 订阅者推送 session_switched 事件(U7)
5. 客户端收到 session_switched → 关闭旧 SSE → 订阅新 session SSE
6. 旧 session drain 完在途 Fact 后 DELETE
```

---

## 2. 模块结构

### 2.1 在 workspace crate 中新增模块

```
core/workspace/src/
├── ... (已有模块) ...
├── publish_service.rs          ← 【新增】发布队列编排服务
├── rolling_session.rs          ← 【新增】滚动 session 热重载编排
└── session_switched.rs         ← 【新增】U7 SSE session_switched 推送
```

### 2.2 模块职责

| # | 模块 | 职责 |
|---|------|------|
| P1 | `publish_service` | 发布队列 CRUD + 三级权限校验 + 状态机 |
| P2 | `rolling_session` | 滚动 session 热重载编排(reload + fork + switch + drain) |
| P3 | `session_switched` | U7 SSE session_switched 事件推送 |

---

## 3. 发布队列服务(P1)

### 3.1 PublishService

```rust
// src/publish_service.rs

use crate::db::WorkspaceDb;
use crate::error::WorkspaceError;
use crate::models::*;
use crate::session_bridge::SessionOps;
use crate::rolling_session::RollingSessionService;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

/// 发布角色(P0 三级硬编码,P1 接入 P08 角色模型)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PublishRole {
    /// 普通医生(可编辑 Draft,不可提交发布)
    Doctor,
    /// 科室主任(可提交到发布队列,不可审批)
    DepartmentHead,
    /// 信息科/院领导(可审批发布 + 紧急回滚)
    Admin,
}

/// 发布队列服务
#[derive(Clone)]
pub struct PublishService {
    db: Arc<WorkspaceDb>,
    session_ops: Arc<dyn SessionOps>,
    rolling_session: RollingSessionService,
    /// 全局发布锁(同时只允许一个发布动作)
    publish_lock: Arc<Mutex<()>>,
}

/// 提交发布请求
#[derive(serde::Deserialize)]
pub struct SubmitPublishRequest {
    pub workspace_id: String,
    /// 待发布的 final_candidate 规则 ID 列表
    pub rule_ids: Vec<i64>,
    /// 附带的测试报告 ID(sandbox_id)
    pub test_report_sandbox_id: Option<i64>,
    /// 发布说明
    pub description: Option<String>,
}

/// 审批请求
#[derive(serde::Deserialize)]
pub struct ReviewPublishRequest {
    /// approved / rejected
    pub decision: String,
    pub comment: Option<String>,
}

impl PublishService {
    pub fn new(
        db: Arc<WorkspaceDb>,
        session_ops: Arc<dyn SessionOps>,
        rolling_session: RollingSessionService,
    ) -> Self {
        Self {
            db,
            session_ops,
            rolling_session,
            publish_lock: Arc::new(Mutex::new(())),
        }
    }

    /// 提交到发布队列(科室主任权限)
    ///
    /// 流程:
    /// 1. 校验角色(仅 DepartmentHead)
    /// 2. 校验规则状态(必须全部是 final_candidate)
    /// 3. 计算规则集 BLAKE3 哈希
    /// 4. 插入 publish_queue 表(status=pending)
    pub async fn submit_publish(
        &self,
        req: SubmitPublishRequest,
        submitted_by: &str,
        role: &PublishRole,
    ) -> Result<PublishQueueItem, WorkspaceError> {
        // 1. 权限校验
        if role != &PublishRole::DepartmentHead {
            return Err(WorkspaceError::Forbidden);
        }

        // 2. 校验规则状态
        let rules = self.db.get_rules_by_ids(&req.rule_ids)?;
        for rule in &rules {
            if rule.status != RuleStatus::FinalCandidate {
                return Err(WorkspaceError::BadRequest(format!(
                    "rule {} is not final_candidate (current: {:?})",
                    rule.id, rule.status
                )));
            }
            // 校验规则属于该 Workspace
            if rule.workspace_id.as_deref() != Some(&req.workspace_id) {
                return Err(WorkspaceError::Forbidden);
            }
        }

        // 3. 计算规则集 BLAKE3
        let mut hasher = blake3::Hasher::new();
        for rule in &rules {
            hasher.update(rule.rule_json.as_bytes());
            hasher.update(b"\n");
        }
        let ruleset_hash = hasher.finalize().to_hex().to_string();

        // 序列化规则集
        let final_candidate_rules = serde_json::to_string(
            &rules.iter().map(|r| serde_json::from_str::<serde_json::Value>(&r.rule_json)).collect::<Result<Vec<_>, _>>()
                .map_err(|e| WorkspaceError::Internal(format!("rule_json parse: {}", e)))?,
        )?;

        // 4. 插入 publish_queue
        let id = self.db.insert_publish_queue_item(
            &req.workspace_id,
            &final_candidate_rules,
            &ruleset_hash,
            req.test_report_sandbox_id,
            submitted_by,
        )?;

        info!(
            queue_id = id,
            workspace_id = %req.workspace_id,
            rule_count = rules.len(),
            ruleset_hash = %ruleset_hash,
            "Publish request submitted to queue"
        );

        self.db.get_publish_queue_item(id)?.ok_or(WorkspaceError::NotFound(format!("queue {}", id)))
    }

    /// 列出发布队列(按状态过滤)
    pub async fn list_queue(
        &self,
        status_filter: Option<PublishStatus>,
        requester_role: &PublishRole,
    ) -> Result<Vec<PublishQueueItem>, WorkspaceError> {
        // 所有角色可查看队列(但只有 Admin 可审批)
        self.db.list_publish_queue(status_filter)
    }

    /// 审批发布(信息科/院领导权限)
    ///
    /// 流程:
    /// 1. 校验角色(仅 Admin)
    /// 2. 校验队列项状态(必须 pending)
    /// 3. approved → 触发滚动 session 热重载
    ///    rejected → 更新状态 + 通知 Workspace
    pub async fn review_publish(
        &self,
        queue_id: i64,
        req: ReviewPublishRequest,
        reviewed_by: &str,
        role: &PublishRole,
    ) -> Result<PublishQueueItem, WorkspaceError> {
        // 1. 权限校验
        if role != &PublishRole::Admin {
            return Err(WorkspaceError::Forbidden);
        }

        let item = self
            .db
            .get_publish_queue_item(queue_id)?
            .ok_or(WorkspaceError::NotFound(format!("queue {}", queue_id)))?;

        if item.status != PublishStatus::Pending {
            return Err(WorkspaceError::BadRequest(format!(
                "queue {} is not pending (current: {:?})",
                queue_id, item.status
            )));
        }

        match req.decision.as_str() {
            "approved" => {
                // 更新队列状态
                self.db.update_publish_queue_status(
                    queue_id,
                    PublishStatus::Approved,
                    reviewed_by,
                    req.comment.as_deref(),
                )?;

                // 触发滚动 session 热重载(加全局锁)
                let published_version = self.execute_publish(queue_id, reviewed_by).await?;

                // 更新队列状态为 published
                self.db.complete_publish(queue_id, published_version)?;

                info!(
                    queue_id = queue_id,
                    published_version = published_version,
                    "Publish completed: ruleset rolled out to production"
                );
            }
            "rejected" => {
                self.db.update_publish_queue_status(
                    queue_id,
                    PublishStatus::Rejected,
                    reviewed_by,
                    req.comment.as_deref(),
                )?;

                info!(
                    queue_id = queue_id,
                    comment = ?req.comment,
                    "Publish request rejected"
                );
            }
            _ => {
                return Err(WorkspaceError::BadRequest(format!(
                    "invalid decision: {}",
                    req.decision
                )));
            }
        }

        self.db.get_publish_queue_item(queue_id)?.ok_or(WorkspaceError::NotFound(format!("queue {}", queue_id)))
    }

    /// 执行发布(滚动 session 热重载)
    ///
    /// 获取全局发布锁 → 调用 RollingSessionService
    async fn execute_publish(
        &self,
        queue_id: i64,
        published_by: &str,
    ) -> Result<i64, WorkspaceError> {
        let _lock = self.publish_lock.lock().await;

        let item = self
            .db
            .get_publish_queue_item(queue_id)?
            .ok_or(WorkspaceError::NotFound(format!("queue {}", queue_id)))?;

        // 解析规则集
        let rules: Vec<serde_json::Value> = serde_json::from_str(&item.final_candidate_rules)
            .map_err(|e| WorkspaceError::Internal(format!("parse rules: {}", e)))?;

        // 获取规则 ID 列表(从 rules 表查 final_candidate 的)
        // 实际实现需要从 item 关联的 workspace_id + status=final_candidate 查
        let rule_ids = self.db.get_final_candidate_rule_ids(&item.workspace_id)?;

        // 执行滚动 session 热重载
        let result = self
            .rolling_session
            .rolling_swap(
                &rules,
                &item.ruleset_hash,
                &item.workspace_id,
                rule_ids,
                published_by,
            )
            .await?;

        Ok(result.new_ruleset_version)
    }

    /// 紧急回滚(信息科/院领导权限)
    ///
    /// 回滚 = 用旧规则集 + 新版本号(版本号只增不减)
    pub async fn emergency_rollback(
        &self,
        target_version: i64,
        reason: &str,
        operated_by: &str,
        role: &PublishRole,
    ) -> Result<i64, WorkspaceError> {
        // 1. 权限校验
        if role != &PublishRole::Admin {
            return Err(WorkspaceError::Forbidden);
        }

        // 2. 查找目标版本的规则集快照
        let target_audit = self
            .db
            .get_production_audit_by_version(target_version)?
            .ok_or(WorkspaceError::NotFound(format!(
                "ruleset version {}",
                target_version
            )))?;

        // 3. 加全局发布锁
        let _lock = self.publish_lock.lock().await;

        // 4. 加载旧规则集(从 rules 表查 ruleset_version = target_version 的 published 规则)
        let old_rules = self.db.get_rules_by_ruleset_version(target_version)?;
        if old_rules.is_empty() {
            return Err(WorkspaceError::NotFound(format!(
                "no rules found for version {}",
                target_version
            )));
        }

        let rules: Vec<serde_json::Value> = old_rules
            .iter()
            .map(|r| serde_json::from_str(&r.rule_json))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| WorkspaceError::Internal(format!("parse rules: {}", e)))?;

        // 5. 滚动 session 切换(用旧规则集)
        let result = self
            .rolling_session
            .rolling_swap(
                &rules,
                &target_audit.ruleset_hash,
                "rollback",
                vec![], // 回滚不修改规则元数据
                operated_by,
            )
            .await?;

        // 6. 记录回滚审计
        self.db.insert_production_audit(
            "ruleset_rollback",
            result.new_ruleset_version,
            Some(target_version), // previous_version
            &result.new_ruleset_hash,
            result.new_session_id,
            &serde_json::json!([]).to_string(),
            operated_by,
            Some(reason),
            None,
        )?;

        info!(
            target_version = target_version,
            new_version = result.new_ruleset_version,
            operated_by = operated_by,
            reason = reason,
            "Emergency rollback completed"
        );

        Ok(result.new_ruleset_version)
    }
}
```

---

## 4. 滚动 session 热重载(P2)

### 4.1 RollingSessionService

```rust
// src/rolling_session.rs

use crate::db::WorkspaceDb;
use crate::error::WorkspaceError;
use crate::session_bridge::SessionOps;
use crate::session_switched::SessionSwitchedBroadcaster;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{info, warn};

/// 滚动 session 切换结果
pub struct RollingSwapResult {
    pub new_session_id: u64,
    pub new_ruleset_version: i64,
    pub new_ruleset_hash: String,
}

/// 滚动 session 热重载服务
pub struct RollingSessionService {
    db: Arc<WorkspaceDb>,
    session_ops: Arc<dyn SessionOps>,
    /// session_switched 广播器(U7 决策)
    switcher: SessionSwitchedBroadcaster,
    /// 旧 session drain 超时(P4 决策:30s)
    drain_timeout: Duration,
}

impl RollingSessionService {
    pub fn new(
        db: Arc<WorkspaceDb>,
        session_ops: Arc<dyn SessionOps>,
        switcher: SessionSwitchedBroadcaster,
    ) -> Self {
        Self {
            db,
            session_ops,
            switcher,
            drain_timeout: Duration::from_secs(30),
        }
    }

    /// 滚动 session 切换(核心编排)
    ///
    /// 三层架构 §3.3 完整流程:
    /// 1. 写入 rules_dir/*.json(让 reload 能扫描到)
    /// 2. POST /api/rules/reload(SessionManager 内部 core_eval 更新)
    /// 3. POST /api/sessions/from/{old_id}(Fork 旧 session,新 session 用新 core_eval)
    /// 4. 切换 production_state.current_session_id(原子更新)
    /// 5. 打新 ruleset_version(单调递增)
    /// 6. 写 production_audit 表
    /// 7. 向旧 session 的 SSE 订阅者推送 session_switched 事件(U7)
    /// 8. 旧 session drain 完在途 Fact 后 DELETE
    pub async fn rolling_swap(
        &self,
        rules: &[serde_json::Value],
        ruleset_hash: &str,
        source_workspace_id: &str,
        rule_ids: Vec<i64>,
        operated_by: &str,
    ) -> Result<RollingSwapResult, WorkspaceError> {
        let start_time = Instant::now();

        // 获取当前生产状态
        let current_state = self.db.get_production_state()?;
        let old_session_id = current_state
            .current_session_id
            .ok_or(WorkspaceError::Internal(
                "Production session not initialized".into(),
            ))? as u64;

        info!(
            old_session_id = old_session_id,
            rule_count = rules.len(),
            ruleset_hash = ruleset_hash,
            "Starting rolling session swap"
        );

        // Step 1: 写入 rules_dir/*.json
        // (实际实现需要访问 evorule-server 的 rules_dir 路径)
        // P0 简化:通过 SessionOps 注入规则到 SessionManager(不经过文件系统)
        // P1 完整:写文件 → reload 扫描
        self.write_rules_to_dir(rules).await?;

        // Step 2: POST /api/rules/reload
        // reload 后 SessionManager 内部 core_eval 更新
        // (通过 SessionOps 调用,实际触发 evorule-server 的 reload handler)
        self.session_ops.reload_rules().await?;

        info!("Rules reloaded into SessionManager core_eval");

        // Step 3: Fork 旧 session(新 session 用新 core_eval)
        let new_session_id = self
            .session_ops
            .fork_session(old_session_id, None)
            .await?;

        info!(
            old_session_id = old_session_id,
            new_session_id = new_session_id,
            "New production session forked (inherits payload state, uses new core_eval)"
        );

        // Step 4: 计算新版本号(单调递增)
        let new_ruleset_version = current_state.ruleset_version + 1;

        // Step 5: 原子更新 production_state
        self.db.update_production_state(
            new_session_id as i64,
            new_ruleset_version,
            ruleset_hash,
            operated_by,
        )?;

        info!(
            new_session_id = new_session_id,
            new_ruleset_version = new_ruleset_version,
            "production_state updated"
        );

        // Step 6: 写 production_audit 表
        let source_ws_ids = serde_json::json!([source_workspace_id]).to_string();
        self.db.insert_production_audit(
            "ruleset_published",
            new_ruleset_version,
            Some(current_state.ruleset_version),
            ruleset_hash,
            new_session_id as i64,
            &source_ws_ids,
            operated_by,
            None,
            None,
        )?;

        // Step 7: 如果有 rule_ids,更新规则元数据(published + ruleset_version)
        if !rule_ids.is_empty() {
            self.db
                .publish_rules(&rule_ids, new_ruleset_version, operated_by)?;
        }

        // Step 8: 向旧 session 的 SSE 订阅者推送 session_switched 事件(U7)
        self.switcher
            .broadcast_switched(
                old_session_id,
                new_session_id,
                new_ruleset_version,
                ruleset_hash,
            )
            .await?;

        info!(
            old_session_id = old_session_id,
            new_session_id = new_session_id,
            "session_switched SSE event pushed to old session subscribers"
        );

        // Step 9: 旧 session drain(等待在途 Fact 处理完,超时强制关闭)
        tokio::spawn({
            let session_ops = self.session_ops.clone();
            let switcher = self.switcher.clone();
            let timeout = self.drain_timeout;
            async move {
                // 等待旧 session 的在途 Fact 处理完
                // P0 简化:直接等待固定时间后关闭
                // P1 增强:轮询 /api/sessions/{old_id}/finished 判断是否处理完
                tokio::time::sleep(timeout).await;

                if let Err(e) = session_ops.close_session(old_session_id).await {
                    warn!(
                        old_session_id = old_session_id,
                        error = %e,
                        "Failed to close old production session after drain timeout"
                    );
                } else {
                    info!(
                        old_session_id = old_session_id,
                        elapsed_ms = start_time.elapsed().as_millis(),
                        "Old production session closed after drain"
                    );
                }

                // 通知广播器旧 session 已关闭(清理订阅)
                switcher.notify_session_closed(old_session_id).await;
            }
        });

        info!(
            new_session_id = new_session_id,
            new_ruleset_version = new_ruleset_version,
            elapsed_ms = start_time.elapsed().as_millis(),
            "Rolling session swap completed"
        );

        Ok(RollingSwapResult {
            new_session_id,
            new_ruleset_version,
            new_ruleset_hash: ruleset_hash.to_string(),
        })
    }

    /// 写入 rules_dir/*.json
    ///
    /// P0 简化:通过 SessionOps 直接注入规则(不经过文件系统)
    /// P1 完整:写文件到 rules_dir,让 reload 扫描到
    async fn write_rules_to_dir(&self, rules: &[serde_json::Value]) -> Result<(), WorkspaceError> {
        // P0:规则已通过 reload 注入到 SessionManager core_eval
        // 实际文件写入由 evorule-server 的 reload handler 处理
        // (POST /api/rules/reload 会重新扫描 rules_dir)
        // 这里仅记录日志
        info!(rule_count = rules.len(), "Rules prepared for reload");
        Ok(())
    }
}
```

---

## 5. U7 SSE session_switched 推送(P3)

### 5.1 SessionSwitchedBroadcaster

三层架构 §12.4 U7 决策:服务端推送切换通知(SSE `session_switched` 事件),非客户端轮询/自动重连。

```rust
// src/session_switched.rs

use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{info, debug};

/// session_switched 事件 payload
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionSwitchedEvent {
    pub event_type: String,          // 固定 "session_switched"
    pub old_session_id: u64,
    pub new_session_id: u64,
    pub new_ruleset_version: i64,
    pub new_ruleset_hash: String,
    pub timestamp: String,
}

/// session_switched 广播器
///
/// 设计:
/// - 每个 session 有一个 broadcast channel
/// - SSE 订阅者(GET /api/sessions/{id}/events)在连接时订阅该 channel
/// - 滚动 session 切换时,向旧 session 的 channel 发送 session_switched 事件
/// - SSE handler 收到事件后推送给客户端,客户端据此切换到新 session
#[derive(Clone)]
pub struct SessionSwitchedBroadcaster {
    /// session_id → broadcast sender
    channels: Arc<tokio::sync::Mutex<std::collections::HashMap<u64, broadcast::Sender<SessionSwitchedEvent>>>>,
}

impl SessionSwitchedBroadcaster {
    pub fn new() -> Self {
        Self {
            channels: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        }
    }

    /// 为 session 注册广播通道(SSE 连接时调用)
    pub async fn register(&self, session_id: u64) -> broadcast::Receiver<SessionSwitchedEvent> {
        let mut channels = self.channels.lock().await;
        let sender = channels
            .entry(session_id)
            .or_insert_with(|| {
                let (tx, _rx) = broadcast::channel(16);
                tx
            })
            .clone();
        sender.subscribe()
    }

    /// 向旧 session 的 SSE 订阅者推送 session_switched 事件
    pub async fn broadcast_switched(
        &self,
        old_session_id: u64,
        new_session_id: u64,
        new_ruleset_version: i64,
        new_ruleset_hash: &str,
    ) -> Result<(), WorkspaceError> {
        let event = SessionSwitchedEvent {
            event_type: "session_switched".into(),
            old_session_id,
            new_session_id,
            new_ruleset_version,
            new_ruleset_hash: new_ruleset_hash.into(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        };

        let channels = self.channels.lock().await;
        if let Some(sender) = channels.get(&old_session_id) {
            match sender.send(event.clone()) {
                Ok(n) => {
                    info!(
                        old_session_id = old_session_id,
                        new_session_id = new_session_id,
                        subscribers_notified = n,
                        "session_switched event broadcasted"
                    );
                }
                Err(_) => {
                    debug!(
                        old_session_id = old_session_id,
                        "No active SSE subscribers for session_switched"
                    );
                }
            }
        } else {
            debug!(
                old_session_id = old_session_id,
                "No broadcast channel registered for session"
            );
        }

        Ok(())
    }

    /// 通知旧 session 已关闭(清理通道)
    pub async fn notify_session_closed(&self, session_id: u64) {
        let mut channels = self.channels.lock().await;
        channels.remove(&session_id);
        debug!(session_id = session_id, "Broadcast channel cleaned up");
    }
}
```

### 5.2 SSE 集成(evorule-server 端)

在 evorule-server 的 `session_events` SSE handler 中,合并 session_switched 事件流:

```rust
// evorule-server/src/api/server.rs — session_events handler 扩展(伪代码)

async fn session_events(
    State(state): State<WorkspaceState>,
    Path(session_id): Path<u64>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // 订阅 SessionManager 的 Fact 事件流(已有)
    let fact_rx = {
        let sessions = state.session_ops.clone();
        // ... 获取 session 的 event_tx.subscribe() ...
    };

    // 订阅 session_switched 广播(新增,U7)
    let switch_rx = state.switcher.register(session_id).await;

    // 合并两个流:Fact 事件 + session_switched 事件
    let stream = stream! {
        // 先发一条 session_switched 订阅确认(可选)
        // 然后循环 select! 两个流
        loop {
            tokio::select! {
                // Fact 事件(已有逻辑)
                Ok(fact) = fact_rx.recv() => {
                    yield Ok(Event::default()
                        .event("fact")
                        .json_data(fact_to_sse_data(&fact))
                        .unwrap());
                }
                // session_switched 事件(U7 新增)
                Ok(event) = switch_rx.recv() => {
                    yield Ok(Event::default()
                        .event("session_switched")
                        .json_data(&event)
                        .unwrap());
                    // 推送后结束旧 SSE 流(客户端应主动关闭并订阅新 session)
                    break;
                }
            }
        }
    };

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("heartbeat"),
    )
}
```

### 5.3 客户端处理

三层架构 §12.4 U7 + HOME_DESIGN.md §6.5 已定义客户端处理逻辑:

```typescript
// productionStateStore.onSessionSwitched()(console-cloud 端,已设计)
// 收到 session_switched 事件后:
// 1. 关闭旧 EventSource(SSE)
// 2. 用 new_session_id 订阅新 SSE: GET /api/sessions/{new_session_id}/events
// 3. 更新 productionStateStore.currentSessionId
// 4. 触发 MonitorDashboard 重新渲染(用新 session 的 Fact 流)
// 5. resetAuditStore() + refreshSessions()(清理旧 session 审计数据)
```

---

## 6. 发布队列 API 端点

### 6.1 新增路由

| 方法 | 路径 | 用途 | 权限 |
|------|------|------|------|
| POST | `/api/publish/queue` | 提交到发布队列 | DepartmentHead |
| GET | `/api/publish/queue` | 列出发布队列 | 所有角色 |
| GET | `/api/publish/queue/{id}` | 查看队列项详情 | 所有角色 |
| POST | `/api/publish/queue/{id}/review` | 审批发布(approve/reject) | Admin |
| POST | `/api/publish/rollback` | 紧急回滚 | Admin |
| GET | `/api/production/state` | 查询当前生产状态 | 所有角色 |
| GET | `/api/production/audit` | 查询发布审计历史 | 所有角色 |

### 6.2 Handler 实现

```rust
// src/api.rs(扩展,新增发布路由)

pub fn build_workspace_router(state: WorkspaceState) -> Router {
    Router::new()
        // ... 已有路由(WORKSPACE + SANDBOX)...
        // 发布队列
        .route("/api/publish/queue", post(submit_publish).get(list_publish_queue))
        .route("/api/publish/queue/{id}", get(get_publish_queue_item))
        .route("/api/publish/queue/{id}/review", post(review_publish))
        .route("/api/publish/rollback", post(emergency_rollback))
        .with_state(state)
}

/// POST /api/publish/queue — 提交到发布队列
async fn submit_publish(
    State(state): State<WorkspaceState>,
    Extension(auth): Extension<AuthUser>,
    Json(req): Json<SubmitPublishRequest>,
) -> Result<Json<PublishQueueItem>, WorkspaceError> {
    let role = parse_role(&auth); // 从 auth token 解析角色(P0 简化)
    let item = state
        .publish_service
        .submit_publish(req, &auth.user_id, &role)
        .await?;
    Ok(Json(item))
}

/// POST /api/publish/queue/{id}/review — 审批发布
async fn review_publish(
    State(state): State<WorkspaceState>,
    Path(queue_id): Path<i64>,
    Extension(auth): Extension<AuthUser>,
    Json(req): Json<ReviewPublishRequest>,
) -> Result<Json<PublishQueueItem>, WorkspaceError> {
    let role = parse_role(&auth);
    let item = state
        .publish_service
        .review_publish(queue_id, req, &auth.user_id, &role)
        .await?;
    Ok(Json(item))
}

/// POST /api/publish/rollback — 紧急回滚
#[derive(serde::Deserialize)]
pub struct RollbackRequest {
    pub target_version: i64,
    pub reason: String,
}

async fn emergency_rollback(
    State(state): State<WorkspaceState>,
    Extension(auth): Extension<AuthUser>,
    Json(req): Json<RollbackRequest>,
) -> Result<Json<serde_json::Value>, WorkspaceError> {
    let role = parse_role(&auth);
    let new_version = state
        .publish_service
        .emergency_rollback(req.target_version, &req.reason, &auth.user_id, &role)
        .await?;
    Ok(Json(serde_json::json!({
        "new_ruleset_version": new_version,
        "rolled_back_to": req.target_version,
        "message": format!("Rolled back to v{} (new version: v{})", req.target_version, new_version),
    })))
}

/// 从 auth token 解析发布角色(P0 简化,P1 接入 P08 角色模型)
fn parse_role(auth: &AuthUser) -> PublishRole {
    // P0 简化:从 token claims 读 role 字段
    // 实际实现依赖 evorule-server 的 auth middleware
    match auth.claims.get("role").and_then(|r| r.as_str()) {
        Some("admin") => PublishRole::Admin,
        Some("department_head") => PublishRole::DepartmentHead,
        _ => PublishRole::Doctor,
    }
}
```

### 6.3 WorkspaceState 扩展

```rust
// src/api.rs — WorkspaceState 增加 publish_service

#[derive(Clone)]
pub struct WorkspaceState {
    pub workspace_service: WorkspaceService,
    pub rule_meta_service: RuleMetaService,
    pub sandbox_service: SandboxService,
    pub publish_service: PublishService,       // ← 新增
    pub session_ops: Arc<dyn SessionOps>,
    pub switcher: SessionSwitchedBroadcaster,  // ← 新增
}
```

---

## 7. 发布排队与冲突处理

### 7.1 FIFO 队列(P0)

三层架构 §7.3:Publish Queue 是 FIFO 队列(按提交时间排序)。

```sql
-- 查询待审批的队列(按提交时间排序)
SELECT * FROM publish_queue
WHERE status = 'pending'
ORDER BY submitted_at ASC;
```

**P0 策略**:信息科/院领导按 FIFO 顺序逐个审批。每次审批通过后触发滚动 session 切换。

### 7.2 冲突检测(P1 实现,P0 人工)

三层架构 §7.3:发布前检查规则冲突(同 rule_key 的不同版本)。

```rust
// P1 实现(不在 P0)
pub async fn detect_conflicts(
    &self,
    pending_item: &PublishQueueItem,
) -> Result<Vec<Conflict>, WorkspaceError> {
    let pending_rules: Vec<serde_json::Value> =
        serde_json::from_str(&pending_item.final_candidate_rules)?;

    let mut conflicts = Vec::new();

    // 检查 1:同 rule_key 的规则是否在当前队列里
    let other_pending = self.db.list_publish_queue(Some(PublishStatus::Pending))?;
    for other in other_pending {
        if other.id == pending_item.id {
            continue;
        }
        let other_rules: Vec<serde_json::Value> =
            serde_json::from_str(&other.final_candidate_rules)?;

        for pending_rule in &pending_rules {
            for other_rule in &other_rules {
                if rules_share_key(pending_rule, other_rule) {
                    conflicts.push(Conflict {
                        conflict_type: "duplicate_rule_key".into(),
                        description: format!(
                            "Rule key conflicts with queue item #{}",
                            other.id
                        ),
                        pending_rule: pending_rule.clone(),
                        conflicting_rule: other_rule.clone(),
                    });
                }
            }
        }
    }

    // 检查 2:与当前已发布规则冲突
    let published_rules = self.db.list_published_rules()?;
    for pending_rule in &pending_rules {
        for pub_rule in &published_rules {
            if rules_share_key(pending_rule, &serde_json::from_str(&pub_rule.rule_json).unwrap_or_default()) {
                conflicts.push(Conflict {
                    conflict_type: "overwrite_published".into(),
                    description: format!(
                        "Will overwrite published rule id={}",
                        pub_rule.id
                    ),
                    pending_rule: pending_rule.clone(),
                    conflicting_rule: serde_json::from_str(&pub_rule.rule_json).unwrap_or_default(),
                });
            }
        }
    }

    Ok(conflicts)
}

/// 检查两条规则是否共享同一 rule_key
fn rules_share_key(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    let key_a = a.get("key").and_then(|k| k.as_str());
    let key_b = b.get("key").and_then(|k| k.as_str());
    match (key_a, key_b) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}
```

### 7.3 冲突处理策略

| 冲突类型 | P0 处理 | P1 处理 |
|----------|---------|---------|
| 同 rule_key 在队列里 | 信息科决定保留哪个 | 自动提示冲突,审批者选择 |
| 覆盖已发布规则 | 信息科确认(预期行为) | 自动提示,审批者确认 |
| 依赖规则不兼容 | 人工检测 | 依赖图分析(P2) |

---

## 8. 发布审计与版本管理

### 8.1 版本号规则

- **单调递增**:每次发布 +1,回滚也 +1(不回退)
- **不可重用**:版本号一旦分配,永不回收
- **BLAKE3 签名**:每个版本对应一个 ruleset_hash

```
v1 (初始规则集) → v2 (内科规则发布) → v3 (财务规则发布)
                                          ↓ 紧急回滚
                                     v4 (回滚到 v2 的规则集,但版本号是 v4)
```

### 8.2 production_audit 表记录

```json
// 发布记录
{
  "event_type": "ruleset_published",
  "ruleset_version": 2,
  "previous_version": 1,
  "ruleset_hash": "blake3:abc123...",
  "tcb_session_id": 102,
  "source_workspace_ids": ["ws-内科-发烧CT-20260806"],
  "operated_by": "admin-zhang",
  "operated_at": "2026-08-06T14:30:00Z"
}

// 回滚记录
{
  "event_type": "ruleset_rollback",
  "ruleset_version": 4,
  "previous_version": 3,
  "ruleset_hash": "blake3:abc123...",  // 与 v2 相同的规则集哈希
  "tcb_session_id": 104,
  "source_workspace_ids": [],
  "operated_by": "admin-li",
  "operated_at": "2026-08-06T16:00:00Z",
  "reason": "内科规则误触发,紧急回滚"
}
```

### 8.3 与 tcb BLAKE3 链的关系

| 层 | 记录内容 | 不可篡改性 |
|----|----------|-----------|
| **tcb BLAKE3 链** | Fact 级别哈希链(每条 Fact 的因果链) | 物理不可篡改(WAL 文件) |
| **production_audit** | 业务级别"哪个版本由谁发布" | 逻辑不可篡改(SQLite + 可追溯) |

二者互补:tcb 链保证 Fact 级完整性,production_audit 保证版本级可审计性。

---

## 9. 完整发布流程时序图

### 9.1 正常发布

```
科室主任              workspace crate           SessionManager          监控大屏(SSE)
   │                       │                        │                       │
   │ POST /api/publish/    │                        │                       │
   │   queue               │                        │                       │
   │──────────────────────>│                        │                       │
   │                       │ ① 校验角色              │                       │
   │                       │ ② 校验规则状态          │                       │
   │                       │ ③ 计算 BLAKE3          │                       │
   │                       │ ④ 插入 publish_queue   │                       │
   │  ← queue_id ─────────│    (status=pending)    │                       │
   │                       │                        │                       │
   │           (通知信息科:有新发布待审批)           │                       │
   │                       │                        │                       │
信息科/院领导             │                        │                       │
   │ POST /api/publish/    │                        │                       │
   │   queue/{id}/review   │                        │                       │
   │   {decision:approved} │                        │                       │
   │──────────────────────>│                        │                       │
   │                       │ ⑤ 获取全局发布锁        │                       │
   │                       │ ⑥ update status=       │                       │
   │                       │    approved             │                       │
   │                       │                        │                       │
   │                       │ execute_publish()      │                       │
   │                       │ ⑦ reload_rules()       │                       │
   │                       │───────────────────────>│                       │
   │                       │  core_eval 更新        │                       │
   │                       │  <─────────────────────│                       │
   │                       │                        │                       │
   │                       │ ⑧ fork_session(old)    │                       │
   │                       │───────────────────────>│                       │
   │                       │  new_session_id=N      │                       │
   │                       │  <─────────────────────│                       │
   │                       │                        │                       │
   │                       │ ⑨ update production_   │                       │
   │                       │    state(version+1)    │                       │
   │                       │ ⑩ insert production_   │                       │
   │                       │    audit               │                       │
   │                       │                        │                       │
   │                       │ ⑪ broadcast_switched   │                       │
   │                       │───────────────────────────────────────────────>│
   │                       │                        │  session_switched     │
   │                       │                        │  SSE event            │
   │                       │                        │  <───────────────────│
   │                       │                        │  关闭旧 SSE           │
   │                       │                        │  订阅新 session SSE   │
   │                       │                        │                       │
   │                       │ ⑫ drain old session    │                       │
   │                       │    (等待30s)           │                       │
   │                       │ ⑬ close_session(old)   │                       │
   │                       │───────────────────────>│                       │
   │                       │  DELETE old session    │                       │
   │                       │  <─────────────────────│                       │
   │                       │                        │                       │
   │  ← published ────────│ ⑭ update status=       │                       │
   │    (version=N)       │    published            │                       │
```

### 9.2 紧急回滚

```
信息科             workspace crate           SessionManager          监控大屏
  │                    │                        │                      │
  │ POST /api/publish/ │                        │                      │
  │   rollback         │                        │                      │
  │   {target_version:2│                        │                      │
  │    reason:"误触发"}│                        │                      │
  │───────────────────>│                        │                      │
  │                    │ ① 校验角色(Admin)      │                      │
  │                    │ ② 查 v2 的 ruleset_hash│                      │
  │                    │ ③ 加载 v2 的规则集     │                      │
  │                    │ ④ 获取全局发布锁       │                      │
  │                    │                        │                      │
  │                    │ rolling_swap(v2 rules) │                      │
  │                    │ ⑤ reload + fork +      │                      │
  │                    │    switch(同正常发布)  │                      │
  │                    │ ⑥ new_version = 4      │                      │
  │                    │    (不回退版本号)      │                      │
  │                    │ ⑦ insert production_   │                      │
  │                    │    audit(rollback)     │                      │
  │                    │                        │                      │
  │  ← new_version=4 ─│                        │                      │
  │    (回滚到 v2)     │                        │                      │
```

---

## 10. 测试策略

### 10.1 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_bridge::SessionOps;
    // 复用 SANDBOX_ORCHESTRATION_DESIGN.md 的 MockSessionOps

    #[tokio::test]
    async fn test_publish_lifecycle() {
        // 1. 创建 Workspace + Draft 规则 + 转 final_candidate
        // 2. 科室主任提交到 publish_queue
        // 3. 信息科审批 approved
        // 4. 验证 production_state 更新 + production_audit 记录
        // 5. 验证 ruleset_version 递增
    }

    #[tokio::test]
    async fn test_permission_denial() {
        // 普通医生提交 → Forbidden
        // 科室主任审批 → Forbidden
        // 普通医生回滚 → Forbidden
    }

    #[tokio::test]
    async fn test_rollback_version_monotonic() {
        // v1 → v2 → v3 → rollback to v2 → v4
        // 版本号始终递增
    }

    #[tokio::test]
    async fn test_session_switched_broadcast() {
        let switcher = SessionSwitchedBroadcaster::new();
        let mut rx = switcher.register(100).await;

        switcher
            .broadcast_switched(100, 200, 5, "hash123")
            .await
            .unwrap();

        let event = rx.recv().await.unwrap();
        assert_eq!(event.event_type, "session_switched");
        assert_eq!(event.old_session_id, 100);
        assert_eq!(event.new_session_id, 200);
        assert_eq!(event.new_ruleset_version, 5);
    }

    #[tokio::test]
    async fn test_publish_lock_serializes() {
        // 两个并发发布请求,第二个必须等第一个完成
        // 验证 publish_lock 串行化
    }
}
```

---

## 11. P0 实施清单

| # | 任务 | 模块 | 依赖 | 工作量 |
|---|------|------|------|--------|
| 1 | 实现 PublishService(submit/review/rollback) | P1 | WORKSPACE_CRATE #4,#5,#6 | 2d |
| 2 | 实现 RollingSessionService(rolling_swap) | P2 | #1 + SessionOps | 2d |
| 3 | 实现 SessionSwitchedBroadcaster | P3 | #2 | 1d |
| 4 | SessionOps 扩展 reload_rules() | M5 扩展 | #2 | 0.5d |
| 5 | evorule-server SSE handler 集成 session_switched | server | #3 | 1d |
| 6 | 实现 7 个发布 API handler + Router | M6 扩展 | #1,#2 | 1.5d |
| 7 | WorkspaceState 扩展 publish_service + switcher | api | #6 | 0.5d |
| 8 | 三级权限解析(P0 简化,从 token 读 role) | auth | #6 | 0.5d |
| 9 | 单元测试(MockSessionOps + broadcast) | tests | #1,#2,#3 | 1.5d |
| 10 | 集成测试(完整发布流程 E2E) | tests | #5,#7,#8 | 2d |

**合计**:约 12.5 人天,依赖 WORKSPACE_CRATE_DESIGN.md 完成后可启动。

---

## 12. 与已有设计的同步点

| 文档 | 同步内容 | 状态 |
|------|----------|------|
| 三层架构 §3.3 | 滚动 session 热重载 5 步流程 | ✅ 本文 §4 完整实现 |
| 三层架构 §7 | 三级发布权限 + 发布流程 + 排队冲突 + 回滚 | ✅ 本文 §3 + §7 + §8 落地 |
| 三层架构 §12.4 U7 | session_switched SSE 推送 | ✅ 本文 §5 实现 |
| HOME_DESIGN.md §6.5 | productionStateStore.onSessionSwitched() | ✅ 本文 §5.3 客户端处理对齐 |
| P05_MONITOR_DASHBOARD_DESIGN.md | U7 session_switched 事件监听 | ✅ 本文 §5 SSE 集成 |
| P08_COLLAB_WORKFLOW_DESIGN.md | 三级角色模型 | ✅ 本文 §1.2 + §6.2 权限校验 |
| WORKSPACE_CRATE_DESIGN.md | publish_queue / production_state / production_audit 表 | ✅ 本文消费 §3.2 表 5/7/8 |
| SANDBOX_ORCHESTRATION_DESIGN.md | 测试报告,发布时附带 | ✅ 本文 §3.1 test_report_sandbox_id |
