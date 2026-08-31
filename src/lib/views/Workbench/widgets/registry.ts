// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 总览页 widget 注册表(UV-021 W1)——「一切皆 plugin」交互层首个落地。
//
// 注册即接入:新增卡片 = 写一个 widget 组件 + 在此追加一行,
// 渲染器(DashboardGrid)不感知具体 widget。
// 权限/角色/表面过滤与排序见 widget-registry-logic.ts(纯函数)。

import IdentityWidget from './IdentityWidget.svelte';
import MonitorSummaryWidget from './MonitorSummaryWidget.svelte';
import SystemStatusWidget from './SystemStatusWidget.svelte';
import StatsWidget from './StatsWidget.svelte';
import DecisionMakerWidget from './DecisionMakerWidget.svelte';
import QuickWidget from './QuickWidget.svelte';
import ActivityWidget from './ActivityWidget.svelte';
import JumpWidget from './JumpWidget.svelte';
import type { WidgetDef } from './types';

export const WIDGET_REGISTRY: readonly WidgetDef[] = [
	{
		id: 'identity',
		title: '我的工作区',
		icon: '🧭',
		span: 1,
		order: 10,
		component: IdentityWidget,
		surfaces: ['workbench'],
	},
	{
		id: 'monitor-summary',
		title: '生产运行摘要',
		icon: '📊',
		permission: 'view_monitor',
		span: 2,
		order: 11,
		component: MonitorSummaryWidget,
		surfaces: ['workbench'],
	},
	{
		id: 'system-status',
		title: '系统状态',
		icon: '🔌',
		span: 3,
		order: 20,
		component: SystemStatusWidget,
		surfaces: ['workbench'],
	},
	{
		id: 'stats',
		title: '统计',
		icon: '📈',
		span: 3,
		order: 30,
		component: StatsWidget,
		surfaces: ['workbench'],
	},
	{
		// 决策者视图(§7.1 裁定 a):角色白名单,demo exec/auditor + platform approver
		id: 'decision-maker',
		title: '决策者视图',
		icon: '🎯',
		roles: ['exec', 'auditor', 'approver'],
		span: 3,
		order: 40,
		component: DecisionMakerWidget,
		surfaces: ['workbench'],
	},
	{
		id: 'quick',
		title: '一键操作',
		icon: '⚡',
		span: 2,
		order: 50,
		component: QuickWidget,
		surfaces: ['workbench'],
	},
	{
		id: 'activity',
		title: '最近活动',
		icon: '🕘',
		span: 1,
		order: 60,
		component: ActivityWidget,
		surfaces: ['workbench'],
	},
	{
		id: 'jump',
		title: '快速跳单页',
		icon: '↗',
		span: 3,
		order: 70,
		component: JumpWidget,
		surfaces: ['workbench'],
	},
];
