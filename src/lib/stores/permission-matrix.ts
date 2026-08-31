// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 权限矩阵 store(纯数据 + 谓词,无 localStorage)。
// 5 角色 × 12 动作权限矩阵,P08 §5.2。
//
// 设计:
//   - 纯数据模块,无副作用,可被 auth.ts / 组件 / 路由守卫共享
//   - checkPermission 是谓词,不持有状态
//   - P0 不实现 scope(workspaceId/department)校验,只做角色级
//     (设计文档 §5.3 的 scope 校验在 P1+ 接真实后端时补)
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §5(权限矩阵详设)

/**
 * 权限动作清单(12 业务点 + 3 平台管理点 = 15)。
 * 与 evorule-server platform_auth::PLATFORM_ACTIONS 保持一一对应:
 *   - 业务 12 点(P08 §5.1 种子):demo 矩阵(ROLE_PERMISSIONS)覆盖
 *   - 平台管理 3 点(UV-017 新增):仅 platform 登录由服务端下发,
 *     demo 矩阵刻意不含 → 演示用户永远无法进入用户/角色管理
 */
export type PermissionAction =
	| 'view_monitor' // 查看监控大屏
	| 'view_audit_chain' // 查看审计链
	| 'intervene_runtime' // 干预运行时(暂停/调参/中断)
	| 'rollback_ruleset' // 紧急回滚
	| 'create_workspace' // 创建 Workspace
	| 'edit_draft' // 编辑 Draft(需 WS 成员)
	| 'review_in_workspace' // WS 内审核(需 reviewer)
	| 'submit_to_publish' // 提交到发布队列
	| 'start_sandbox' // 启动沙盒(需 WS 成员)
	| 'approve_publish' // 审批发布
	| 'view_publish_queue' // 查看发布队列
	| 'view_test_report' // 查看测试报告
	// 平台管理 3 点(UV-017,server 权限点注册表权威定义)
	| 'manage_users' // 用户管理(增删改/启停/改角色)
	| 'manage_roles' // 角色管理(自定义角色 + 权限集)
	| 'view_users'; // 查看用户列表(只读)

/** 平台管理 3 点(角色矩阵编辑器分组渲染用;demo 矩阵不含) */
export const PLATFORM_MANAGE_ACTIONS: PermissionAction[] = [
	'view_users',
	'manage_users',
	'manage_roles',
];

/** 5 角色(P08 §5.2) */
export type Role = 'user' | 'lead' | 'it' | 'exec' | 'auditor';

/** 角色中文标签(UI 显示用) */
export const ROLE_LABELS: Record<Role, string> = {
	user: '普通用户',
	lead: '科室主任',
	it: '信息科',
	exec: '院领导',
	auditor: '审计员',
};

/** 角色英文标签(简短标识) */
export const ROLE_SHORT_LABELS: Record<Role, string> = {
	user: 'User',
	lead: 'Lead',
	it: 'IT',
	exec: 'Exec',
	auditor: 'Auditor',
};

/**
 * 角色 → 动作 → 是否允许(无 scope 限制)。
 *
 * 矩阵来源:P08 §5.2
 *   - user(普通用户):看 + 编辑 Draft + 启动沙盒
 *   - lead(科室主任):user + WS 内审核 + 提交发布 + 看队列
 *   - it(信息科):看 + 干预 + 回滚 + 审批发布 + 看审计链 + 看队列
 *   - exec(院领导):同 it(P0 等同)
 *   - auditor(审计员):只读审计链 + 看监控
 */
export const ROLE_PERMISSIONS: Record<Role, Set<PermissionAction>> = {
	// 普通用户:看 + 编辑 Draft + 启动沙盒
	user: new Set<PermissionAction>([
		'view_monitor',
		'create_workspace',
		'edit_draft',
		'start_sandbox',
		'view_test_report',
	]),

	// 科室主任:普通用户 + WS 内审核 + 提交发布
	lead: new Set<PermissionAction>([
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
	it: new Set<PermissionAction>([
		'view_monitor',
		'view_audit_chain',
		'intervene_runtime',
		'rollback_ruleset',
		'approve_publish',
		'view_publish_queue',
		'view_test_report',
	]),

	// 院领导:同信息科(P0 等同)
	exec: new Set<PermissionAction>([
		'view_monitor',
		'view_audit_chain',
		'intervene_runtime',
		'rollback_ruleset',
		'approve_publish',
		'view_publish_queue',
		'view_test_report',
	]),

	// 审计员:只读审计链 + 看监控
	auditor: new Set<PermissionAction>(['view_monitor', 'view_audit_chain']),
};

/**
 * 检查权限(角色级,P0 不做 scope 校验)。
 *
 * P0 简化:仅查 ROLE_PERMISSIONS 矩阵。
 * P1+ 接真实后端时,补 §5.3 的 Workspace 成员校验 + 科室可见性校验。
 *
 * @param role 用户角色
 * @param action 权限动作
 * @returns 是否允许
 */
export function checkPermission(role: Role, action: PermissionAction): boolean {
	return ROLE_PERMISSIONS[role]?.has(action) === true;
}

/** 列出某角色拥有的全部动作(调试 / UI 展示用) */
export function listPermissions(role: Role): PermissionAction[] {
	return Array.from(ROLE_PERMISSIONS[role] ?? []);
}

/** 列出全部 12 个动作(调试 / 权限矩阵表格用) */
export function listAllActions(): PermissionAction[] {
	return [
		'view_monitor',
		'view_audit_chain',
		'intervene_runtime',
		'rollback_ruleset',
		'create_workspace',
		'edit_draft',
		'review_in_workspace',
		'submit_to_publish',
		'start_sandbox',
		'approve_publish',
		'view_publish_queue',
		'view_test_report',
	];
}

/** 列出全部 5 个角色 */
export function listAllRoles(): Role[] {
	return ['user', 'lead', 'it', 'exec', 'auditor'];
}
