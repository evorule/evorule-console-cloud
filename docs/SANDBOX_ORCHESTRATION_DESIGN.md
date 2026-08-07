<!--
  设计文档 — 沙盒编排实施级设计
  位置: D:\evorule-console-cloud\docs\SANDBOX_ORCHESTRATION_DESIGN.md
  写于: 2026-08-06
  来源: 三层架构 §5(Sandbox 层) + §6.4(sandbox_sessions 表) + evorule-server fork API 实测
  关联:
    - WORKSPACE_CRATE_DESIGN.md(M5 SessionOps trait + §3.2 表 4 sandbox_sessions)
    - evorule-three-layer-architecture.md §5(Layer 3 Sandbox) §3.6.3(合成 IO 响应器)
    - P04_BUSINESS_EXECUTION_PAD_DESIGN.md(业务执行台,消费沙盒测试 API)
    - P06_BUSINESS_AUDIT_TT_DESIGN.md(测试报告审计)
    - PUBLISH_QUEUE_DESIGN.md(发布时附带测试报告)
  状态: 2026-08-06 定稿,第四梯队第 2 份
  实测依据: evorule-server POST /api/sessions/from/{parent_id} + fork + SSE events + audit/export API
-->

# 沙盒编排实施级设计

> **状态**: 设计文档,2026-08-06 定稿。本文档是三层架构 §5(Layer 3 Sandbox)的可实施落地,目标仓库 `evorule-server`。

## 0. 摘要

**目标**:实现三层架构 Layer 3(Sandbox Sessions)的编排逻辑——组合 evorule-server 已有的 fork API + 合成数据加载 + 测试报告生成,形成"一键启动沙盒测试"的完整流程。

**核心洞察**:evorule-server 已就绪 80% 的沙盒能力(session fork / SSE / 审计导出),**无需内核改造**。本设计仅补应用层编排:把"fork → 加载 Draft → 注入合成数据 → 采集结果 → 生成报告"串成自动化流程。

**关键决策**:

| # | 决策 | 选项 |
|---|------|------|
| S1 | 编排模块位置 | `core/workspace` crate 内新增 `sandbox_service.rs` 模块(不新开 crate,编排逻辑依赖 workspace 表) |
| S2 | 合成 IO 响应器 | **MockIoResponder** — 自动回调 sandbox session 的 io_request(P0 全合成数据,Q2 决策) |
| S3 | 测试报告存储 | 复用 `production_audit.test_report_ids` + 新增 `test_reports` 目录(JSON 文件,不进 SQLite) |
| S4 | 测试 Fact 保留 | 关闭沙盒时通过 `GET /api/sessions/{id}/audit/export` 导出,不另建表 |

**不做什么**:

- ❌ 不实现容器化隔离(P2 可选,见三层架构 §5.2 P2 方案)
- ❌ 不接生产 IO(P0 全合成数据,Q2 决策)
- ❌ 不实现沙盒 UI(见 P04 业务执行台,消费本文档 API)
- ❌ 不管理 tcb 层 FactsLog(物理隔离,SessionManager 已处理)

---

## 1. 背景与定位

### 1.1 evorule-server 已就绪能力(零改造)

三层架构 §5.2 实测结论:以下 API 全部就绪,沙盒编排直接组合调用:

| 沙盒动作 | 调用的 evorule-server API | 状态 |
|----------|--------------------------|------|
| 创建沙盒(从 Production fork) | `POST /api/sessions/from/{production_id}` | ✅ 已就绪 |
| 加载 Draft 规则到沙盒 | `POST /api/sessions/{id}/command`(发 transform 指令) | ✅ 已就绪 |
| 提交合成测试数据 | `POST /api/sessions/{id}/command`(发测试事件) | ✅ 已就绪 |
| 实时观察 test Fact 流 | `GET /api/sessions/{id}/events`(SSE) | ✅ 已就绪 |
| 查询测试结果 | `GET /api/sessions/{id}/state` + `/audit` + `/replay` | ✅ 已就绪 |
| 导出测试 Fact | `GET /api/sessions/{id}/audit/export` | ✅ 已就绪 |
| 因果追溯 | `GET /api/sessions/{id}/audit/causal/{fact_id}` | ✅ 已就绪 |
| 关闭沙盒 | `DELETE /api/sessions/{id}` | ✅ 已就绪 |

### 1.2 待补的编排逻辑(本设计)

```
[已有 API]  POST /api/sessions/from/{parent_id}  ← fork
                ↓
[待补编排]   ① 记录 sandbox_sessions 表(workspace_id + parent_session_id + draft_ruleset_hash)
            ② 加载 Workspace 的 Draft 规则(从 rules 表查 → 逐条 send_command)
            ③ 注入合成数据集(从 test_datasets 表查 → 逐条 send_command)
            ④ 启动 MockIoResponder(自动回调 io_request)
                ↓
[已有 API]   GET /api/sessions/{id}/events  ← SSE 实时观察
                ↓
[待补编排]   ⑤ 采集 test Fact(订阅 SSE → 缓存结果)
            ⑥ 生成测试报告(聚合 pass/fail + 因果链 + 异常)
            ⑦ 导出 test Fact(audit/export → 存为 JSON 文件)
                ↓
[已有 API]   DELETE /api/sessions/{id}  ← 关闭沙盒
                ↓
[待补编排]   ⑧ 更新 sandbox_sessions 表 status=closed + closed_at
```

---

## 2. 模块结构

### 2.1 在 workspace crate 中新增模块

```
core/workspace/src/
├── lib.rs
├── db.rs
├── models.rs
├── workspace_service.rs
├── rule_meta_service.rs
├── session_bridge.rs          ← SessionOps trait(WORKSPACE_CRATE_DESIGN.md M5)
├── api.rs
├── error.rs
├── sandbox_service.rs         ← 【新增】沙盒编排服务
├── mock_io_responder.rs       ← 【新增】合成 IO 响应器
└── test_report.rs             ← 【新增】测试报告生成
```

### 2.2 模块职责

| # | 模块 | 职责 |
|---|------|------|
| S1 | `sandbox_service` | 沙盒编排主流程:fork → 加载 Draft → 注入数据 → 采集 → 报告 → 关闭 |
| S2 | `mock_io_responder` | 合成 IO 响应器:自动回调 sandbox session 的 io_request(P0 全合成数据) |
| S3 | `test_report` | 测试报告 schema + 生成逻辑 + BLAKE3 签名 |

---

## 3. 沙盒编排服务(S1)

### 3.1 SandboxService

```rust
// src/sandbox_service.rs

use crate::db::WorkspaceDb;
use crate::error::WorkspaceError;
use crate::models::*;
use crate::session_bridge::SessionOps;
use crate::rule_meta_service::RuleMetaService;
use crate::mock_io_responder::MockIoResponder;
use crate::test_report::{TestReport, TestReportBuilder};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

/// 沙盒编排服务
#[derive(Clone)]
pub struct SandboxService {
    db: Arc<WorkspaceDb>,
    rule_meta_service: RuleMetaService,
    session_ops: Arc<dyn SessionOps>,
    /// 活跃沙盒的 MockIoResponder 句柄(session_id → responder)
    mock_responders: Arc<Mutex<std::collections::HashMap<u64, MockIoResponder>>>,
}

/// 启动沙盒测试的请求
#[derive(serde::Deserialize)]
pub struct StartSandboxRequest {
    pub workspace_id: String,
    /// 要测试的 Draft 规则 ID 列表(从 rules 表查 status=draft/final_candidate)
    pub rule_ids: Vec<i64>,
    /// 合成数据集 ID(从 test_datasets 表查)
    pub test_dataset_id: i64,
    /// 可选:指定 fork 的 production session 版本(None = 最新)
    pub parent_version: Option<u64>,
}

/// 启动沙盒测试的响应
#[derive(serde::Serialize)]
pub struct StartSandboxResponse {
    pub sandbox_id: i64,           // 应用层 sandbox_sessions.id
    pub tcb_session_id: u64,       // SessionManager 的 session_id
    pub draft_ruleset_hash: String,// 本次测试的 Draft 规则集 BLAKE3
    pub test_case_count: usize,    // 注入的测试 case 数量
}

impl SandboxService {
    pub fn new(
        db: Arc<WorkspaceDb>,
        rule_meta_service: RuleMetaService,
        session_ops: Arc<dyn SessionOps>,
    ) -> Self {
        Self {
            db,
            rule_meta_service,
            session_ops,
            mock_responders: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    /// 启动沙盒测试(完整编排流程)
    ///
    /// 流程:
    /// 1. 校验 Workspace 成员权限
    /// 2. 计算 Draft 规则集 BLAKE3 哈希
    /// 3. 获取当前 Production session_id(从 production_state 表)
    /// 4. Fork Production session → 新 sandbox session
    /// 5. 记录 sandbox_sessions 表
    /// 6. 逐条加载 Draft 规则到 sandbox(send_command)
    /// 7. 逐条注入合成测试数据(send_command)
    /// 8. 启动 MockIoResponder(自动回调 io_request)
    pub async fn start_sandbox(
        &self,
        req: StartSandboxRequest,
        started_by: &str,
    ) -> Result<StartSandboxResponse, WorkspaceError> {
        // 1. 校验成员权限
        if !self.db.is_workspace_member(&req.workspace_id, started_by)? {
            return Err(WorkspaceError::Forbidden);
        }

        // 2. 计算 Draft 规则集 BLAKE3
        let draft_hash = self
            .rule_meta_service
            .compute_ruleset_hash(&req.rule_ids)
            .await?;

        // 3. 获取 Production session_id
        let production_state = self.db.get_production_state()?;
        let parent_session_id = production_state
            .current_session_id
            .ok_or(WorkspaceError::Internal(
                "Production session not initialized".into(),
            ))?;

        // 4. Fork Production session
        let tcb_session_id = self
            .session_ops
            .fork_session(parent_session_id as u64, req.parent_version)
            .await?;

        info!(
            sandbox_session_id = tcb_session_id,
            parent_session_id = parent_session_id,
            workspace_id = %req.workspace_id,
            "Sandbox session forked from production"
        );

        // 5. 记录 sandbox_sessions 表
        let sandbox_id = self.db.insert_sandbox_session(
            tcb_session_id as i64,
            &req.workspace_id,
            parent_session_id,
            &draft_hash,
            req.test_dataset_id,
            started_by,
        )?;

        // 6. 加载 Draft 规则到 sandbox
        let rules = self.db.get_rules_by_ids(&req.rule_ids)?;
        for rule in &rules {
            let instruction = serde_json::json!({
                "type": "transform",
                "payload": serde_json::from_str::<serde_json::Value>(&rule.rule_json)
                    .map_err(|e| WorkspaceError::Internal(format!("Invalid rule_json: {}", e)))?,
            });
            self.session_ops
                .send_command(tcb_session_id, instruction)
                .await?;
        }
        info!(
            count = rules.len(),
            sandbox_session_id = tcb_session_id,
            "Draft rules loaded into sandbox"
        );

        // 7. 注入合成测试数据
        let dataset = self
            .db
            .get_test_dataset(req.test_dataset_id)?
            .ok_or(WorkspaceError::NotFound(format!(
                "dataset {}",
                req.test_dataset_id
            )))?;

        let test_cases: Vec<serde_json::Value> =
            serde_json::from_str(&dataset.cases_json).map_err(|e| {
                WorkspaceError::Internal(format!("Invalid cases_json: {}", e))
            })?;

        for case in &test_cases {
            // 每个 case 作为一条测试事件(command)提交
            let instruction = serde_json::json!({
                "type": "command",
                "payload": case,
            });
            self.session_ops
                .send_command(tcb_session_id, instruction)
                .await?;
        }
        info!(
            count = test_cases.len(),
            sandbox_session_id = tcb_session_id,
            "Test cases injected into sandbox"
        );

        // 8. 启动 MockIoResponder
        let responder = MockIoResponder::new(tcb_session_id);
        responder.start().await;
        self.mock_responders
            .lock()
            .await
            .insert(tcb_session_id, responder);

        Ok(StartSandboxResponse {
            sandbox_id,
            tcb_session_id,
            draft_ruleset_hash: draft_hash,
            test_case_count: test_cases.len(),
        })
    }

    /// 关闭沙盒(导出 test Fact + 更新状态 + 关闭 session)
    pub async fn close_sandbox(
        &self,
        sandbox_id: i64,
        closed_by: &str,
    ) -> Result<String, WorkspaceError> {
        let sandbox = self
            .db
            .get_sandbox_session(sandbox_id)?
            .ok_or(WorkspaceError::NotFound(format!("sandbox {}", sandbox_id)))?;

        if sandbox.status != SandboxStatus::Running {
            return Err(WorkspaceError::InvalidStatusTransition {
                from: sandbox.status,
                to: SandboxStatus::Closed,
            });
        }

        // 校验成员权限
        if !self.db.is_workspace_member(&sandbox.workspace_id, closed_by)? {
            return Err(WorkspaceError::Forbidden);
        }

        let tcb_session_id = sandbox.tcb_session_id.unwrap_or(0) as u64;

        // 停止 MockIoResponder
        if let Some(responder) = self.mock_responders.lock().await.remove(&tcb_session_id) {
            responder.stop().await;
        }

        // 导出 test Fact(通过 audit/export API,存为 JSON 文件)
        let export_path = format!(
            "./data/sandbox_reports/sandbox_{}_{}.json",
            sandbox_id,
            chrono::Utc::now().timestamp()
        );
        let audit_data = self.session_ops.get_audit_export(tcb_session_id).await?;
        std::fs::create_dir_all("./data/sandbox_reports/")
            .map_err(|e| WorkspaceError::Internal(format!("mkdir failed: {}", e)))?;
        std::fs::write(&export_path, &audit_data)
            .map_err(|e| WorkspaceError::Internal(format!("write report failed: {}", e)))?;

        // 关闭 session
        self.session_ops.close_session(tcb_session_id).await?;

        // 更新 sandbox_sessions 表
        self.db.close_sandbox_session(sandbox_id)?;

        info!(
            sandbox_id = sandbox_id,
            tcb_session_id = tcb_session_id,
            export_path = %export_path,
            "Sandbox closed and test facts exported"
        );

        Ok(export_path)
    }

    /// 生成测试报告(从 sandbox session 的 audit + state 聚合)
    pub async fn generate_test_report(
        &self,
        sandbox_id: i64,
    ) -> Result<TestReport, WorkspaceError> {
        let sandbox = self
            .db
            .get_sandbox_session(sandbox_id)?
            .ok_or(WorkspaceError::NotFound(format!("sandbox {}", sandbox_id)))?;

        let tcb_session_id = sandbox.tcb_session_id.unwrap_or(0) as u64;

        // 获取 session 状态快照
        let state = self.session_ops.get_state(tcb_session_id).await?;

        // 获取审计报告
        let audit = self.session_ops.get_audit_report(tcb_session_id).await?;

        // 获取 Fact 列表(用于统计 pass/fail)
        let facts = self.session_ops.get_facts(tcb_session_id).await?;

        // 构建测试报告
        let report = TestReportBuilder::new()
            .sandbox_id(sandbox_id)
            .workspace_id(sandbox.workspace_id.clone())
            .tcb_session_id(tcb_session_id)
            .parent_session_id(sandbox.parent_session_id.map(|v| v as u64))
            .draft_ruleset_hash(sandbox.draft_ruleset_hash.clone().unwrap_or_default())
            .state(state)
            .audit(audit)
            .facts(facts)
            .build();

        Ok(report)
    }

    /// 列出 Workspace 的沙盒测试历史
    pub async fn list_sandboxes(
        &self,
        workspace_id: &str,
        requester: &str,
    ) -> Result<Vec<SandboxSession>, WorkspaceError> {
        if !self.db.is_workspace_member(workspace_id, requester)? {
            return Err(WorkspaceError::Forbidden);
        }
        self.db.list_sandbox_sessions(workspace_id)
    }
}
```

### 3.2 SessionOps trait 扩展

在 WORKSPACE_CRATE_DESIGN.md M5 的基础上,扩展以下方法(沙盒编排需要):

```rust
// src/session_bridge.rs(扩展)

#[async_trait::async_trait]
pub trait SessionOps: Send + Sync {
    // ===== 已有(WORKSPACE_CRATE_DESIGN.md M5) =====
    async fn create_session(&self) -> Result<u64, WorkspaceError>;
    async fn fork_session(&self, parent_id: u64, version: Option<u64>) -> Result<u64, WorkspaceError>;
    async fn close_session(&self, session_id: u64) -> Result<(), WorkspaceError>;
    async fn list_sessions(&self) -> Result<Vec<u64>, WorkspaceError>;
    async fn send_command(&self, session_id: u64, instruction: serde_json::Value) -> Result<Option<u64>, WorkspaceError>;
    async fn get_state(&self, session_id: u64) -> Result<serde_json::Value, WorkspaceError>;

    // ===== 新增(沙盒编排需要) =====

    /// 获取审计报告(含 BLAKE3 链验证结果)
    async fn get_audit_report(&self, session_id: u64) -> Result<serde_json::Value, WorkspaceError>;

    /// 获取审计链导出(JSON 字符串)
    async fn get_audit_export(&self, session_id: u64) -> Result<String, WorkspaceError>;

    /// 获取 Fact 列表(用于测试报告统计)
    async fn get_facts(&self, session_id: u64) -> Result<Vec<serde_json::Value>, WorkspaceError>;

    /// 获取因果链(某条 Fact 的因果追溯)
    async fn get_causal_chain(
        &self,
        session_id: u64,
        fact_id: u64,
    ) -> Result<serde_json::Value, WorkspaceError>;
}
```

对应 evorule-server 注入实现:

```rust
// evorule-server/src/api/server.rs 中 SessionOps for SessionApi(扩展)

#[async_trait::async_trait]
impl SessionOps for SessionApi {
    // ... 已有方法实现 ...

    async fn get_audit_report(&self, session_id: u64) -> Result<serde_json::Value, WorkspaceError> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get_session(session_id)
            .ok_or(WorkspaceError::SessionNotFound { id: session_id })?;
        let report = session.audit_report();
        serde_json::from_str(&report)
            .map_err(|e| WorkspaceError::Internal(format!("audit parse failed: {}", e)))
    }

    async fn get_audit_export(&self, session_id: u64) -> Result<String, WorkspaceError> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get_session(session_id)
            .ok_or(WorkspaceError::SessionNotFound { id: session_id })?;
        Ok(session.audit_export())
    }

    async fn get_facts(&self, session_id: u64) -> Result<Vec<serde_json::Value>, WorkspaceError> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get_session(session_id)
            .ok_or(WorkspaceError::SessionNotFound { id: session_id })?;
        Ok(session.facts_as_json())
    }

    async fn get_causal_chain(
        &self,
        session_id: u64,
        fact_id: u64,
    ) -> Result<serde_json::Value, WorkspaceError> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get_session(session_id)
            .ok_or(WorkspaceError::SessionNotFound { id: session_id })?;
        Ok(session.causal_chain(fact_id))
    }
}
```

---

## 4. 合成 IO 响应器(S2)

### 4.1 MockIoResponder

三层架构 §3.6.3:L3 Sandbox 的 io_request 由合成 IO 响应器自动回调。P0 全合成数据(Q2 决策),不接生产 IO。

```rust
// src/mock_io_responder.rs

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex;
use tracing::{info, debug};

/// 合成 IO 响应器
///
/// 设计:监听 sandbox session 的 io_request,根据 io_type 返回合成响应。
/// P0 策略:所有 io_request 返回成功响应(合成数据),不调真实 DB/HTTP。
///
/// 三层架构 §3.6.3:
/// - L1 Production: IoSubscriber 分发到真实 handler(DB/HTTP/Memory)
/// - L3 Sandbox: MockIoResponder 返回合成响应(零生产 IO 风险)
pub struct MockIoResponder {
    session_id: u64,
    running: Arc<AtomicBool>,
    /// 合成响应规则(io_type → 响应模板)
    response_templates: Arc<Mutex<std::collections::HashMap<String, serde_json::Value>>>,
}

impl MockIoResponder {
    pub fn new(session_id: u64) -> Self {
        let mut templates = std::collections::HashMap::new();

        // 默认合成响应模板(覆盖 6 种 io_type)
        templates.insert("query_db".into(), serde_json::json!({
            "rows": [],
            "affected": 0,
            "status": "ok"
        }));
        templates.insert("call_service".into(), serde_json::json!({
            "result": "mock_success",
            "status": 200
        }));
        templates.insert("call_external".into(), serde_json::json!({
            "result": "mock_success",
            "status": 200
        }));
        templates.insert("read_file".into(), serde_json::json!({
            "content": "mock file content",
            "status": "ok"
        }));
        templates.insert("write_file".into(), serde_json::json!({
            "written": true,
            "status": "ok"
        }));
        templates.insert("memory".into(), serde_json::json!({
            "value": null,
            "status": "ok"
        }));

        Self {
            session_id,
            running: Arc::new(AtomicBool::new(false)),
            response_templates: Arc::new(Mutex::new(templates)),
        }
    }

    /// 启动合成 IO 响应器
    ///
    /// 注意:实际实现需要通过 SessionOps 获取 session 的 io_request 通道。
    /// P0 简化方案:通过 HTTP 轮询 /api/sessions/{id}/debug/pending_io 获取待处理 IO,
    /// 然后通过 POST /api/sessions/{id}/io_response 回调。
    /// (evorule-server 已就绪这两个 API)
    pub async fn start(&self) {
        self.running.store(true, Ordering::SeqCst);
        info!(
            session_id = self.session_id,
            "MockIoResponder started for sandbox session"
        );
        // 实际轮询逻辑在 evorule-server 集成时实现(需访问 SessionApi 的内部通道)
        // P0 可用简化方案:sandbox 测试不产生 io_request(Draft 规则纯计算),
        // 或通过 HTTP 轮询 pending_io
    }

    /// 停止合成 IO 响应器
    pub async fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        info!(
            session_id = self.session_id,
            "MockIoResponder stopped"
        );
    }

    /// 设置自定义合成响应(按 io_type)
    pub async fn set_response(&self, io_type: &str, response: serde_json::Value) {
        self.response_templates
            .lock()
            .await
            .insert(io_type.into(), response);
    }

    /// 获取合成响应
    pub async fn get_response(&self, io_type: &str) -> serde_json::Value {
        self.response_templates
            .lock()
            .await
            .get(io_type)
            .cloned()
            .unwrap_or_else(|| serde_json::json!({ "status": "mock", "result": null }))
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}
```

### 4.2 P0 简化策略

P0 阶段,MockIoResponder 采用**最小化实现**:

1. **如果 Draft 规则是纯计算**(不触发 io_request):MockIoResponder 仅作占位,不实际轮询
2. **如果 Draft 规则触发 io_request**:通过 HTTP 轮询 `/api/sessions/{id}/debug/pending_io` + 回调 `/api/sessions/{id}/io_response`
3. **P1 增强**:直接注入 SessionApi 的内部通道(绕过 HTTP,更低延迟)

---

## 5. 测试报告(S3)

### 5.1 测试报告 Schema

三层架构 §5.4 定义的测试报告 schema:

```rust
// src/test_report.rs

use serde::{Serialize, Deserialize};
use blake3;

/// 测试报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestReport {
    /// 元信息
    pub sandbox_id: i64,
    pub workspace_id: String,
    pub tcb_session_id: u64,
    pub parent_session_id: Option<u64>,
    pub draft_ruleset_hash: String,

    /// 测试统计
    pub summary: TestSummary,

    /// 测试 case 结果明细
    pub cases: Vec<TestCaseResult>,

    /// 异常/告警
    pub anomalies: Vec<TestAnomaly>,

    /// 审计链信息
    pub audit_info: AuditInfo,

    /// 报告签名(BLAKE3,防篡改)
    pub report_hash: String,

    /// 时间戳
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestSummary {
    pub total_cases: usize,
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub pass_rate: f64,  // 0.0 - 1.0
    pub total_duration_ms: u64,
    pub fact_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCaseResult {
    pub case_id: String,         // case 标识
    pub case_name: String,       // case 描述
    pub status: CaseStatus,      // passed / failed / skipped
    pub fact_id: Option<u64>,    // 对应的 Fact ID
    pub error_message: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaseStatus {
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestAnomaly {
    pub anomaly_type: String,   // "rule_not_triggered" / "invariant_violation" / "io_timeout" 等
    pub description: String,
    pub fact_id: Option<u64>,
    pub severity: String,       // "warning" / "error" / "critical"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditInfo {
    pub audit_chain_length: usize,
    pub audit_chain_verified: bool,
    pub audit_export_path: Option<String>,
}
```

### 5.2 测试报告生成

```rust
// src/test_report.rs (续)

pub struct TestReportBuilder {
    sandbox_id: Option<i64>,
    workspace_id: Option<String>,
    tcb_session_id: Option<u64>,
    parent_session_id: Option<u64>,
    draft_ruleset_hash: Option<String>,
    state: Option<serde_json::Value>,
    audit: Option<serde_json::Value>,
    facts: Option<Vec<serde_json::Value>>,
}

impl TestReportBuilder {
    pub fn new() -> Self {
        Self {
            sandbox_id: None,
            workspace_id: None,
            tcb_session_id: None,
            parent_session_id: None,
            draft_ruleset_hash: None,
            state: None,
            audit: None,
            facts: None,
        }
    }

    pub fn sandbox_id(mut self, id: i64) -> Self {
        self.sandbox_id = Some(id);
        self
    }

    pub fn workspace_id(mut self, id: String) -> Self {
        self.workspace_id = Some(id);
        self
    }

    pub fn tcb_session_id(mut self, id: u64) -> Self {
        self.tcb_session_id = Some(id);
        self
    }

    pub fn parent_session_id(mut self, id: Option<u64>) -> Self {
        self.parent_session_id = id;
        self
    }

    pub fn draft_ruleset_hash(mut self, hash: String) -> Self {
        self.draft_ruleset_hash = Some(hash);
        self
    }

    pub fn state(mut self, state: serde_json::Value) -> Self {
        self.state = Some(state);
        self
    }

    pub fn audit(mut self, audit: serde_json::Value) -> Self {
        self.audit = Some(audit);
        self
    }

    pub fn facts(mut self, facts: Vec<serde_json::Value>) -> Self {
        self.facts = Some(facts);
        self
    }

    pub fn build(self) -> TestReport {
        let facts = self.facts.unwrap_or_default();
        let fact_count = facts.len();

        // 简化:每个 Fact 对应一个 case(P0)
        // P1 增强:按 case_id 分组,聚合 pass/fail
        let cases: Vec<TestCaseResult> = facts
            .iter()
            .enumerate()
            .map(|(i, fact)| {
                let fact_id = fact.get("id").and_then(|v| v.as_u64());
                let fact_type = fact.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");

                // 简化判定:StateTransition / Command = passed;异常 = failed
                let status = if fact_type == "Error" || fact_type == "Exception" {
                    CaseStatus::Failed
                } else {
                    CaseStatus::Passed
                };

                TestCaseResult {
                    case_id: format!("case-{}", i + 1),
                    case_name: format!("Fact #{} ({})", fact_id.unwrap_or(i as u64), fact_type),
                    status,
                    fact_id,
                    error_message: if status == CaseStatus::Failed {
                        Some(fact.to_string())
                    } else {
                        None
                    },
                    duration_ms: 0, // P1 从 audit 链时间戳计算
                }
            })
            .collect();

        let passed = cases.iter().filter(|c| c.status == CaseStatus::Passed).count();
        let failed = cases.iter().filter(|c| c.status == CaseStatus::Failed).count();
        let total = cases.len();
        let pass_rate = if total > 0 {
            passed as f64 / total as f64
        } else {
            0.0
        };

        // 审计链信息
        let audit = self.audit.unwrap_or_default();
        let audit_chain_length = audit
            .get("chain_length")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        let audit_chain_verified = audit
            .get("verified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let summary = TestSummary {
            total_cases: total,
            passed,
            failed,
            skipped: 0,
            pass_rate,
            total_duration_ms: 0, // P1 从 audit 时间戳计算
            fact_count,
        };

        let mut report = TestReport {
            sandbox_id: self.sandbox_id.unwrap_or(0),
            workspace_id: self.workspace_id.unwrap_or_default(),
            tcb_session_id: self.tcb_session_id.unwrap_or(0),
            parent_session_id: self.parent_session_id,
            draft_ruleset_hash: self.draft_ruleset_hash.unwrap_or_default(),
            summary,
            cases,
            anomalies: Vec::new(), // P1 从 invariants API 检测
            audit_info: AuditInfo {
                audit_chain_length,
                audit_chain_verified,
                audit_export_path: None,
            },
            report_hash: String::new(), // 下面计算
            generated_at: chrono::Utc::now().to_rfc3339(),
        };

        // 计算 BLAKE3 签名(防篡改)
        let report_json = serde_json::to_string(&report).unwrap_or_default();
        let hash = blake3::hash(report_json.as_bytes());
        report.report_hash = hash.to_hex().to_string();

        report
    }
}
```

### 5.3 测试报告存储(S3 决策)

```
data/
└── sandbox_reports/
    ├── sandbox_1_1722950400.json   ← test Fact 导出(audit/export)
    ├── sandbox_1_1722950400.report.json  ← 测试报告
    ├── sandbox_2_1722954000.json
    └── sandbox_2_1722954000.report.json
```

**不进 SQLite 的理由**:
1. 测试报告可能很大(含完整 Fact 链),SQLite 不适合存大 JSON
2. 报告是只读的(生成后不变),文件系统更自然
3. production_audit.test_report_ids 存报告文件路径(JSON 数组),可追溯

---

## 6. L3 API 端点设计

### 6.1 新增路由

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/workspaces/{id}/sandboxes` | 启动沙盒测试 |
| GET | `/api/workspaces/{id}/sandboxes` | 列出沙盒测试历史 |
| GET | `/api/workspaces/{id}/sandboxes/{sandbox_id}` | 查看沙盒详情 |
| POST | `/api/workspaces/{id}/sandboxes/{sandbox_id}/close` | 关闭沙盒 |
| GET | `/api/workspaces/{id}/sandboxes/{sandbox_id}/report` | 获取测试报告 |
| GET | `/api/workspaces/{id}/sandboxes/{sandbox_id}/events` | 订阅沙盒 SSE(代理到 `/api/sessions/{tcb_id}/events`) |

### 6.2 Handler 实现

```rust
// src/api.rs(扩展,新增沙盒路由)

pub fn build_workspace_router(state: WorkspaceState) -> Router {
    Router::new()
        // ... WORKSPACE_CRATE_DESIGN.md 已有路由 ...
        // 沙盒测试
        .route(
            "/api/workspaces/{id}/sandboxes",
            post(start_sandbox).get(list_sandboxes),
        )
        .route(
            "/api/workspaces/{id}/sandboxes/{sandbox_id}",
            get(get_sandbox),
        )
        .route(
            "/api/workspaces/{id}/sandboxes/{sandbox_id}/close",
            post(close_sandbox),
        )
        .route(
            "/api/workspaces/{id}/sandboxes/{sandbox_id}/report",
            get(get_test_report),
        )
        .with_state(state)
}

/// POST /api/workspaces/{id}/sandboxes — 启动沙盒测试
async fn start_sandbox(
    State(state): State<WorkspaceState>,
    Path(workspace_id): Path<String>,
    Extension(auth): Extension<AuthUser>,
    Json(req): Json<StartSandboxRequest>,
) -> Result<Json<StartSandboxResponse>, WorkspaceError> {
    // 确保 workspace_id 一致
    if req.workspace_id != workspace_id {
        return Err(WorkspaceError::BadRequest("workspace_id mismatch".into()));
    }
    let resp = state
        .sandbox_service
        .start_sandbox(req, &auth.user_id)
        .await?;
    Ok(Json(resp))
}

/// GET /api/workspaces/{id}/sandboxes/{sandbox_id}/report — 获取测试报告
async fn get_test_report(
    State(state): State<WorkspaceState>,
    Path((workspace_id, sandbox_id)): Path<(String, i64)>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<TestReport>, WorkspaceError> {
    // 校验成员权限
    if !state
        .workspace_service
        .is_member(&workspace_id, &auth.user_id)
        .await?
    {
        return Err(WorkspaceError::Forbidden);
    }
    let report = state.sandbox_service.generate_test_report(sandbox_id).await?;
    Ok(Json(report))
}

/// POST /api/workspaces/{id}/sandboxes/{sandbox_id}/close — 关闭沙盒
async fn close_sandbox(
    State(state): State<WorkspaceState>,
    Path((workspace_id, sandbox_id)): Path<(String, i64)>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, WorkspaceError> {
    let export_path = state
        .sandbox_service
        .close_sandbox(sandbox_id, &auth.user_id)
        .await?;
    Ok(Json(serde_json::json!({
        "sandbox_id": sandbox_id,
        "status": "closed",
        "export_path": export_path,
    })))
}
```

### 6.3 WorkspaceState 扩展

```rust
// src/api.rs — WorkspaceState 增加 sandbox_service

#[derive(Clone)]
pub struct WorkspaceState {
    pub workspace_service: WorkspaceService,
    pub rule_meta_service: RuleMetaService,
    pub sandbox_service: SandboxService,  // ← 新增
    pub session_ops: Arc<dyn SessionOps>,
}
```

---

## 7. 沙盒生命周期完整流程

### 7.1 时序图

```
客户端                    workspace crate              evorule-server(SessionManager)
  │                            │                              │
  │ POST /api/workspaces/      │                              │
  │   {id}/sandboxes           │                              │
  │───────────────────────────>│                              │
  │                            │ ① 校验成员权限                │
  │                            │ ② 计算 Draft BLAKE3          │
  │                            │ ③ 查 production_state        │
  │                            │    .current_session_id       │
  │                            │                              │
  │                            │ fork_session(parent_id)      │
  │                            │─────────────────────────────>│
  │                            │  create_session_from_parent  │
  │                            │  <───────────────────────────│
  │                            │  tcb_session_id = N          │
  │                            │                              │
  │                            │ ④ 记录 sandbox_sessions 表   │
  │                            │                              │
  │                            │ ⑤ 加载 Draft 规则(N 条)     │
  │                            │    send_command(N, transform)│
  │                            │─────────────────────────────>│
  │                            │                              │
  │                            │ ⑥ 注入合成数据(M 条)        │
  │                            │    send_command(N, command)  │
  │                            │─────────────────────────────>│
  │                            │                              │
  │                            │ ⑦ 启动 MockIoResponder       │
  │                            │                              │
  │  ← sandbox_id + tcb_id ───│                              │
  │                            │                              │
  │ GET /api/sessions/{N}/     │                              │
  │   events (SSE)             │                              │
  │─────────────────────────────────────────────────────────>│
  │  ← 实时 test Fact 流 ────────────────────────────────────│
  │                            │                              │
  │ POST .../sandboxes/{id}/   │                              │
  │   close                    │                              │
  │───────────────────────────>│                              │
  │                            │ ⑧ get_audit_export(N)        │
  │                            │─────────────────────────────>│
  │                            │  <── audit JSON ─────────────│
  │                            │ ⑨ 存 sandbox_reports/        │
  │                            │    .json                     │
  │                            │ ⑩ close_session(N)           │
  │                            │─────────────────────────────>│
  │                            │  DELETE session N            │
  │                            │  <───────────────────────────│
  │                            │ ⑪ 更新 sandbox_sessions      │
  │                            │    status=closed             │
  │  ← export_path ───────────│                              │
```

### 7.2 沙盒并发场景(医院 5 科室并行)

```
Production Session (id=1, 全院共享)
    │
    ├── fork ──> Sandbox A (id=2, Workspace A "内科-发烧CT")
    │            ├── 独立 Reactor + FactsLog + WAL(session_2.wal)
    │            ├── 加载 WS-A 的 Draft 规则
    │            └── 注入 WS-A 的合成数据集
    │
    ├── fork ──> Sandbox B (id=3, Workspace B "外科-手术审批")
    │            ├── 独立 Reactor + FactsLog + WAL(session_3.wal)
    │            ├── 加载 WS-B 的 Draft 规则
    │            └── 注入 WS-B 的合成数据集
    │
    ├── fork ──> Sandbox C (id=4, Workspace C "财务-报销上限")
    │            └── ...
    │
    ├── fork ──> Sandbox D (id=5, Workspace D "急诊-分诊规则")
    │            └── ...
    │
    └── fork ──> Sandbox E (id=6, Workspace E "药房-配药校验")
                 └── ...

关键:5 个 Sandbox 互不干扰(独立 Reactor + FactsLog + WAL)
     test Fact 物理隔离,不污染 production BLAKE3 链
     每个 Sandbox 可独立关闭,不影响其他
```

---

## 8. 与已有 API 的复用关系

### 8.1 直接复用(零改造)

| 已有 API | 沙盒用途 | 复用方式 |
|----------|----------|----------|
| `POST /api/sessions/from/{parent_id}` | fork Production | SessionOps.fork_session() |
| `POST /api/sessions/{id}/command` | 加载 Draft + 注入测试数据 | SessionOps.send_command() |
| `GET /api/sessions/{id}/events` | SSE 实时观察 | 客户端直接订阅(不经过 workspace crate) |
| `GET /api/sessions/{id}/state` | 查询测试快照 | SessionOps.get_state() |
| `GET /api/sessions/{id}/audit` | 审计报告 | SessionOps.get_audit_report() |
| `GET /api/sessions/{id}/audit/export` | 导出 test Fact | SessionOps.get_audit_export() |
| `GET /api/sessions/{id}/audit/causal/{fact_id}` | 因果追溯 | SessionOps.get_causal_chain() |
| `DELETE /api/sessions/{id}` | 关闭沙盒 | SessionOps.close_session() |
| `GET /api/sessions/{id}/debug/pending_io` | MockIoResponder 轮询 | HTTP 轮询(P0 简化) |
| `POST /api/sessions/{id}/io_response` | MockIoResponder 回调 | HTTP 回调(P0 简化) |

### 8.2 新增(编排逻辑)

| 新增 API | 用途 |
|----------|------|
| `POST /api/workspaces/{id}/sandboxes` | 一键启动沙盒(编排 fork + 加载 + 注入) |
| `GET /api/workspaces/{id}/sandboxes` | 列出沙盒历史 |
| `POST /api/workspaces/{id}/sandboxes/{sandbox_id}/close` | 一键关闭(编排导出 + 关闭) |
| `GET /api/workspaces/{id}/sandboxes/{sandbox_id}/report` | 生成测试报告 |

---

## 9. 测试策略

### 9.1 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_bridge::SessionOps;
    use async_trait::async_trait;

    /// Mock SessionOps(测试用,不连真实 evorule-server)
    struct MockSessionOps {
        sessions: std::sync::Mutex<std::collections::HashMap<u64, Vec<serde_json::Value>>>,
        next_id: std::sync::atomic::AtomicU64,
    }

    #[async_trait]
    impl SessionOps for MockSessionOps {
        async fn create_session(&self) -> Result<u64, WorkspaceError> {
            let id = self.next_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.sessions.lock().unwrap().insert(id, Vec::new());
            Ok(id)
        }

        async fn fork_session(&self, parent_id: u64, _version: Option<u64>) -> Result<u64, WorkspaceError> {
            let id = self.next_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let parent_facts = self.sessions.lock().unwrap().get(&parent_id).cloned().unwrap_or_default();
            self.sessions.lock().unwrap().insert(id, parent_facts);
            Ok(id)
        }

        async fn close_session(&self, session_id: u64) -> Result<(), WorkspaceError> {
            self.sessions.lock().unwrap().remove(&session_id);
            Ok(())
        }

        async fn send_command(&self, session_id: u64, instruction: serde_json::Value) -> Result<Option<u64>, WorkspaceError> {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(facts) = sessions.get_mut(&session_id) {
                facts.push(instruction);
                Ok(Some(facts.len() as u64))
            } else {
                Err(WorkspaceError::SessionNotFound { id: session_id })
            }
        }

        async fn get_state(&self, session_id: u64) -> Result<serde_json::Value, WorkspaceError> {
            Ok(serde_json::json!({"session_id": session_id, "status": "mock"}))
        }

        async fn get_audit_report(&self, _session_id: u64) -> Result<serde_json::Value, WorkspaceError> {
            Ok(serde_json::json!({"chain_length": 10, "verified": true}))
        }

        async fn get_audit_export(&self, _session_id: u64) -> Result<String, WorkspaceError> {
            Ok("[]".to_string())
        }

        async fn get_facts(&self, session_id: u64) -> Result<Vec<serde_json::Value>, WorkspaceError> {
            Ok(self.sessions.lock().unwrap().get(&session_id).cloned().unwrap_or_default())
        }

        async fn get_causal_chain(&self, _session_id: u64, _fact_id: u64) -> Result<serde_json::Value, WorkspaceError> {
            Ok(serde_json::json!([]))
        }

        async fn list_sessions(&self) -> Result<Vec<u64>, WorkspaceError> {
            Ok(self.sessions.lock().unwrap().keys().copied().collect())
        }
    }

    #[tokio::test]
    async fn test_sandbox_lifecycle() {
        // 1. 设置 MockSessionOps
        let session_ops: Arc<dyn SessionOps> = Arc::new(MockSessionOps {
            sessions: std::sync::Mutex::new(std::collections::HashMap::new()),
            next_id: std::sync::atomic::AtomicU64::new(100),
        });

        // 2. 创建 Production session
        let prod_id = session_ops.create_session().await.unwrap();

        // 3. Fork sandbox
        let sandbox_id = session_ops.fork_session(prod_id, None).await.unwrap();
        assert_ne!(sandbox_id, prod_id);

        // 4. 加载规则 + 注入数据
        session_ops.send_command(sandbox_id, serde_json::json!({"type": "transform"})).await.unwrap();
        session_ops.send_command(sandbox_id, serde_json::json!({"type": "command", "data": "test_case_1"})).await.unwrap();

        // 5. 查询结果
        let facts = session_ops.get_facts(sandbox_id).await.unwrap();
        assert_eq!(facts.len(), 2);

        // 6. 关闭
        session_ops.close_session(sandbox_id).await.unwrap();
    }

    #[test]
    fn test_report_generation() {
        let facts = vec![
            serde_json::json!({"id": 1, "type": "Command"}),
            serde_json::json!({"id": 2, "type": "StateTransition"}),
            serde_json::json!({"id": 3, "type": "Error", "message": "rule failed"}),
        ];

        let report = TestReportBuilder::new()
            .sandbox_id(1)
            .workspace_id("ws-test".into())
            .tcb_session_id(100)
            .draft_ruleset_hash("abc123".into())
            .state(serde_json::json!({}))
            .audit(serde_json::json!({"chain_length": 3, "verified": true}))
            .facts(facts)
            .build();

        assert_eq!(report.summary.total_cases, 3);
        assert_eq!(report.summary.passed, 2);
        assert_eq!(report.summary.failed, 1);
        assert!((report.summary.pass_rate - 0.667).abs() < 0.01);
        assert!(!report.report_hash.is_empty());
    }
}
```

---

## 10. P0 实施清单

| # | 任务 | 模块 | 依赖 | 工作量 |
|---|------|------|------|--------|
| 1 | 实现 SandboxService(start/close/report/list) | S1 | WORKSPACE_CRATE_DESIGN.md #4,#5,#6 | 2d |
| 2 | 扩展 SessionOps trait(audit/facts/causal) | M5 扩展 | #1 | 0.5d |
| 3 | evorule-server 实现 SessionOps 扩展方法 | server | #2 | 1d |
| 4 | 实现 MockIoResponder(最小化版) | S2 | #1 | 1d |
| 5 | 实现 TestReportBuilder + BLAKE3 签名 | S3 | #1 | 1d |
| 6 | 实现 6 个沙盒 API handler + Router | M6 扩展 | #1,#4,#5 | 1.5d |
| 7 | WorkspaceState 扩展 sandbox_service | api | #6 | 0.5d |
| 8 | 单元测试(MockSessionOps) | tests | #1,#5 | 1d |
| 9 | 集成测试(与真实 evorule-server fork) | tests | #3,#7 | 1.5d |

**合计**:约 10 人天,依赖 WORKSPACE_CRATE_DESIGN.md 完成后可并行启动。

---

## 11. P1 增强方向(不在 P0 做)

| # | 增强点 | 说明 |
|---|--------|------|
| 1 | MockIoResponder 直连通道 | 绕过 HTTP 轮询,直接注入 SessionApi 内部通道(更低延迟) |
| 2 | 测试报告自动 case 分组 | 按 case_id 聚合 Fact,而非每个 Fact 一个 case |
| 3 | 不变量自动检测 | 调用 `/api/sessions/{id}/invariants` 检测规则违反 |
| 4 | 沙盒对比模式 | 并行跑两个沙盒(旧规则 vs 新规则),diff 结果 |
| 5 | 合成数据 LLM 生成 | 用 LLM 根据业务场景描述批量生成测试 case |
| 6 | 容器化隔离 | 每个 Sandbox 起临时 Docker 容器(三层架构 §5.2 P2 方案) |
