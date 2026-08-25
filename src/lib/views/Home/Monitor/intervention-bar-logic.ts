// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 干预栏纯逻辑(InterventionBar 组件的纯函数化抽出层)。
//
// 职责:
//   - 13 动作 → PermissionAction 权限映射(P08 §5.2 + P05 §6.3)
//   - 13 动作 → 二次确认文案(标题/消息/level/按钮 label)
//   - 角色 → 每个动作是否可点(谓词,纯函数)
//
// 设计:
//   - 完全纯函数,无副作用(不读 store,不读 DOM),方便 vitest 单元测试
//   - 组件层(InterventionBar.svelte)只做薄包装:调用这里的函数 + 渲染 UI
//   - P0 scope 校验不做(只做角色级),与 permission-matrix 一致
//
// 关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §6.3(13 按钮 + 二次确认)
//          P08_COLLAB_WORKFLOW_DESIGN.md §5(权限矩阵)

import {
	type Role,
	type PermissionAction,
	checkPermission,
} from '$lib/stores/permission-matrix';

/** 13 个干预动作(与 InterventionBar.svelte 保持一一对应) */
export type InterventionAction =
	| 'reactor.pause'
	| 'reactor.resume'
	| 'reactor.gc'
	| 'reactor.check_invariants'
	| 'publish.start_session'
	| 'publish.approve_mode'
	| 'publish.export_package'
	| 'session.switch'
	| 'session.rollback'
	| 'io.cancel_all_pending'
	| 'io.inject_heartbeat'
	| 'audit.export_chain'
	| 'wal.force_rotate';

/** 二次确认对话框的 level */
export type ConfirmLevel = 'info' | 'warning' | 'danger';

/** 二次确认参数(组件层用 openConfirm() 消费) */
export interface ConfirmSpec {
	title: string;
	message: string | undefined;
	level: ConfirmLevel;
	confirmLabel: string;
}

/**
 * 13 动作 → PermissionAction 映射(P05 §6.3 + P08 §6.3)。
 *
 * 映射规则:
 *   - reactor.* / session.switch / io.* / wal.force_rotate → intervene_runtime
 *   - session.rollback → rollback_ruleset
 *   - publish.approve_mode → approve_publish
 *   - publish.start_session / publish.export_package → submit_to_publish
 *   - audit.export_chain → view_audit_chain
 */
export const ACTION_TO_PERMISSION: Readonly<
	Partial<Record<InterventionAction, PermissionAction>>
> = {
	'reactor.pause': 'intervene_runtime',
	'reactor.resume': 'intervene_runtime',
	'reactor.gc': 'intervene_runtime',
	'reactor.check_invariants': 'intervene_runtime',
	'publish.start_session': 'submit_to_publish',
	'publish.approve_mode': 'approve_publish',
	'publish.export_package': 'submit_to_publish',
	'session.switch': 'intervene_runtime',
	'session.rollback': 'rollback_ruleset',
	'io.cancel_all_pending': 'intervene_runtime',
	'io.inject_heartbeat': 'intervene_runtime',
	'audit.export_chain': 'view_audit_chain',
	'wal.force_rotate': 'intervene_runtime',
};

/**
 * 13 动作 → 二次确认文案(P05 §6.3)。
 * 每条文案语义:告知用户该操作的业务影响,辅助"是否继续"决策。
 */
export const ACTION_TO_CONFIRM: Readonly<
	Record<InterventionAction, ConfirmSpec>
> = {
	'reactor.pause': {
		title: '暂停 Reactor?',
		message: '将停止所有规则执行,已开始的 step 会完成。可恢复。',
		level: 'warning',
		confirmLabel: '暂停',
	},
	'reactor.resume': {
		title: '恢复 Reactor?',
		message: '继续处理待执行队列。',
		level: 'info',
		confirmLabel: '恢复',
	},
	'reactor.gc': {
		title: '手动触发 GC?',
		message: '回收死对象和过期缓存(异步)。',
		level: 'info',
		confirmLabel: '执行 GC',
	},
	'reactor.check_invariants': {
		title: '触发不变量检查?',
		message: '扫描所有结构不变量,发现违规会追加 Anomaly。',
		level: 'warning',
		confirmLabel: '开始检查',
	},
	'publish.start_session': {
		title: '创建发布会话?',
		message: '创建临时 publish session,当前 ruleset 会作为基线。',
		level: 'info',
		confirmLabel: '创建',
	},
	'publish.approve_mode': {
		title: '切换为审批模式?',
		message: '所有 publish 动作需经过审批队列(Doctor → DepartmentHead → Admin)。',
		level: 'warning',
		confirmLabel: '开启审批',
	},
	'publish.export_package': {
		title: '导出当前发布包?',
		message: '将当前 ruleset + 元数据打包为 JSON 下载。',
		level: 'info',
		confirmLabel: '导出',
	},
	'session.switch': {
		title: '手动切换 Session?',
		message: '主动触发一次滚动 session 切换(不等发布)。',
		level: 'warning',
		confirmLabel: '切换',
	},
	// session.rollback 走 RollbackVersionPicker(选版本),不用通用 ConfirmDialog
	'session.rollback': {
		title: '紧急回滚到历史版本?',
		message: undefined,
		level: 'danger',
		confirmLabel: '回滚',
	},
	'io.cancel_all_pending': {
		title: '取消全部待处理 IO?',
		message:
			'所有 awaiting_io 状态的 IO request 将被标记为 canceled。可能产生业务影响。',
		level: 'danger',
		confirmLabel: '确认取消',
	},
	'io.inject_heartbeat': {
		title: '注入心跳 Fact?',
		message: '往 reactor 注入一条 type=heartbeat 的 Fact,用于验证链路通畅。',
		level: 'info',
		confirmLabel: '注入',
	},
	'audit.export_chain': {
		title: '导出审计链?',
		message: '将完整 BLAKE3 审计链导出为 JSON 文件(含哈希校验)。',
		level: 'info',
		confirmLabel: '导出',
	},
	'wal.force_rotate': {
		title: '强制轮换 WAL?',
		message: '立即关闭当前 WAL 文件并创建新文件。用于磁盘管理与归档。',
		level: 'warning',
		confirmLabel: '轮换',
	},
};

/** 列出全部 13 动作(测试 / UI 枚举用) */
export function listAllActions(): InterventionAction[] {
	return [
		'reactor.pause',
		'reactor.resume',
		'reactor.gc',
		'reactor.check_invariants',
		'publish.start_session',
		'publish.approve_mode',
		'publish.export_package',
		'session.switch',
		'session.rollback',
		'io.cancel_all_pending',
		'io.inject_heartbeat',
		'audit.export_chain',
		'wal.force_rotate',
	];
}

/**
 * 判断某角色是否有权执行某动作。
 *
 * 语义:未登录(role = null)→ 全禁止。
 * 映射未命中(ACTION_TO_PERMISSION 没配置)→ 默认允许(P0 宽松,避免未映射动作被误锁)。
 *
 * @param role 角色(=null 表示未登录)
 * @param action 13 个动作之一
 */
export function canPerform(
	role: Role | null,
	action: InterventionAction,
): boolean {
	const perm = ACTION_TO_PERMISSION[action];
	if (!perm) return true; // 未映射 → 允许(P0 策略)
	if (!role) return false; // 未登录 → 全禁止
	return checkPermission(role, perm);
}

/** 无权限时的 tooltip 文案(与 canPerform 成对使用) */
export function permissionTooltip(
	role: Role | null,
	action: InterventionAction,
): string {
	return canPerform(role, action) ? '' : '无权限(角色限制)';
}

/**
 * 动作分组(UI 层 section 划分,与 InterventionBar.svelte 顺序一致)。
 * 用于测试是否覆盖了 5 个 section 共 13 按钮。
 */
export const ACTION_SECTIONS: Readonly<
	Record<string, InterventionAction[]>
> = {
	Reactor: [
		'reactor.pause',
		'reactor.resume',
		'reactor.gc',
		'reactor.check_invariants',
	],
	'发布 / 审批': [
		'publish.start_session',
		'publish.approve_mode',
		'publish.export_package',
	],
	Session: ['session.switch', 'session.rollback'],
	'IO / 心跳': ['io.cancel_all_pending', 'io.inject_heartbeat'],
	'审计 / WAL': ['audit.export_chain', 'wal.force_rotate'],
};

/** 分组名列表(顺序与 UI 一致) */
export const SECTION_ORDER: Readonly<string[]> = [
	'Reactor',
	'发布 / 审批',
	'Session',
	'IO / 心跳',
	'审计 / WAL',
];
