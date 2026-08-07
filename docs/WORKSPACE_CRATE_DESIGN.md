<!--
  设计文档 — workspace crate 实施级设计
  位置: D:\evorule-console-cloud\docs\WORKSPACE_CRATE_DESIGN.md
  写于: 2026-08-06
  来源: 三层架构 §6 数据模型 + §12.4 U6 决策 + evorule-server 架构实测
  关联:
    - evorule-three-layer-architecture.md §4(Workspace 层) §6(数据模型) §12.4(U6 决策)
    - P01_BUILD_SCHEMA_DESIGN.md §4(应用层数据模型)
    - P08_COLLAB_WORKFLOW_DESIGN.md(协作工作流,消费 workspace 成员/角色)
    - SANDBOX_ORCHESTRATION_DESIGN.md(依赖本文档的 sandbox_sessions 表)
    - PUBLISH_QUEUE_DESIGN.md(依赖本文档的 publish_queue / production_state 表)
  状态: 2026-08-06 定稿,第四梯队第 1 份
  实测依据: evorule-server Cargo.toml + api/server.rs(SessionApi/AppState/路由表) + core/hot_reload(独立 crate 先例)
-->

# workspace crate 实施级设计

> **状态**: 设计文档,2026-08-06 定稿。本文档是三层架构 §6 数据模型 + §12.4 U6 决策的可实施落地,目标仓库 `evorule-server`。

## 0. 摘要

**目标**:在 evorule-server workspace 中新建独立 `core/workspace` crate,实现三层架构 Layer 2(Workspaces)+ Layer 1(Production Runtime 状态)的应用层编排。

**U6 决策落地**:参照 `core/hot_reload` 独立 crate 模式,workspace crate 负责 Workspace 状态持久化 + CRUD API + 与 SessionManager 集成,不污染 evorule-server 主 crate 路由。

**关键决策**:

| # | 决策 | 选项 |
|---|------|------|
| D1 | 持久化引擎 | **SQLite(rusqlite)** — evorule-server 当前无应用层 DB,workspace crate 首次引入 |
| D2 | crate 位置 | `core/workspace/`(与 `core/hot_reload` 同级) |
| D3 | 与 SessionManager 集成方式 | **trait 抽象** — workspace crate 不直接依赖 evorule_governance,通过 trait 注入 session 操作 |
| D4 | 表归属 | 7 张应用层表全部在 workspace crate 管理(rules 元数据扩展 + 6 张编排表) |
| D5 | API 挂载方式 | workspace crate 提供 `Router`,由 evorule-server `build_router()` 合并 |

**不做什么**(边界收敛):

- ❌ 不管理 tcb 层的 Fact/Rule/Event(物理隔离,SessionManager 已处理)
- ❌ 不实现沙盒编排逻辑(见 SANDBOX_ORCHESTRATION_DESIGN.md,仅提供 sandbox_sessions 表)
- ❌ 不实现发布队列编排逻辑(见 PUBLISH_QUEUE_DESIGN.md,仅提供 publish_queue / production_state 表)
- ❌ 不实现权限认证(复用 evorule-server 的 auth middleware)
- ❌ 不实现 SSE 事件流(复用 evorule-server 的 `/api/sessions/{id}/events`)

---

## 1. 背景与定位

### 1.1 为什么需要独立 crate

三层架构 §12.4 U6 决策已拍板:Workspace 状态管理放独立 `workspace` crate,理由:

1. **职责单一**:Workspace 编排(workspace_id / status / ruleset_version / 成员关系)是应用层逻辑,不属于 evorule-tcb(机制层,不可变语义),也不应塞进 evorule-server 主 crate(避免膨胀)
2. **参照先例**:`core/hot_reload` 已是独立 crate(文件监听 + 规则加载),`workspace` crate 同构处理
3. **演进空间**:P1+ 扩展协作工作流(评审/批准/归档)不污染 server 主路由
4. **分层一致**:机制(tcb)↔ 编排(workspace crate)↔ 展示(console-cloud)三层解耦

### 1.2 与现有 crate 的关系

```
evorule-server workspace
├── core/
│   ├── auth/              ← 认证(已有)
│   ├── debug_control/     ← 调试控制(已有)
│   ├── hot_reload/        ← 规则热重载(已有,先例)
│   ├── io_handlers/       ← I/O handler(已有)
│   ├── metrics/           ← Prometheus 指标(已有)
│   ├── rule_tools/        ← 规则工具(已有)
│   ├── semantic_invariants/ ← 语义不变量(已有)
│   ├── time_machine/      ← 时间机器(已有)
│   └── workspace/         ← 【新增】Workspace 编排(本设计)
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── db.rs          ← SQLite 连接 + 迁移
│           ├── models.rs      ← 数据模型(7 张表对应 struct)
│           ├── workspace_service.rs  ← Workspace CRUD
│           ├── rule_meta_service.rs  ← 规则元数据 CRUD
│           ├── session_bridge.rs      ← SessionManager trait 抽象
│           ├── api.rs          ← HTTP 路由 handler
│           └── error.rs        ← 错误类型
└── evorule-server/        ← 主 crate(合并 workspace router)
    └── src/api/server.rs  ← build_router() 合并 workspace routes
```

### 1.3 依赖方向(无环)

```
evorule-tcb(机制层,无依赖)
    ↑
evorule-governance(机制层,依赖 tcb)
    ↑
evorule-server(应用层主 crate,依赖 governance)
    ↑
core/workspace(应用层编排,依赖 server 的 trait 注入,不反向依赖)
```

**关键**:workspace crate 通过 trait 抽象与 SessionManager 解耦,不直接 `use evorule_governance::session`,而是由 evorule-server 主 crate 注入 `SessionOps` trait 实现。这样 workspace crate 可独立编译测试。

---

## 2. 模块结构(7 模块)

### 2.1 模块总览

| # | 模块 | 职责 | 对外公开 |
|---|------|------|----------|
| M1 | `db` | SQLite 连接池 + schema 迁移 + 7 张表 DDL | `WorkspaceDb` |
| M2 | `models` | 7 张表对应的数据结构(serde 序列化) | `Workspace` / `WorkspaceMember` / `RuleMeta` / `SandboxSession` / `ProductionAudit` / `TestDataset` / `PublishQueueItem` / `ProductionState` |
| M3 | `workspace_service` | Workspace CRUD + 成员管理 + 归档 | `WorkspaceService` |
| M4 | `rule_meta_service` | 规则元数据 CRUD + status 状态机 + workspace_id 隔离查询 | `RuleMetaService` |
| M5 | `session_bridge` | SessionManager trait 抽象(create/fork/close/list) | `SessionOps` trait |
| M6 | `api` | HTTP 路由 handler + Router 构建 | `build_workspace_router()` |
| M7 | `error` | 统一错误类型 + HTTP 状态码映射 | `WorkspaceError` |

### 2.2 模块间依赖

```
api.rs
  ├── workspace_service.rs → models.rs, db.rs
  ├── rule_meta_service.rs → models.rs, db.rs
  └── session_bridge.rs(trait,由 server 注入实现)

db.rs → models.rs(仅类型)
error.rs ← 所有模块引用
```

---

## 3. 数据模型与 DDL(M1 + M2)

### 3.1 持久化决策(D1)

**选择 SQLite(rusqlite)**,理由:

1. **evorule-server 当前无应用层 DB** — 持久化靠 WAL 文件(reactor 状态)+ 文件系统(rules_dir)。应用层表需要结构化查询(workspace_id 过滤 / status 状态机 / publish_queue 排序),SQLite 是最轻量选择
2. **单机部署友好** — 中小企业 PoC 场景无需额外数据库服务,SQLite 零运维
3. **与 WAL 文件互补** — WAL 管 reactor 事实链(不可变),SQLite 管应用层元状态(可变),职责不冲突
4. **P2 可迁移** — 通过 `WorkspaceDb` trait 抽象,P2 可换 PostgreSQL(大企业场景)

**数据库文件路径**:复用 evorule-server 的 `--db-path` 配置(当前指向 `./data/evorule.db`,但实际未被 SQLite 使用)。workspace crate 接管此路径,创建 SQLite 文件。

### 3.2 完整 DDL(7 张表)

```sql
-- ============================================================
-- M1: SQLite schema 迁移(版本 1,2026-08-06)
-- ============================================================

-- 表 1: rules(规则元数据扩展,应用层)
-- 注意:rule_json 本身是 evorule JSON 规则体;tcb 层无此表,规则在 tcb 是 Vec<JsonValue>
CREATE TABLE IF NOT EXISTS rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id    TEXT,           -- NULL = 全局已发布 Final;非 NULL = Workspace 内 Draft/Final候选
    rule_key        TEXT NOT NULL,  -- 规则业务标识,如 "fever.ct_required"
    rule_json       TEXT NOT NULL,  -- evorule JSON 规则体(发布时写入 rules_dir/*.json)
    status          TEXT NOT NULL DEFAULT 'draft',  -- draft/reviewing/final_candidate/published/archived
    version         INTEGER NOT NULL DEFAULT 1,     -- 规则自身版本(Workspace 内递增)
    ruleset_version INTEGER,        -- 仅 published 状态:发布到 Production 时的版本号
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at     TEXT
);

-- 索引:按 workspace_id 过滤(核心查询路径)
CREATE INDEX IF NOT EXISTS idx_rules_workspace ON rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_rules_status ON rules(status);
CREATE INDEX IF NOT EXISTS idx_rules_key_workspace ON rules(rule_key, workspace_id);

-- 表 2: workspaces(工作空间)
CREATE TABLE IF NOT EXISTS workspaces (
    id              TEXT PRIMARY KEY,   -- 如 "ws-内科-发烧CT-20260806"(语义化 ID)
    name            TEXT NOT NULL,      -- "内科-发烧CT规则修订-20260806"
    description     TEXT,
    team            TEXT,               -- 所属团队/科室
    status          TEXT NOT NULL DEFAULT 'active',  -- active/archived
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at     TEXT
);

-- 表 3: workspace_members(工作空间成员)
CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id    TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'author',  -- author/reviewer/observer
    added_at        TEXT NOT NULL DEFAULT (datetime('now')),
    added_by        TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);

-- 表 4: sandbox_sessions(沙盒会话编排表,映射到 SessionManager 的 session_id)
-- 注意:test Fact 存在 SessionManager 的独立 FactsLog 中,不需要应用层另建 sandbox_facts 表
CREATE TABLE IF NOT EXISTS sandbox_sessions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    tcb_session_id      INTEGER,            -- SessionManager 返回的 session_id(如 2)
    workspace_id        TEXT NOT NULL,
    parent_session_id   INTEGER,            -- Production 的 tcb_session_id,用于因果追溯
    draft_ruleset_hash  TEXT,               -- 本次测试的 Draft 规则集 BLAKE3 哈希
    test_dataset_id     INTEGER,            -- 合成数据集 ID
    status              TEXT NOT NULL DEFAULT 'running',  -- running/closed
    started_by          TEXT NOT NULL,
    started_at          TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at           TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
    FOREIGN KEY (test_dataset_id) REFERENCES test_datasets(id)
);

CREATE INDEX IF NOT EXISTS idx_sandbox_workspace ON sandbox_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_status ON sandbox_sessions(status);

-- 表 5: production_audit(Production 审计表,应用层维护的发布/回滚审计)
-- 与 tcb 的 BLAKE3 链互补:tcb 记 Fact 级哈希链,此表记业务级"哪个版本由谁发布"
CREATE TABLE IF NOT EXISTS production_audit (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type              TEXT NOT NULL,   -- ruleset_published / ruleset_rollback
    ruleset_version         INTEGER NOT NULL,-- 本次生效的版本号(单调递增)
    previous_version        INTEGER,
    ruleset_hash            TEXT NOT NULL,   -- BLAKE3
    tcb_session_id          INTEGER,         -- 对应的 production session_id
    source_workspace_ids    TEXT,            -- JSON 数组,发布来源
    operated_by             TEXT NOT NULL,
    operated_at             TEXT NOT NULL DEFAULT (datetime('now')),
    reason                  TEXT,            -- 回滚原因,可选
    test_report_ids         TEXT             -- JSON 数组,附带测试报告
);

CREATE INDEX IF NOT EXISTS idx_audit_version ON production_audit(ruleset_version);

-- 表 6: test_datasets(合成数据集表)
CREATE TABLE IF NOT EXISTS test_datasets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,          -- "fever-cases-v2"
    description     TEXT,
    scope           TEXT NOT NULL,          -- workspace_id 或 "shared"
    cases_json      TEXT NOT NULL,          -- 合成 case 数组(JSON)
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_datasets_scope ON test_datasets(scope);

-- 表 7: publish_queue(发布队列)
CREATE TABLE IF NOT EXISTS publish_queue (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id                TEXT NOT NULL,
    final_candidate_rules       TEXT NOT NULL,   -- JSON 数组,待发布的规则集
    ruleset_hash                TEXT NOT NULL,   -- BLAKE3
    test_report_id              INTEGER,
    status                      TEXT NOT NULL DEFAULT 'pending',  -- pending/approved/rejected/published
    submitted_by                TEXT NOT NULL,
    submitted_at                TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_by                 TEXT,
    reviewed_at                 TEXT,
    review_comment              TEXT,
    published_ruleset_version   INTEGER,        -- 发布后填
    published_at                TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
    FOREIGN KEY (test_report_id) REFERENCES test_datasets(id)
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON publish_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_workspace ON publish_queue(workspace_id);

-- 表 8(单行): production_state(当前生产状态,应用层单行表)
CREATE TABLE IF NOT EXISTS production_state (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),  -- 固定单行
    current_session_id  INTEGER,        -- 当前生产 session 的 tcb session_id
    ruleset_version     INTEGER NOT NULL DEFAULT 0,
    ruleset_hash        TEXT,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by          TEXT
);

-- 初始化单行
INSERT OR IGNORE INTO production_state (id, ruleset_version) VALUES (1, 0);

-- ============================================================
-- schema 版本记录(支持未来迁移)
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR REPLACE INTO schema_version (version) VALUES (1);
```

### 3.3 数据模型(M2)

```rust
// src/models.rs

use serde::{Deserialize, Serialize};

/// 规则状态机:draft → reviewing → final_candidate → published → archived
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RuleStatus {
    Draft,
    Reviewing,
    FinalCandidate,
    Published,
    Archived,
}

impl RuleStatus {
    /// 状态机合法转换
    pub fn can_transition_to(&self, target: &RuleStatus) -> bool {
        matches!(
            (self, target),
            (RuleStatus::Draft, RuleStatus::Reviewing)
                | (RuleStatus::Reviewing, RuleStatus::FinalCandidate)
                | (RuleStatus::Reviewing, RuleStatus::Draft) // 驳回
                | (RuleStatus::FinalCandidate, RuleStatus::Published)
                | (RuleStatus::Published, RuleStatus::Archived)
        )
    }
}

/// Workspace 状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceStatus {
    Active,
    Archived,
}

/// 发布队列状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PublishStatus {
    Pending,
    Approved,
    Rejected,
    Published,
}

/// 沙盒会话状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxStatus {
    Running,
    Closed,
}

/// 工作空间成员角色(Workspace 内,与发布权限 Q3 不同)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MemberRole {
    Author,
    Reviewer,
    Observer,
}

// ===== 表对应 struct =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub team: Option<String>,
    pub status: WorkspaceStatus,
    pub created_by: String,
    pub created_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceMember {
    pub workspace_id: String,
    pub user_id: String,
    pub role: MemberRole,
    pub added_at: String,
    pub added_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleMeta {
    pub id: i64,
    pub workspace_id: Option<String>,
    pub rule_key: String,
    pub rule_json: String,
    pub status: RuleStatus,
    pub version: i64,
    pub ruleset_version: Option<i64>,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxSession {
    pub id: i64,
    pub tcb_session_id: Option<i64>,
    pub workspace_id: String,
    pub parent_session_id: Option<i64>,
    pub draft_ruleset_hash: Option<String>,
    pub test_dataset_id: Option<i64>,
    pub status: SandboxStatus,
    pub started_by: String,
    pub started_at: String,
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionAudit {
    pub id: i64,
    pub event_type: String,
    pub ruleset_version: i64,
    pub previous_version: Option<i64>,
    pub ruleset_hash: String,
    pub tcb_session_id: Option<i64>,
    pub source_workspace_ids: Option<String>, // JSON 数组
    pub operated_by: String,
    pub operated_at: String,
    pub reason: Option<String>,
    pub test_report_ids: Option<String>, // JSON 数组
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestDataset {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub scope: String,
    pub cases_json: String,
    pub created_by: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishQueueItem {
    pub id: i64,
    pub workspace_id: String,
    pub final_candidate_rules: String, // JSON 数组
    pub ruleset_hash: String,
    pub test_report_id: Option<i64>,
    pub status: PublishStatus,
    pub submitted_by: String,
    pub submitted_at: String,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<String>,
    pub review_comment: Option<String>,
    pub published_ruleset_version: Option<i64>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionState {
    pub current_session_id: Option<i64>,
    pub ruleset_version: i64,
    pub ruleset_hash: Option<String>,
    pub updated_at: String,
    pub updated_by: Option<String>,
}
```

---

## 4. Workspace 服务(M3)

### 4.1 WorkspaceService

```rust
// src/workspace_service.rs

use crate::db::WorkspaceDb;
use crate::error::WorkspaceError;
use crate::models::*;
use std::sync::Arc;

/// Workspace 编排服务
#[derive(Clone)]
pub struct WorkspaceService {
    db: Arc<WorkspaceDb>,
}

impl WorkspaceService {
    pub fn new(db: Arc<WorkspaceDb>) -> Self {
        Self { db }
    }

    /// 创建 Workspace
    pub async fn create_workspace(
        &self,
        id: String,
        name: String,
        description: Option<String>,
        team: Option<String>,
        created_by: String,
    ) -> Result<Workspace, WorkspaceError> {
        self.db.create_workspace(&id, &name, &description, &team, &created_by)?;
        self.db.get_workspace(&id)?.ok_or(WorkspaceError::NotFound)
    }

    /// 查询 Workspace(含成员可见性校验)
    pub async fn get_workspace(
        &self,
        id: &str,
        user_id: &str,
    ) -> Result<Workspace, WorkspaceError> {
        // 校验成员可见性
        if !self.db.is_workspace_member(id, user_id)? {
            return Err(WorkspaceError::Forbidden);
        }
        self.db.get_workspace(id)?.ok_or(WorkspaceError::NotFound)
    }

    /// 列出用户可见的 Workspace
    pub async fn list_workspaces(
        &self,
        user_id: &str,
    ) -> Result<Vec<Workspace>, WorkspaceError> {
        self.db.list_workspaces_for_user(user_id)
    }

    /// 归档 Workspace(不删除,保留历史)
    pub async fn archive_workspace(
        &self,
        id: &str,
        operated_by: &str,
    ) -> Result<(), WorkspaceError> {
        if !self.db.is_workspace_member(id, operated_by)? {
            return Err(WorkspaceError::Forbidden);
        }
        self.db.archive_workspace(id)?;
        // 归档时把该 Workspace 的所有 Draft 规则也标记为 archived
        self.db.archive_workspace_rules(id)?;
        Ok(())
    }

    // ===== 成员管理 =====

    /// 添加成员
    pub async fn add_member(
        &self,
        workspace_id: &str,
        user_id: &str,
        role: MemberRole,
        added_by: &str,
    ) -> Result<(), WorkspaceError> {
        // 仅 author/reviewer 可添加成员
        let operator_role = self.db.get_member_role(workspace_id, added_by)?;
        match operator_role {
            Some(MemberRole::Author) | Some(MemberRole::Reviewer) => {}
            _ => return Err(WorkspaceError::Forbidden),
        }
        self.db.add_member(workspace_id, user_id, &role, added_by)?;
        Ok(())
    }

    /// 移除成员
    pub async fn remove_member(
        &self,
        workspace_id: &str,
        user_id: &str,
        operated_by: &str,
    ) -> Result<(), WorkspaceError> {
        let operator_role = self.db.get_member_role(workspace_id, operated_by)?;
        match operator_role {
            Some(MemberRole::Author) => {}
            _ => return Err(WorkspaceError::Forbidden),
        }
        self.db.remove_member(workspace_id, user_id)?;
        Ok(())
    }

    /// 列出成员
    pub async fn list_members(
        &self,
        workspace_id: &str,
        requester: &str,
    ) -> Result<Vec<WorkspaceMember>, WorkspaceError> {
        if !self.db.is_workspace_member(workspace_id, requester)? {
            return Err(WorkspaceError::Forbidden);
        }
        self.db.list_members(workspace_id)
    }
}
```

### 4.2 RuleMetaService(M4)

```rust
// src/rule_meta_service.rs

use crate::db::WorkspaceDb;
use crate::error::WorkspaceError;
use crate::models::*;
use blake3;
use std::sync::Arc;

/// 规则元数据服务(管理 rules 表的 workspace_id / status / ruleset_version)
#[derive(Clone)]
pub struct RuleMetaService {
    db: Arc<WorkspaceDb>,
}

impl RuleMetaService {
    pub fn new(db: Arc<WorkspaceDb>) -> Self {
        Self { db }
    }

    /// 创建 Draft 规则(Workspace 内)
    pub async fn create_draft_rule(
        &self,
        workspace_id: &str,
        rule_key: &str,
        rule_json: &str,
        created_by: &str,
    ) -> Result<RuleMeta, WorkspaceError> {
        // 校验成员权限(仅 author 可创建)
        let role = self.db.get_member_role(workspace_id, created_by)?;
        match role {
            Some(MemberRole::Author) => {}
            _ => return Err(WorkspaceError::Forbidden),
        }

        let id = self.db.insert_rule(
            Some(workspace_id),
            rule_key,
            rule_json,
            RuleStatus::Draft,
            1,
            None,
            created_by,
        )?;
        self.db.get_rule(id)?.ok_or(WorkspaceError::NotFound)
    }

    /// 更新规则状态(状态机校验)
    pub async fn transition_status(
        &self,
        rule_id: i64,
        target: RuleStatus,
        operated_by: &str,
    ) -> Result<RuleMeta, WorkspaceError> {
        let rule = self.db.get_rule(rule_id)?.ok_or(WorkspaceError::NotFound)?;

        // 校验 workspace 成员权限
        if let Some(ref ws_id) = rule.workspace_id {
            let role = self.db.get_member_role(ws_id, operated_by)?;
            match (role.as_ref(), &target) {
                (Some(MemberRole::Author), _) => {}
                (Some(MemberRole::Reviewer), RuleStatus::FinalCandidate) => {}
                (Some(MemberRole::Reviewer), RuleStatus::Draft) => {} // 驳回
                _ => return Err(WorkspaceError::Forbidden),
            }
        }

        // 状态机校验
        if !rule.status.can_transition_to(&target) {
            return Err(WorkspaceError::InvalidStatusTransition {
                from: rule.status,
                to: target,
            });
        }

        self.db.update_rule_status(rule_id, &target, operated_by)?;
        self.db.get_rule(rule_id)?.ok_or(WorkspaceError::NotFound)
    }

    /// 列出 Workspace 内的规则(隔离查询)
    pub async fn list_workspace_rules(
        &self,
        workspace_id: &str,
        requester: &str,
        status_filter: Option<RuleStatus>,
    ) -> Result<Vec<RuleMeta>, WorkspaceError> {
        if !self.db.is_workspace_member(workspace_id, requester)? {
            return Err(WorkspaceError::Forbidden);
        }
        self.db.list_rules_by_workspace(workspace_id, status_filter)
    }

    /// 列出全局已发布规则(workspace_id IS NULL)
    pub async fn list_published_rules(&self) -> Result<Vec<RuleMeta>, WorkspaceError> {
        self.db.list_published_rules()
    }

    /// 发布规则(把 final_candidate 的 workspace_id 置 NULL + status 改 published)
    /// 注意:此方法仅改元数据;实际写入 rules_dir + reload + 滚动 session 由 PUBLISH_QUEUE_DESIGN.md 编排
    pub async fn publish_rules(
        &self,
        rule_ids: &[i64],
        ruleset_version: i64,
        operated_by: &str,
    ) -> Result<(), WorkspaceError> {
        self.db.publish_rules(rule_ids, ruleset_version, operated_by)?;
        Ok(())
    }

    /// 计算 Draft 规则集 BLAKE3 哈希(用于沙盒测试 + 发布队列)
    pub async fn compute_ruleset_hash(&self, rule_ids: &[i64]) -> Result<String, WorkspaceError> {
        let rules = self.db.get_rules_by_ids(rule_ids)?;
        let mut hasher = blake3::Hasher::new();
        for rule in &rules {
            hasher.update(rule.rule_json.as_bytes());
            hasher.update(b"\n"); // 分隔符
        }
        Ok(hasher.finalize().to_hex().to_string())
    }
}
```

---

## 5. SessionManager 集成(M5)

### 5.1 SessionOps trait(D3 决策)

workspace crate 不直接依赖 evorule_governance,通过 trait 抽象注入:

```rust
// src/session_bridge.rs

use crate::error::WorkspaceError;

/// Session 操作抽象(trait,由 evorule-server 主 crate 注入实现)
///
/// 设计理由:workspace crate 不直接 use evorule_governance::session,
/// 保持可独立编译测试。evorule-server 在 AppState 中注入 SessionApi 的包装实现。
#[async_trait::async_trait]
pub trait SessionOps: Send + Sync {
    /// 创建新 session
    async fn create_session(&self) -> Result<u64, WorkspaceError>;

    /// 从父 session fork(继承状态 + 用新 core_eval)
    async fn fork_session(
        &self,
        parent_id: u64,
        version: Option<u64>,
    ) -> Result<u64, WorkspaceError>;

    /// 关闭 session(优雅退出)
    async fn close_session(&self, session_id: u64) -> Result<(), WorkspaceError>;

    /// 列出活跃 session
    async fn list_sessions(&self) -> Result<Vec<u64>, WorkspaceError>;

    /// 向 session 发送命令(加载规则 / 提交测试数据)
    async fn send_command(
        &self,
        session_id: u64,
        instruction: serde_json::Value,
    ) -> Result<Option<u64>, WorkspaceError>;

    /// 获取 session 状态快照
    async fn get_state(&self, session_id: u64) -> Result<serde_json::Value, WorkspaceError>;
}
```

### 5.2 evorule-server 注入实现(在主 crate 中)

```rust
// evorule-server/src/api/server.rs 中新增(伪代码,实际在集成时添加)

use evorule_workspace::SessionOps;
use evorule_governance::session;

/// SessionApi 的 SessionOps 实现(桥接 evorule_governance::session::SessionManager)
#[async_trait::async_trait]
impl SessionOps for SessionApi {
    async fn create_session(&self) -> Result<u64, WorkspaceError> {
        let sessions = self.sessions.lock().await;
        sessions.create_session().map_err(|e| match e {
            session::SessionError::LimitExceeded { current, max } => {
                WorkspaceError::SessionLimitExceeded { current, max }
            }
            _ => WorkspaceError::Internal("create_session failed".into()),
        })
    }

    async fn fork_session(
        &self,
        parent_id: u64,
        version: Option<u64>,
    ) -> Result<u64, WorkspaceError> {
        let sessions = self.sessions.lock().await;
        sessions
            .create_session_from_parent_at_version(parent_id, version)
            .map_err(|e| match e {
                session::SessionError::NotFound { id } => WorkspaceError::SessionNotFound { id },
                session::SessionError::InvalidVersion { version } => {
                    WorkspaceError::InvalidVersion { version }
                }
                _ => WorkspaceError::Internal("fork_session failed".into()),
            })
    }

    async fn close_session(&self, session_id: u64) -> Result<(), WorkspaceError> {
        let sessions = self.sessions.lock().await;
        sessions
            .close_session(session_id)
            .map_err(|_| WorkspaceError::SessionNotFound { id: session_id })
    }

    async fn list_sessions(&self) -> Result<Vec<u64>, WorkspaceError> {
        let sessions = self.sessions.lock().await;
        Ok(sessions.list_sessions())
    }

    async fn send_command(
        &self,
        session_id: u64,
        instruction: serde_json::Value,
    ) -> Result<Option<u64>, WorkspaceError> {
        // 复用已有的 session_command 逻辑
        // ... (调用 sessions.get_session(session_id) → command_tx.send)
        todo!("集成时复用 session_command handler 逻辑")
    }

    async fn get_state(&self, session_id: u64) -> Result<serde_json::Value, WorkspaceError> {
        // 复用已有的 session_state 逻辑
        todo!("集成时复用 session_state handler 逻辑")
    }
}
```

---

## 6. API 端点设计(M6)

### 6.1 新增路由清单

workspace crate 新增以下路由(挂载到 evorule-server 的 protected_routes):

| 方法 | 路径 | 用途 | 对应模块 |
|------|------|------|----------|
| **Workspace CRUD** | | | |
| POST | `/api/workspaces` | 创建 Workspace | M3 |
| GET | `/api/workspaces` | 列出我的 Workspace | M3 |
| GET | `/api/workspaces/{id}` | 查看 Workspace 详情 | M3 |
| POST | `/api/workspaces/{id}/archive` | 归档 Workspace | M3 |
| **成员管理** | | | |
| GET | `/api/workspaces/{id}/members` | 列出成员 | M3 |
| POST | `/api/workspaces/{id}/members` | 添加成员 | M3 |
| DELETE | `/api/workspaces/{id}/members/{user_id}` | 移除成员 | M3 |
| **规则元数据** | | | |
| POST | `/api/workspaces/{id}/rules` | 创建 Draft 规则 | M4 |
| GET | `/api/workspaces/{id}/rules` | 列出 Workspace 规则 | M4 |
| GET | `/api/workspaces/{id}/rules/{rule_id}` | 查看规则详情 | M4 |
| PATCH | `/api/workspaces/{id}/rules/{rule_id}/status` | 更新规则状态 | M4 |
| PUT | `/api/workspaces/{id}/rules/{rule_id}` | 更新规则内容 | M4 |
| GET | `/api/rules/published` | 列出全局已发布规则 | M4 |
| **合成数据集** | | | |
| POST | `/api/datasets` | 创建合成数据集 | M3 |
| GET | `/api/datasets` | 列出数据集(按 scope) | M3 |
| GET | `/api/datasets/{id}` | 查看数据集 | M3 |
| **Production 状态** | | | |
| GET | `/api/production/state` | 查询当前生产状态 | M3 |
| GET | `/api/production/audit` | 查询发布审计历史 | M3 |

### 6.2 Router 构建

```rust
// src/api.rs

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, delete, patch},
    Router,
};
use crate::workspace_service::WorkspaceService;
use crate::rule_meta_service::RuleMetaService;
use crate::session_bridge::SessionOps;
use std::sync::Arc;

/// workspace crate 共享状态(注入到 Router)
#[derive(Clone)]
pub struct WorkspaceState {
    pub workspace_service: WorkspaceService,
    pub rule_meta_service: RuleMetaService,
    pub session_ops: Arc<dyn SessionOps>,
    /// 当前认证用户 ID(由 auth middleware 注入)
    /// 实际通过 axum Extension 传递,这里用 Option 占位
}

/// 构建 workspace Router(由 evorule-server build_router() 合并)
pub fn build_workspace_router(state: WorkspaceState) -> Router {
    Router::new()
        // Workspace CRUD
        .route("/api/workspaces", post(create_workspace).get(list_workspaces))
        .route("/api/workspaces/{id}", get(get_workspace))
        .route("/api/workspaces/{id}/archive", post(archive_workspace))
        // 成员管理
        .route(
            "/api/workspaces/{id}/members",
            get(list_members).post(add_member),
        )
        .route(
            "/api/workspaces/{id}/members/{user_id}",
            delete(remove_member),
        )
        // 规则元数据
        .route(
            "/api/workspaces/{id}/rules",
            post(create_draft_rule).get(list_workspace_rules),
        )
        .route(
            "/api/workspaces/{id}/rules/{rule_id}",
            get(get_rule).put(update_rule),
        )
        .route(
            "/api/workspaces/{id}/rules/{rule_id}/status",
            patch(transition_rule_status),
        )
        .route("/api/rules/published", get(list_published_rules))
        // 合成数据集
        .route("/api/datasets", post(create_dataset).get(list_datasets))
        .route("/api/datasets/{id}", get(get_dataset))
        // Production 状态
        .route("/api/production/state", get(get_production_state))
        .route("/api/production/audit", get(get_production_audit))
        .with_state(state)
}
```

### 6.3 Handler 示例(Workspace 创建)

```rust
// src/api.rs (续)

#[derive(serde::Deserialize)]
pub struct CreateWorkspaceRequest {
    pub id: String,           // 语义化 ID,如 "ws-内科-发烧CT-20260806"
    pub name: String,
    pub description: Option<String>,
    pub team: Option<String>,
}

/// POST /api/workspaces — 创建 Workspace
async fn create_workspace(
    State(state): State<WorkspaceState>,
    Extension(auth): Extension<AuthUser>,  // auth middleware 注入
    Json(req): Json<CreateWorkspaceRequest>,
) -> Result<Json<Workspace>, WorkspaceError> {
    let ws = state
        .workspace_service
        .create_workspace(req.id, req.name, req.description, req.team, auth.user_id)
        .await?;

    // 创建者自动成为 author 成员
    state
        .workspace_service
        .add_member(&ws.id, &auth.user_id, MemberRole::Author, &auth.user_id)
        .await?;

    Ok(Json(ws))
}

/// GET /api/workspaces — 列出我的 Workspace
async fn list_workspaces(
    State(state): State<WorkspaceState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Vec<Workspace>>, WorkspaceError> {
    let list = state
        .workspace_service
        .list_workspaces(&auth.user_id)
        .await?;
    Ok(Json(list))
}
```

---

## 7. 与 evorule-server 集成(D5)

### 7.1 Cargo.toml 依赖

```toml
# core/workspace/Cargo.toml
[package]
name = "evorule-workspace"
version = "0.1.0"
edition = "2021"
description = "Workspace 编排服务(三层架构 Layer 2 应用层)"
license = "AGPL-3.0-or-later"
repository = "https://gitee.com/evo-rule-lab/evorule-server"
publish = false

[dependencies]
# SQLite
rusqlite = { version = "0.32", features = ["bundled"] }
# 序列化
serde = { version = "1", features = ["derive"] }
serde_json = "1"
# 异步 trait
async-trait = "0.1"
# HTTP
axum = "0.8"
tower = "0.5"
# 哈希
blake3 = "1"
# 日志
tracing = "0.1"
# 错误
thiserror = "2"

[dev-dependencies]
tempfile = "3"
tokio = { version = "1", features = ["macros", "rt"] }
```

```toml
# evorule-server/Cargo.toml 新增依赖
[dependencies]
# ... 已有依赖 ...
evorule-workspace = { path = "../core/workspace" }
```

```toml
# 顶层 Cargo.toml workspace members 新增
[workspace]
members = [
    "core/auth",
    "core/debug_control",
    "core/hot_reload",
    "core/io_handlers",
    "core/metrics",
    "core/rule_tools",
    "core/semantic_invariants",
    "core/time_machine",
    "core/workspace",        # ← 新增
    "evorule-server",
]
```

### 7.2 AppState 扩展

```rust
// evorule-server/src/api/server.rs

use evorule_workspace::{WorkspaceState, WorkspaceService, RuleMetaService, SessionOps};

#[derive(Clone)]
pub struct AppState {
    governance: GovernanceApi,
    sessions: SessionApi,
    metrics: SharedMetrics,
    readiness: ReadinessFlag,
    shared_facts: SharedFactsLog,
    // ===== 新增 =====
    workspace: WorkspaceState,
}

impl AppState {
    pub fn new(
        governance: GovernanceApi,
        sessions: SessionApi,
        metrics: SharedMetrics,
        readiness: ReadinessFlag,
        shared_facts: SharedFactsLog,
        workspace: WorkspaceState,  // 新增参数
    ) -> Self {
        Self { governance, sessions, metrics, readiness, shared_facts, workspace }
    }
}

// FromRef for WorkspaceState
impl FromRef<AppState> for WorkspaceState {
    fn from_ref(state: &AppState) -> Self {
        state.workspace.clone()
    }
}
```

### 7.3 build_router 合并

```rust
// evorule-server/src/api/server.rs — build_router() 中合并

let workspace_router = evorule_workspace::build_workspace_router(
    state.workspace.clone(),
);

let protected_routes = Router::new()
    // ... 已有路由 ...
    .merge(workspace_router)  // ← 合并 workspace 路由
    .layer(axum::middleware::from_fn_with_state(auth, auth_middleware_wrapper));
```

### 7.4 启动初始化(main.rs)

```rust
// evorule-server/src/main.rs — run_server() 中初始化

// 1. 打开 SQLite(复用 --db-path 配置)
let workspace_db = Arc::new(
    evorule_workspace::WorkspaceDb::open(&config.db_path)?
);

// 2. 运行 schema 迁移
workspace_db.migrate()?;

// 3. 构建 service
let workspace_service = WorkspaceService::new(workspace_db.clone());
let rule_meta_service = RuleMetaService::new(workspace_db.clone());

// 4. 构建 SessionOps(Arc<dyn SessionOps>)
let session_ops: Arc<dyn SessionOps> = Arc::new(sessions_api.clone());

// 5. 构建 WorkspaceState
let workspace_state = WorkspaceState {
    workspace_service,
    rule_meta_service,
    session_ops,
};

// 6. 注入 AppState
let app_state = AppState::new(
    governance_api,
    sessions_api,
    metrics,
    readiness_flag,
    shared_facts,
    workspace_state,
);
```

---

## 8. 错误处理(M7)

```rust
// src/error.rs

use crate::models::*;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("workspace not found: {0}")]
    NotFound(String),

    #[error("forbidden: user lacks permission")]
    Forbidden,

    #[error("session not found: {id}")]
    SessionNotFound { id: u64 },

    #[error("session limit exceeded: {current}/{max}")]
    SessionLimitExceeded { current: usize, max: usize },

    #[error("invalid version: {version}")]
    InvalidVersion { version: u64 },

    #[error("invalid status transition: {from:?} → {to:?}")]
    InvalidStatusTransition {
        from: RuleStatus,
        to: RuleStatus,
    },

    #[error("database error: {0}")]
    Database(String),

    #[error("internal error: {0}")]
    Internal(String),
}

/// HTTP 状态码映射
impl axum::response::IntoResponse for WorkspaceError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match &self {
            WorkspaceError::NotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            WorkspaceError::Forbidden => (StatusCode::FORBIDDEN, self.to_string()),
            WorkspaceError::SessionNotFound { .. } => (StatusCode::NOT_FOUND, self.to_string()),
            WorkspaceError::SessionLimitExceeded { .. } => {
                (StatusCode::TOO_MANY_REQUESTS, self.to_string())
            }
            WorkspaceError::InvalidVersion { .. } => {
                (StatusCode::BAD_REQUEST, self.to_string())
            }
            WorkspaceError::InvalidStatusTransition { .. } => {
                (StatusCode::CONFLICT, self.to_string())
            }
            WorkspaceError::Database(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            WorkspaceError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };
        (
            status,
            Json(serde_json::json!({ "error": message })),
        )
            .into_response()
    }
}

impl From<rusqlite::Error> for WorkspaceError {
    fn from(e: rusqlite::Error) -> Self {
        WorkspaceError::Database(e.to_string())
    }
}
```

---

## 9. 测试策略

### 9.1 单元测试(workspace crate 内)

```rust
// core/workspace/src/workspace_service.rs

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::WorkspaceDb;
    use tempfile::TempDir;

    async fn setup() -> (WorkspaceService, TempDir) {
        let dir = TempDir::new().unwrap();
        let db = Arc::new(WorkspaceDb::open(dir.path().join("test.db")).unwrap());
        db.migrate().unwrap();
        (WorkspaceService::new(db), dir)
    }

    #[tokio::test]
    async fn test_create_workspace() {
        let (svc, _dir) = setup().await;
        let ws = svc
            .create_workspace(
                "ws-test-001".into(),
                "测试 Workspace".into(),
                None,
                Some("内科".into()),
                "user-alice".into(),
            )
            .await
            .unwrap();

        assert_eq!(ws.id, "ws-test-001");
        assert_eq!(ws.status, WorkspaceStatus::Active);
    }

    #[tokio::test]
    async fn test_workspace_isolation() {
        let (svc, _dir) = setup().await;

        // Alice 创建 Workspace A
        svc.create_workspace("ws-a".into(), "WS-A".into(), None, None, "alice".into())
            .await
            .unwrap();
        svc.add_member("ws-a", "alice", MemberRole::Author, "alice")
            .await
            .unwrap();

        // Bob 无法看到 Workspace A
        let result = svc.get_workspace("ws-a", "bob").await;
        assert!(matches!(result, Err(WorkspaceError::Forbidden)));
    }

    #[tokio::test]
    async fn test_rule_status_state_machine() {
        // draft → reviewing → final_candidate → published
        assert!(RuleStatus::Draft.can_transition_to(&RuleStatus::Reviewing));
        assert!(RuleStatus::Reviewing.can_transition_to(&RuleStatus::FinalCandidate));
        assert!(RuleStatus::FinalCandidate.can_transition_to(&RuleStatus::Published));
        assert!(RuleStatus::Published.can_transition_to(&RuleStatus::Archived));

        // 非法转换
        assert!(!RuleStatus::Draft.can_transition_to(&RuleStatus::Published));
        assert!(!RuleStatus::Archived.can_transition_to(&RuleStatus::Draft));
    }

    #[tokio::test]
    async fn test_archive_workspace() {
        let (svc, _dir) = setup().await;
        svc.create_workspace("ws-arch".into(), "待归档".into(), None, None, "alice".into())
            .await
            .unwrap();
        svc.add_member("ws-arch", "alice", MemberRole::Author, "alice")
            .await
            .unwrap();

        svc.archive_workspace("ws-arch", "alice").await.unwrap();

        let ws = svc.get_workspace("ws-arch", "alice").await.unwrap();
        assert_eq!(ws.status, WorkspaceStatus::Archived);
    }
}
```

### 9.2 集成测试(与 evorule-server)

```rust
// evorule-server/tests/workspace_integration.rs

#[tokio::test]
async fn test_workspace_api_e2e() {
    // 1. 启动 evorule-server(带 workspace crate)
    // 2. POST /api/workspaces 创建 Workspace
    // 3. POST /api/workspaces/{id}/rules 创建 Draft 规则
    // 4. PATCH /api/workspaces/{id}/rules/{rule_id}/status 转换状态
    // 5. GET /api/workspaces/{id}/rules 验证隔离
    // 6. POST /api/workspaces/{id}/archive 归档
    // (完整 E2E 流程测试)
}
```

---

## 10. P0 实施清单

| # | 任务 | 模块 | 依赖 | 工作量 |
|---|------|------|------|--------|
| 1 | 创建 `core/workspace` crate 骨架 | Cargo.toml + lib.rs | 无 | 0.5d |
| 2 | 实现 SQLite schema 迁移(7 张表 DDL) | M1 db.rs | #1 | 1d |
| 3 | 实现 7 个数据模型 struct | M2 models.rs | #2 | 0.5d |
| 4 | 实现 WorkspaceService CRUD + 成员管理 | M3 | #2,#3 | 1.5d |
| 5 | 实现 RuleMetaService + 状态机 + BLAKE3 哈希 | M4 | #2,#3 | 1.5d |
| 6 | 定义 SessionOps trait | M5 | #3 | 0.5d |
| 7 | 实现 18 个 API handler + Router | M6 | #4,#5,#6 | 2d |
| 8 | 实现 WorkspaceError + IntoResponse | M7 | #3 | 0.5d |
| 9 | evorule-server 集成(AppState + build_router + main.rs) | server | #1-#8 | 1d |
| 10 | SessionOps for SessionApi 桥接实现 | server | #6,#9 | 1d |
| 11 | 单元测试(workspace crate) | tests | #4,#5 | 1d |
| 12 | 集成测试(E2E API) | tests | #9,#10 | 1d |

**合计**:约 12 人天(单人),P0 可在 2 周内完成。

---

## 11. 与 P01 / P08 的同步点

| 文档 | 同步内容 | 状态 |
|------|----------|------|
| P01_BUILD_SCHEMA_DESIGN.md §4 | rules 表加 `workspace_id` / `status` / `ruleset_version`;新增 7 张应用层表 DDL | ✅ 本文 §3.2 落地 |
| P08_COLLAB_WORKFLOW_DESIGN.md | 5 内置角色(author/reviewer/observer + 科室主任/信息科)消费 workspace_members 表 | ✅ 本文 M3 成员管理提供 |
| 三层架构 §6 数据模型 | 7 张表设计 | ✅ 本文 §3.2 完整 DDL |
| 三层架构 §12.4 U6 | 独立 workspace crate 决策 | ✅ 本文 §1 落地 |
| SANDBOX_ORCHESTRATION_DESIGN.md | sandbox_sessions 表 + SessionOps trait | ✅ 本文 M5 + §3.2 表 4 |
| PUBLISH_QUEUE_DESIGN.md | publish_queue + production_state + production_audit 表 | ✅ 本文 §3.2 表 5/7/8 |
