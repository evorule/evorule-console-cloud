// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// AgentWorkspace 组件测试 — 三栏工作区(会话面板)
// 覆盖:未启用引导分支 / 三栏渲染 / 角色选择 / 连接徽标态 / 输入行禁用态 /
//      空态三型(无会话/未配置/不可达) / 新建会话 / 发送与流式渲染全链 / 刷新恢复续接
// 组件级 DOM 测试需 jsdom 环境(仓库既有单测默认 node,不动;此处按文件声明)
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { screen } from '@testing-library/dom';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import AgentWorkspace from './AgentWorkspace.svelte';
import { agentConfig, isAgentConfigured, type AgentConfig } from '$lib/config/agent-config';
import {
  resetAgentSessions,
  createSession,
  attachSessionId
} from '$lib/agent/agent-sessions';
import type { AgentClientOptions } from '$lib/agent/agent-client';

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

/** 客户端桩工厂:捕获建连参数,connect 行为可编排(供事件回放) */
interface StubClient {
	options: AgentClientOptions;
	connect: ReturnType<typeof vi.fn>;
	send: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
}

function makeStubFactory(opts?: { connectReject?: Error }) {
	const stubs: StubClient[] = [];
	const factory = (options: AgentClientOptions): StubClient => {
		const stub: StubClient = {
			options,
			connect: vi.fn(async () => {
				if (opts?.connectReject) {
					// 对齐真客户端:终态先经 onStatus 收敛(组件据其呈现空态/错误),connect 再拒绝
					options.onStatus('disconnected', { error: 'connect-failed' });
					throw opts.connectReject;
				}
				options.onStatus('connected', { sessionId: options.sessionId });
			}),
			send: vi.fn(),
			close: vi.fn()
		};
		stubs.push(stub);
		return stub;
	};
	return { factory, stubs };
}

async function typeAndSend(container: HTMLElement, text: string): Promise<void> {
	const textarea = container.querySelector('.rinput textarea') as HTMLTextAreaElement;
	fireEvent.input(textarea, { target: { value: text } });
	// 等输入态派生(发送键解禁)落 DOM 后再点击,否则禁用键吞点击
	await tick();
	fireEvent.click(screen.getByText('发送'));
}

afterEach(() => {
	cleanup();
	setCfg({});
	resetAgentSessions();
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
		// 中栏双徽标:[0]=会话徽标 [1]=角色徽标(未建立会话时会话徽标显示占位文案)
		const midChips = container.querySelectorAll('.mh .chp.mono');
		expect(midChips.length).toBe(2);
		expect(midChips[1].textContent?.trim()).toBe('researcher');
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

	it('输入行整行禁用(无选中会话;后续选中会话后激活)', () => {
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

describe('AgentWorkspace — 空态三型', () => {
	it('无会话:对话流空态带「新建会话」CTA,点击产生草稿条目并选中', async () => {
		setCfg({ enabled: true });
		const { container } = render(AgentWorkspace);
		expect(screen.getByText('还没有会话')).toBeTruthy();
		fireEvent.click(screen.getByText('新建会话'));
		await tick();
		expect(container.querySelector('.emp')).toBeNull();
		const sit = container.querySelector('.sit') as HTMLElement;
		expect(sit).toBeTruthy();
		expect(sit.querySelector('.n')?.textContent).toBe('新会话');
		expect(sit.querySelector('.m')?.textContent).toBe('general');
		// 草稿选中:输入行解锁
		const textarea = container.querySelector('.rinput textarea') as HTMLTextAreaElement;
		expect(textarea.disabled).toBe(false);
	});

	it('未配置(enabled 但 baseUrl 空):空态引导前往设置', () => {
		setCfg({ enabled: true, baseUrl: '' });
		const { container } = render(AgentWorkspace);
		expect(screen.getByText('尚未配置连接')).toBeTruthy();
		const cta = container.querySelector('.emp-cta') as HTMLAnchorElement;
		expect(cta.getAttribute('href')).toContain('openSettings=agent');
		// 未配置时「+ 新建」禁用(建会话无意义)
		const newBtn = screen.getByText('+ 新建') as HTMLButtonElement;
		expect(newBtn.disabled).toBe(true);
	});

	it('不可达:首连失败呈现不可达空态+会话条目红点,可重试', async () => {
		setCfg({ enabled: true });
		const { factory, stubs } = makeStubFactory({ connectReject: new Error('connect-failed') });
		const { container } = render(AgentWorkspace, { props: { createClient: factory } });
		fireEvent.click(screen.getByText('新建会话'));
		await tick();
		await typeAndSend(container, '写个模块');
		await vi.waitFor(() => expect(screen.getByText('连接不可达')).toBeTruthy());
		expect(stubs[0].options.agentType).toBe('general');
		expect(stubs[0].options.sessionId).toBeUndefined();
		expect(screen.getByText('重试连接')).toBeTruthy();
		// 会话条目断线红点
		expect(container.querySelector('.sit.dead')).toBeTruthy();
	});
});

describe('AgentWorkspace — 发送与流式渲染', () => {
	it('发送 → 用户气泡 → LlmDelta 流式 → 工具 chips → Done 汇总,轮次内发送禁用', async () => {
		setCfg({ enabled: true });
		const { factory, stubs } = makeStubFactory();
		const { container } = render(AgentWorkspace, { props: { createClient: factory } });
		fireEvent.click(screen.getByText('新建会话'));
		await tick();
		await typeAndSend(container, '写个参数校验模块');
		await vi.waitFor(() => expect(stubs[0].send).toHaveBeenCalledWith('写个参数校验模块'));
		await tick();
		// 用户气泡 + 轮次进行中发送禁用
		expect(container.querySelector('.msg.u')?.textContent).toBe('写个参数校验模块');
		const sendBtn = screen.getByText('发送') as HTMLButtonElement;
		expect(sendBtn.disabled).toBe(true);
		// 草稿首条消息回填标题
		const sit = container.querySelector('.sit') as HTMLElement;
		expect(sit.querySelector('.n')?.textContent).toBe('写个参数校验模块');

		const ev = stubs[0].options.onEvent;
		ev({ type: 'LlmDelta', text: '好的,' });
		ev({ type: 'LlmDelta', text: '我来实现。' });
		await tick();
		const agentMsg = container.querySelector('.msg.a') as HTMLElement;
		expect(agentMsg.textContent).toContain('好的,我来实现。');
		expect(agentMsg.querySelector('.crt')).toBeTruthy(); // 流式光标

		ev({ type: 'ToolCall', name: 'file_read', args: { path: 'src/a.rs' } });
		await tick();
		let chip = container.querySelector('.chip') as HTMLElement;
		expect(chip.textContent).toBe('file_read …');
		expect(chip.classList.contains('hl')).toBe(true);

		ev({ type: 'ToolResult', name: 'file_read', result: 'ok' });
		await tick();
		chip = container.querySelector('.chip') as HTMLElement;
		expect(chip.textContent).toBe('file_read ✓');
		expect(chip.classList.contains('hl')).toBe(false);

		ev({ type: 'SessionCreated', session_id: 'session_9f3a2c' });
		ev({ type: 'Done', success: true, content: '', steps: 3, duration_ms: 4200 });
		await tick();
		expect(container.querySelector('.msg.a .crt')).toBeNull(); // 光标收起
		expect(screen.getByText('✔ 本轮完成 · 3 步 · 耗时 4s')).toBeTruthy();
		// 会话徽标回填 + 条目 meta 更新
		expect(sit.querySelector('.m')?.textContent).toBe('general · v1');
		const midChips = container.querySelectorAll('.mh .chp.mono');
		expect(midChips[0].textContent).toBe('session_9f3a2c');
	});

	it('Error 事件:关闭流式光标并呈现错误卡,轮次解除', async () => {
		setCfg({ enabled: true });
		const { factory, stubs } = makeStubFactory();
		const { container } = render(AgentWorkspace, { props: { createClient: factory } });
		fireEvent.click(screen.getByText('新建会话'));
		await tick();
		await typeAndSend(container, '任务');
		await vi.waitFor(() => expect(stubs[0].send).toHaveBeenCalled());
		const ev = stubs[0].options.onEvent;
		ev({ type: 'LlmDelta', text: '部分输出' });
		ev({ type: 'Error', error: 'a turn is already active' });
		await tick();
		expect(container.querySelector('.msg.a .crt')).toBeNull();
		const errc = container.querySelector('.errc') as HTMLElement;
		expect(errc.textContent).toContain('执行出错:a turn is already active');
	});
});

describe('AgentWorkspace — 刷新恢复(续接)', () => {
	it('历史会话点击选中,发送时按会话 ID 续接并呈现续接提示行', async () => {
		setCfg({ enabled: true });
		const s = createSession('rule-copilot', '检索 ADR 案例');
		attachSessionId(s.localId, 'session_9f3a2c');
		const { factory, stubs } = makeStubFactory();
		const { container } = render(AgentWorkspace, { props: { createClient: factory } });
		// 列表恢复:条目 meta 显示角色与版本
		const sit = container.querySelector('.sit') as HTMLElement;
		expect(sit.querySelector('.n')?.textContent).toBe('检索 ADR 案例');
		expect(sit.querySelector('.m')?.textContent).toBe('rule-copilot · v1');
		// 点击选中(刷新后未选中:输入行禁用)
		expect((container.querySelector('.rinput textarea') as HTMLTextAreaElement).disabled).toBe(true);
		fireEvent.click(sit);
		await tick();
		expect((container.querySelector('.rinput textarea') as HTMLTextAreaElement).disabled).toBe(false);
		await typeAndSend(container, '继续上轮');
		await vi.waitFor(() => expect(stubs[0].send).toHaveBeenCalledWith('继续上轮'));
		// 续接参数:按既有会话 ID 建连
		expect(stubs[0].options.sessionId).toBe('session_9f3a2c');
		expect(stubs[0].options.agentType).toBe('rule-copilot');
		await tick();
		expect(screen.getByText('已续接会话 session_9f3a2c,上下文保留')).toBeTruthy();
	});
});
