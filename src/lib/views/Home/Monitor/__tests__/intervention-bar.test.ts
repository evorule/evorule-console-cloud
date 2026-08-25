// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 步骤8(处理运行时)单测:InterventionBar 纯逻辑层。
//
// 覆盖点:
//   T8-1: 动作枚举完整性(13 个动作,5 个分组)
//   T8-2: 二次确认文案完整性(13 动作都有 title/label/level)
//   T8-3: 权限映射覆盖(13 动作都映射到 PermissionAction)
//   T8-4: 5 角色 × 13 动作权限矩阵(与 ROLE_PERMISSIONS 一致)
//   T8-5: 未登录(role=null)全部禁止
//   T8-6: tooltip 文案与 canPerform 联动
//   T8-7: session.rollback 走 danger level(高危操作)
//   T8-8: 分组求和 = 13 个动作(无重复、无遗漏)

import { describe, test, expect } from 'vitest';
import {
	type InterventionAction,
	ACTION_TO_PERMISSION,
	ACTION_TO_CONFIRM,
	ACTION_SECTIONS,
	SECTION_ORDER,
	listAllActions,
	canPerform,
	permissionTooltip,
} from '../intervention-bar-logic';
import {
	listAllRoles,
	type Role,
	ROLE_PERMISSIONS,
} from '$lib/stores/permission-matrix';

// === T8-1: 动作完整性 ===
describe('T8-1 动作枚举完整性', () => {
	test('listAllActions 返回 13 个且无重复', () => {
		const actions = listAllActions();
		expect(actions).toHaveLength(13);
		expect(new Set(actions).size).toBe(13);
	});

	test('SECTION_ORDER 有 5 个分组', () => {
		expect(SECTION_ORDER).toHaveLength(5);
		expect(SECTION_ORDER).toEqual([
			'Reactor',
			'发布 / 审批',
			'Session',
			'IO / 心跳',
			'审计 / WAL',
		]);
	});
});

// === T8-8: 分组求和 = 13,无重复/遗漏 ===
describe('T8-8 分组完整性', () => {
	test('5 个分组合计 13 动作,且与 listAllActions 一致', () => {
		const flat: InterventionAction[] = [];
		for (const sec of SECTION_ORDER) {
			const arr = ACTION_SECTIONS[sec];
			expect(Array.isArray(arr)).toBe(true);
			flat.push(...arr);
		}
		expect(flat).toHaveLength(13);
		expect(new Set(flat).size).toBe(13);
		expect([...flat].sort()).toEqual([...listAllActions()].sort());
	});

	test('各分组大小符合预期(4/3/2/2/2)', () => {
		expect(ACTION_SECTIONS['Reactor']).toHaveLength(4);
		expect(ACTION_SECTIONS['发布 / 审批']).toHaveLength(3);
		expect(ACTION_SECTIONS['Session']).toHaveLength(2);
		expect(ACTION_SECTIONS['IO / 心跳']).toHaveLength(2);
		expect(ACTION_SECTIONS['审计 / WAL']).toHaveLength(2);
	});
});

// === T8-2: 二次确认文案 ===
describe('T8-2 二次确认文案', () => {
	test.each(listAllActions())(
		'动作 %s 有 title / confirmLabel / level,无空字符串',
		(action) => {
			const spec = ACTION_TO_CONFIRM[action];
			expect(spec).toBeDefined();
			expect(typeof spec.title).toBe('string');
			expect(spec.title.length).toBeGreaterThan(0);
			expect(typeof spec.confirmLabel).toBe('string');
			expect(spec.confirmLabel.length).toBeGreaterThan(0);
			expect(['info', 'warning', 'danger']).toContain(spec.level);
		},
	);

	test('message 字段:除 session.rollback 外均有非空字符串', () => {
		for (const action of listAllActions()) {
			const spec = ACTION_TO_CONFIRM[action];
			if (action === 'session.rollback') {
				// rollback 走版本选择器,不需通用 message
				expect(spec.message).toBeUndefined();
			} else {
				expect(typeof spec.message).toBe('string');
				expect((spec.message as string).length).toBeGreaterThan(0);
			}
		}
	});
});

// === T8-7: 高危操作 level ===
describe('T8-7 高危操作 level 断言', () => {
	test('session.rollback / io.cancel_all_pending 必须为 danger', () => {
		expect(ACTION_TO_CONFIRM['session.rollback'].level).toBe('danger');
		expect(ACTION_TO_CONFIRM['io.cancel_all_pending'].level).toBe('danger');
	});

	test('publish.approve_mode / reactor.pause / session.switch / reactor.check_invariants / wal.force_rotate 必须为 warning', () => {
		const warnings: InterventionAction[] = [
			'publish.approve_mode',
			'reactor.pause',
			'session.switch',
			'reactor.check_invariants',
			'wal.force_rotate',
			'reactor.resume',
		];
		// 注意:resume 实际是 info,上面数组剔除
		const expectedWarnings: InterventionAction[] = [
			'publish.approve_mode',
			'reactor.pause',
			'session.switch',
			'reactor.check_invariants',
			'wal.force_rotate',
		];
		for (const a of expectedWarnings) {
			expect(ACTION_TO_CONFIRM[a].level, a).toBe('warning');
		}
	});
});

// === T8-3: 权限映射覆盖 ===
describe('T8-3 13 动作 → PermissionAction 映射', () => {
	test('13 个动作都映射到了 PermissionAction(无 undefined)', () => {
		for (const a of listAllActions()) {
			expect(ACTION_TO_PERMISSION[a], `动作 ${a} 未配置权限映射`).toBeDefined();
		}
	});

	test('映射到 5 种不同的 PermissionAction(分类正确)', () => {
		const perms = new Set(Object.values(ACTION_TO_PERMISSION));
		// intervene_runtime / rollback_ruleset / approve_publish / submit_to_publish / view_audit_chain
		expect(perms.size).toBe(5);
		expect(perms.has('intervene_runtime')).toBe(true);
		expect(perms.has('rollback_ruleset')).toBe(true);
		expect(perms.has('approve_publish')).toBe(true);
		expect(perms.has('submit_to_publish')).toBe(true);
		expect(perms.has('view_audit_chain')).toBe(true);
	});

	test('intervene_runtime 覆盖 8 个动作(reactor4 + session.switch + io2 + wal)', () => {
		const count = Object.values(ACTION_TO_PERMISSION).filter(
			(p) => p === 'intervene_runtime',
		).length;
		expect(count).toBe(8);
	});
});

// === T8-4: 5 角色 × 13 动作权限矩阵 ===
describe('T8-4 5 角色权限矩阵', () => {
	// 期望的允许表(按 ROLE_PERMISSIONS 推导)
	const expectedAllowed: Record<Role, InterventionAction[]> = {
		// user: 只有 view_monitor/create_workspace/edit_draft/start_sandbox/view_test_report
		// → 13 个干预动作中,全部不允许(因为没有 intervene_runtime 等)
		user: [],
		// lead: user + review_in_workspace + submit_to_publish + view_publish_queue
		// → 允许: submit_to_publish 对应的 2 个(publish.start_session / publish.export_package)
		lead: ['publish.start_session', 'publish.export_package'],
		// it: intervene_runtime(8) + rollback_ruleset(1) + approve_publish(1=publish.approve_mode) + view_audit_chain(1=audit.export_chain)
		// → 注意:it 没有 submit_to_publish(只有 approve_publish),所以 publish.start_session/export_package 禁止
		it: [
			// Reactor 4(intervene_runtime)
			'reactor.pause',
			'reactor.resume',
			'reactor.gc',
			'reactor.check_invariants',
			// 发布 1(approve_publish → approve_mode),start/export 属于 submit_to_publish 没有
			'publish.approve_mode',
			// Session 2(session.switch → intervene; session.rollback → rollback_ruleset)
			'session.switch',
			'session.rollback',
			// IO 2(intervene_runtime)
			'io.cancel_all_pending',
			'io.inject_heartbeat',
			// 审计/WAL 2(audit.export_chain → view_audit_chain; wal → intervene)
			'audit.export_chain',
			'wal.force_rotate',
		],
		// exec: 同 it(P0 等同)
		exec: [
			'reactor.pause',
			'reactor.resume',
			'reactor.gc',
			'reactor.check_invariants',
			'publish.approve_mode',
			'session.switch',
			'session.rollback',
			'io.cancel_all_pending',
			'io.inject_heartbeat',
			'audit.export_chain',
			'wal.force_rotate',
		],
		// auditor: view_monitor + view_audit_chain → 仅 audit.export_chain 允许
		auditor: ['audit.export_chain'],
	};

	for (const role of listAllRoles()) {
		test(`角色(${role}) 允许的动作与 ROLE_PERMISSIONS 一致`, () => {
			const allowed = listAllActions().filter((a) => canPerform(role, a));
			expect([...allowed].sort()).toEqual([...expectedAllowed[role]].sort());
		});
	}

	// 定向断言:几个关键边界
	test('lead 角色不能 approve_publish(只有 it/exec 能审批)', () => {
		expect(canPerform('lead', 'publish.approve_mode')).toBe(false);
	});
	test('lead 角色不能 rollback(高危操作仅限 it/exec)', () => {
		expect(canPerform('lead', 'session.rollback')).toBe(false);
	});
	test('auditor 角色不能干预运行时(只读)', () => {
		for (const a of listAllActions()) {
			if (a !== 'audit.export_chain') {
				expect(canPerform('auditor', a), a).toBe(false);
			}
		}
	});
	test('auditor 角色允许导出审计链(view_audit_chain)', () => {
		expect(canPerform('auditor', 'audit.export_chain')).toBe(true);
	});

	// 直接基于 ROLE_PERMISSIONS 矩阵做一致性校验
	test('canPerform 与 checkPermission 在 PermissionAction 层一致', () => {
		for (const role of listAllRoles()) {
			for (const action of listAllActions()) {
				const perm = ACTION_TO_PERMISSION[action]!;
				const expected = ROLE_PERMISSIONS[role].has(perm);
				expect(canPerform(role, action), `${role} → ${action} (perm=${perm})`).toBe(expected);
			}
		}
	});
});

// === T8-5: 未登录(role=null) 全部禁止 ===
describe('T8-5 未登录全禁止', () => {
	test('role = null 时 13 动作全部 canPerform=false', () => {
		for (const a of listAllActions()) {
			expect(canPerform(null, a), a).toBe(false);
		}
	});
});

// === T8-6: tooltip 联动 ===
describe('T8-6 permissionTooltip 联动', () => {
	test('it 角色:11 个允许→空串,2 个(publish.start_session/export_package)→无权限', () => {
		const itAllowed = new Set([
			'reactor.pause', 'reactor.resume', 'reactor.gc', 'reactor.check_invariants',
			'publish.approve_mode',
			'session.switch', 'session.rollback',
			'io.cancel_all_pending', 'io.inject_heartbeat',
			'audit.export_chain', 'wal.force_rotate',
		]);
		for (const a of listAllActions()) {
			if (itAllowed.has(a)) {
				expect(permissionTooltip('it', a), a).toBe('');
			} else {
				expect(permissionTooltip('it', a), a).toBe('无权限(角色限制)');
			}
		}
	});
	test('auditor + reactor.pause → 无权限', () => {
		expect(permissionTooltip('auditor', 'reactor.pause')).toBe(
			'无权限(角色限制)',
		);
	});
	test('user + audit.export_chain → 无权限', () => {
		expect(permissionTooltip('user', 'audit.export_chain')).toBe(
			'无权限(角色限制)',
		);
	});
	test('auditor + audit.export_chain → 有权限 → 空串', () => {
		expect(permissionTooltip('auditor', 'audit.export_chain')).toBe('');
	});
	test('exec 角色同 it → publish.start_session 无权限', () => {
		expect(permissionTooltip('exec', 'publish.start_session')).toBe(
			'无权限(角色限制)',
		);
	});
	test('lead 角色 submit_to_publish 两动作 → 有权限', () => {
		expect(permissionTooltip('lead', 'publish.start_session')).toBe('');
		expect(permissionTooltip('lead', 'publish.export_package')).toBe('');
	});
	test('未登录(role=null) → 13 动作全部"无权限"', () => {
		for (const a of listAllActions()) {
			expect(permissionTooltip(null, a), a).toBe('无权限(角色限制)');
		}
	});
});
