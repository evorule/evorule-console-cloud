// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// AgentWorkspace 组件测试 — 三栏骨架
// 覆盖:未启用引导分支 / 三栏渲染 / 角色选择 / 连接徽标态 / 输入行禁用态
// 组件级 DOM 测试需 jsdom 环境(仓库既有单测默认 node,不动;此处按文件声明)
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { screen } from '@testing-library/dom';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import AgentWorkspace from './AgentWorkspace.svelte';
import { agentConfig, isAgentConfigured, type AgentConfig } from '$lib/config/agent-config';

function setCfg(partial: Partial<AgentConfig>): void {
	agentConfig.set({
		enabled: false,
		baseUrl: 'http://127.0.0.1:8081',
		authToken: '',
		tokenStorage: 'none',
		locked: false,
		...partial
	});
}

afterEach(() => {
	cleanup();
	setCfg({});
});

describe('AgentWorkspace — 未启用分支', () => {
	it('enabled=false:渲染启用引导,不渲染三栏', () => {
		setCfg({ enabled: false });
		const { container } = render(AgentWorkspace);
		expect(screen.getByText('Agent 会话台未启用')).toBeTruthy();
		expect(container.querySelector('.agent-shell')).toBeNull();
	});

	it('引导 CTA 指向设置面板(?openSettings=agent)', () => {
		setCfg({ enabled: false });
		const { container } = render(AgentWorkspace);
		const cta = container.querySelector<HTMLAnchorElement>('.d-cta');
		expect(cta).toBeTruthy();
		expect(cta?.getAttribute('href')).toContain('openSettings=agent');
	});
});

describe('AgentWorkspace — 三栏骨架', () => {
	it('enabled=true:三栏齐备(会话/角色/工作区 | 执行过程 | 会话流)', () => {
		setCfg({ enabled: true });
		const { container } = render(AgentWorkspace);
		expect(container.querySelector('.agent-shell')).toBeTruthy();
		expect(container.querySelector('.lcol')).toBeTruthy();
		expect(container.querySelector('.mcol')).toBeTruthy();
		expect(container.querySelector('.rcol')).toBeTruthy();
		// 左栏:会话空态 + 角色区 + 工作区灰显(P2 标注)
		expect(screen.getByText('暂无会话')).toBeTruthy();
		expect(screen.getByText('角色')).toBeTruthy();
		expect(screen.getByText('P2')).toBeTruthy();
		// 中栏:执行过程头部 + 时间线空态 + 审计页入口
		expect(screen.getByText('执行过程')).toBeTruthy();
		expect(screen.getByText('暂无执行记录')).toBeTruthy();
		expect(screen.getByText('在审计页查看 ↗')).toBeTruthy();
		// 右栏:会话流 + 输入行(发送/停止)
		expect(screen.getByText('会话流')).toBeTruthy();
		expect(screen.getByText('发送')).toBeTruthy();
		expect(screen.getByText('停止')).toBeTruthy();
	});

	it('P1 固定角色三枚(researcher/rule-copilot/general),点击切换选中态并同步中栏徽标', async () => {
		setCfg({ enabled: true });
		const { container } = render(AgentWorkspace);
		const roleButtons = Array.from(container.querySelectorAll('.role-item'));
		expect(roleButtons.map((b) => b.textContent?.trim())).toEqual([
			'researcher',
			'rule-copilot',
			'general'
		]);
		// 默认选中 general
		const general = roleButtons.find((b) => b.textContent?.trim() === 'general') as HTMLElement;
		expect(general.classList.contains('on')).toBe(true);
		// 切到 researcher:选中态迁移,中栏角色徽标同步(Svelte 5 批量更新,await tick 落 DOM)
		const researcher = roleButtons.find((b) => b.textContent?.trim() === 'researcher') as HTMLElement;
		fireEvent.click(researcher);
		await tick();
		expect(researcher.classList.contains('on')).toBe(true);
		expect(general.classList.contains('on')).toBe(false);
		const midChip = container.querySelector('.mh .chp.mono');
		expect(midChip?.textContent?.trim()).toBe('researcher');
	});

	it('已配置(enabled+baseUrl):徽标为黄态「未连接」(断线显式非静默)', () => {
		setCfg({ enabled: true, baseUrl: 'http://127.0.0.1:8081' });
		expect(isAgentConfigured(get(agentConfig))).toBe(true);
		const { container } = render(AgentWorkspace);
		const conn = container.querySelector('.conn') as HTMLElement;
		expect(conn.textContent).toContain('未连接');
		expect(conn.classList.contains('warn')).toBe(true);
		expect(conn.classList.contains('bad')).toBe(false);
	});

	it('enabled 但 baseUrl 为空:徽标为红态「未配置」', () => {
		setCfg({ enabled: true, baseUrl: '' });
		const { container } = render(AgentWorkspace);
		const conn = container.querySelector('.conn') as HTMLElement;
		expect(conn.textContent).toContain('未配置');
		expect(conn.classList.contains('bad')).toBe(true);
	});

	it('输入行整行禁用(骨架态;后续任务接 AgentClient 后激活)', () => {
		setCfg({ enabled: true });
		const { container } = render(AgentWorkspace);
		const textarea = container.querySelector('.rinput textarea') as HTMLTextAreaElement;
		expect(textarea.disabled).toBe(true);
		const send = screen.getByText('发送') as HTMLButtonElement;
		const stop = screen.getByText('停止') as HTMLButtonElement;
		expect(send.disabled).toBe(true);
		expect(stop.disabled).toBe(true);
	});
});
