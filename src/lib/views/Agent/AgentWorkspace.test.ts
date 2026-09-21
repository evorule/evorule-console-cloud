// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// AgentWorkspace 组件测试 — 三栏工作区(会话面板)
// 覆盖:未启用引导分支 / 三栏渲染 / 角色选择 / 连接徽标态 / 输入行禁用态 /
//      空态三型(无会话/未配置/不可达) / 新建会话 / 发送与流式渲染全链 / 刷新恢复续接
// 组件级 DOM 测试需 jsdom 环境(仓库既有单测默认 node,不动;此处按文件声明)
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { screen } from '@testing-library/dom';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import AgentWorkspace from './AgentWorkspace.svelte';
import { agentConfig, isAgentConfigured, type AgentConfig } from '$lib/config/agent-config';
import {
  agentSessions,
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
	interrupt: ReturnType<typeof vi.fn>;
	rewind: ReturnType<typeof vi.fn>;
	approve: ReturnType<typeof vi.fn>;
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
			interrupt: vi.fn(),
			rewind: vi.fn(),
			approve: vi.fn(async () => {}),
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
	vi.useRealTimers();
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
		// 汇总双呈现:右栏汇总行 + 中栏汇总条(同一文案)
		expect(screen.getAllByText('✔ 本轮完成 · 3 步 · 耗时 4s').length).toBe(2);
		expect(container.querySelector('.mcol .donebar')).toBeTruthy();
		// 会话徽标回填 + 条目 meta 更新(Done 完成即推进版本指针:1 → 2)
		expect(sit.querySelector('.m')?.textContent).toBe('general · v2');
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

	/** 时间线/审批卡用例的公共链路:建会话 → 发送 → 已连接(可直接回放事件) */
	async function setupConnected(text = '任务'): Promise<{
		container: HTMLElement;
		stubs: StubClient[];
		ev: StubClient['options']['onEvent'];
	}> {
		setCfg({ enabled: true });
		const { factory, stubs } = makeStubFactory();
		const { container } = render(AgentWorkspace, { props: { createClient: factory } });
		fireEvent.click(screen.getByText('新建会话'));
		await tick();
		await typeAndSend(container, text);
		await vi.waitFor(() => expect(stubs[0].send).toHaveBeenCalled());
		return { container, stubs, ev: stubs[0].options.onEvent };
	}

	describe('AgentWorkspace — 执行时间线(中栏)', () => {
		it('ToolCall → 运行中条目;ToolResult → 成功;点击条目展开参数/结果详情', async () => {
			const { container, ev } = await setupConnected();
			ev({ type: 'ToolCall', name: 'file_read', args: { path: 'src/a.rs' } });
			await tick();
			const te = container.querySelector('.mcol .te') as HTMLElement;
			expect(te).toBeTruthy();
			expect(te.querySelector('.tn')?.textContent).toBe('file_read');
			expect(te.querySelector('.ta')?.textContent).toBe('path=src/a.rs');
			const bd = te.querySelector('.bd') as HTMLElement;
			expect(bd.classList.contains('run')).toBe(true);
			expect(bd.textContent).toContain('运行中');

			ev({ type: 'ToolResult', name: 'file_read', result: { lines: 216 } });
			await tick();
			expect((te.querySelector('.bd') as HTMLElement).classList.contains('ok')).toBe(true);

			// 手风琴:点击头部展开详情,再点收起
			expect(container.querySelector('.mcol .ted')).toBeNull();
			fireEvent.click(te.querySelector('.teh') as HTMLElement);
			await tick();
			const ted = container.querySelector('.mcol .ted') as HTMLElement;
			expect(ted.textContent).toContain('参数');
			expect(ted.textContent).toContain('{"path":"src/a.rs"}');
			expect(ted.textContent).toContain('结果');
			expect(ted.textContent).toContain('{"lines":216}');
			fireEvent.click(te.querySelector('.teh') as HTMLElement);
			await tick();
			expect(container.querySelector('.mcol .ted')).toBeNull();
		});
	});

	describe('AgentWorkspace — 审批卡', () => {
		const shellArgs = {
			type: 'ApprovalRequired' as const,
			tool_name: 'shell_exec',
			command: 'cargo test -p evo-agent --lib',
			risk: 'medium',
			alternative: ''
		};

		it('ApprovalRequired:右栏倒计时卡(待审批+命令+批准/拒绝),中栏条目转待审批', async () => {
			const { container, ev } = await setupConnected();
			ev({ type: 'ToolCall', name: 'shell_exec', args: { command: shellArgs.command } });
			ev(shellArgs);
			await tick();
			// 右栏卡片
			const card = container.querySelector('.rcol .apv') as HTMLElement;
			expect(card).toBeTruthy();
			expect(card.querySelector('.apv-h')?.textContent).toContain('待审批 · shell_exec');
			expect(card.querySelector('.apv-cmd')?.textContent).toBe('cargo test -p evo-agent --lib');
			expect(card.querySelector('.apv-mt')?.textContent).toContain('medium · 超时 60s 自动拒绝');
			expect(screen.getByText('批准')).toBeTruthy();
			expect(screen.getByText('拒绝')).toBeTruthy();
			// 中栏条目 run → wait
			const bd = container.querySelector('.mcol .te .bd') as HTMLElement;
			expect(bd.classList.contains('wait')).toBe(true);
			expect(bd.textContent).toContain('待审批');
		});

		it('批准链路:点批准 → REST approve(true) → ApprovalResult 回推收敛(卡片绿态+中栏续跑)', async () => {
			const { container, stubs, ev } = await setupConnected();
			ev(shellArgs);
			await tick();
			fireEvent.click(screen.getByText('批准'));
			await tick();
			expect(stubs[0].approve).toHaveBeenCalledWith(true);
			// 服务端回执前卡片保持等待(以服务端回推为准)
			expect((container.querySelector('.rcol .apv') as HTMLElement).classList.contains('apv')).toBe(true);
			ev({ type: 'ApprovalResult', tool_name: 'shell_exec', approved: true });
			await tick();
			expect(screen.getByText('✔ 已批准 · 正在执行 cargo test -p evo-agent --lib…')).toBeTruthy();
			const bd = container.querySelector('.mcol .te .bd') as HTMLElement;
			expect(bd.classList.contains('run')).toBe(true);
			// 续跑完成:ToolResult → 成功
			ev({ type: 'ToolResult', name: 'shell_exec', result: '5 passed' });
			await tick();
			expect((container.querySelector('.mcol .te .bd') as HTMLElement).classList.contains('ok')).toBe(true);
		});

		it('拒绝链路:点拒绝 → approve(false) → 回执后卡片红态+中栏「已拒绝·跳过」', async () => {
			const { container, stubs, ev } = await setupConnected();
			ev(shellArgs);
			await tick();
			fireEvent.click(screen.getByText('拒绝'));
			await tick();
			expect(stubs[0].approve).toHaveBeenCalledWith(false);
			ev({ type: 'ApprovalResult', tool_name: 'shell_exec', approved: false });
			await tick();
			expect(screen.getByText('✕ 已拒绝 · agent 已收到拒绝信号')).toBeTruthy();
			const bd = container.querySelector('.mcol .te .bd') as HTMLElement;
			expect(bd.classList.contains('skip')).toBe(true);
			expect(bd.textContent).toContain('已拒绝·跳过');
		});

		it('60s 超时:倒计时归零卡片转灰态超时,中栏「已超时·跳过」;迟到回执不再改写', async () => {
			vi.useFakeTimers();
			const { container, ev } = await setupConnected();
			ev(shellArgs);
			await tick();
			vi.advanceTimersByTime(61_000);
			await tick();
			expect(screen.getByText('⏱ 已超时自动拒绝 · 续接会话可重试')).toBeTruthy();
			const bd = container.querySelector('.mcol .te .bd') as HTMLElement;
			expect(bd.classList.contains('skip')).toBe(true);
			expect(bd.textContent).toContain('已超时·跳过');
			// 迟到的拒绝回执:卡片保持超时态,不产生重复收敛
			ev({ type: 'ApprovalResult', tool_name: 'shell_exec', approved: false });
			await tick();
			expect(screen.getByText('⏱ 已超时自动拒绝 · 续接会话可重试')).toBeTruthy();
			expect(container.querySelectorAll('.mcol .te').length).toBe(1);
		});

		it('审批送达失败:呈现错误卡,卡片保持等待继续倒计时', async () => {
			const { container, stubs, ev } = await setupConnected();
			stubs[0].approve.mockRejectedValueOnce(new Error('approve-http-503'));
			ev(shellArgs);
			await tick();
			fireEvent.click(screen.getByText('批准'));
			await tick();
			const errc = container.querySelector('.rcol .errc') as HTMLElement;
			expect(errc.textContent).toContain('审批送达失败:approve-http-503');
			// 卡片未收敛,等待服务端回执/超时兜底
			expect(container.querySelector('.rcol .apv')).toBeTruthy();
		});
	});

	describe('AgentWorkspace — 执行控制(停止/回滚)与审计深链', () => {
		it('停止全链:interrupt 帧送达;Info/Error 收敛帧静默;Done(cancelled) 中断卡+时间线已停止+回滚条', async () => {
			const { container, stubs, ev } = await setupConnected();
			ev({ type: 'ToolCall', name: 'file_read', args: { path: 'src/a.rs' } });
			await tick();
			const stop = screen.getByText('停止') as HTMLButtonElement;
			expect(stop.disabled).toBe(false);
			fireEvent.click(stop);
			await tick();
			expect(stubs[0].interrupt).toHaveBeenCalled();
			// 收敛序列静默帧:Info "interrupt sent" 不渲染对话流
			ev({ type: 'Info', message: 'interrupt sent' });
			await tick();
			expect(container.textContent).not.toContain('interrupt sent');
			// Error "cancelled by user" 不渲染错误卡,但轮次已解锁(turnRunning=false)
			ev({ type: 'Error', error: 'Internal error: cancelled by user' });
			await tick();
			expect(container.querySelector('.errc')).toBeNull();
			// Done(cancelled) 权威收敛:中断卡 + 时间线已停止 + 版本照常 +1 → 回滚条出现
			ev({ type: 'SessionCreated', session_id: 'session_stop' });
			ev({ type: 'Done', success: false, content: '', steps: 2, duration_ms: 2000, cancelled: true });
			await tick();
			const intc = container.querySelector('.intc') as HTMLElement;
			expect(intc.textContent).toContain('已中断');
			expect(intc.textContent).toContain('已完成 2 步保留');
			const bd = container.querySelector('.mcol .te .bd') as HTMLElement;
			expect(bd.classList.contains('skip')).toBe(true);
			expect(bd.textContent).toContain('已停止');
			expect(container.querySelector('.rbar')).toBeTruthy();
			expect((screen.getByText('停止') as HTMLButtonElement).disabled).toBe(true);
			const sit = container.querySelector('.sit') as HTMLElement;
			expect(sit.querySelector('.m')?.textContent).toBe('general · v2');
		});

		it('回滚全链:回滚键 → rewind(目标版);Info 回执 → 绿条+时间线清空+版本回置+已回滚角标', async () => {
			const { container, stubs, ev } = await setupConnected();
			ev({ type: 'ToolCall', name: 'file_read', args: { path: 'src/a.rs' } });
			ev({ type: 'SessionCreated', session_id: 'session_rw' });
			ev({ type: 'Done', success: true, content: '', steps: 1, duration_ms: 1000 });
			await tick();
			expect(container.querySelector('.mcol .te')).toBeTruthy(); // 待回滚时间线
			fireEvent.click(container.querySelector('.btn-rw') as HTMLElement);
			await tick();
			expect(stubs[0].rewind).toHaveBeenCalledWith(1);
			// 送达防抖:服务端回执前回滚键禁用
			expect((container.querySelector('.btn-rw') as HTMLButtonElement).disabled).toBe(true);
			ev({ type: 'Info', message: 'rewound to version 1' });
			await tick();
			expect(screen.getByText('✔ 已回滚到 v1 · 时间线已重建,后续对话基于 v1 继续')).toBeTruthy();
			expect(container.querySelector('.mcol .te')).toBeNull(); // 时间线重建
			const sit = container.querySelector('.sit') as HTMLElement;
			expect(sit.querySelector('.m')?.textContent).toBe('general · v1');
			expect(sit.querySelector('.rb')?.textContent).toBe('已回滚');
		});

		it('活跃轮次:回滚键禁用并提示先停止;chips 为当前版之前降序', async () => {
			const { container, stubs, ev } = await setupConnected();
			ev({ type: 'SessionCreated', session_id: 'session_x' });
			ev({ type: 'Done', success: true, content: '', steps: 1, duration_ms: 1000 });
			await tick();
			expect(
				Array.from(container.querySelectorAll('.vch')).map((c) => c.textContent?.trim())
			).toEqual(['v1']);
			await typeAndSend(container, '第二轮');
			await vi.waitFor(() => expect(stubs[0].send).toHaveBeenCalledWith('第二轮'));
			const rw = container.querySelector('.btn-rw') as HTMLButtonElement;
			expect(rw.disabled).toBe(true);
			expect(rw.getAttribute('title')).toContain('活跃轮次中不可回滚');
		});

		it('回滚错误转译:cannot rewind → 先停止提示;no session → 无可回滚目标;其余透传', async () => {
			const { container, ev } = await setupConnected();
			ev({
				type: 'Error',
				error: 'rewind failed: cannot rewind during active turn; send interrupt first'
			});
			await tick();
			const errs = () => container.querySelectorAll('.errc');
			expect(errs()[0].textContent).toContain('活跃轮次中不可回滚,请先停止');
			ev({ type: 'Error', error: 'rewind failed: no session to rewind' });
			await tick();
			expect(errs()[1].textContent).toContain('会话尚未建立,无可回滚目标');
			ev({ type: 'Error', error: 'rewind failed: io exploded' });
			await tick();
			expect(errs()[2].textContent).toContain('rewind failed: io exploded');
		});

		it('pending 审批卡随中断失效:停止后卡片转停止态(显式非静默)', async () => {
			const { container, ev } = await setupConnected();
			ev({
				type: 'ApprovalRequired',
				tool_name: 'shell_exec',
				command: 'cargo test',
				risk: 'medium',
				alternative: ''
			});
			await tick();
			fireEvent.click(screen.getByText('停止'));
			await tick();
			ev({ type: 'Done', success: false, content: '', steps: 0, duration_ms: 0, cancelled: true });
			await tick();
			const st = container.querySelector('.rcol .apv-state.st') as HTMLElement;
			expect(st.textContent).toContain('已随中断失效 · 轮次已停止');
		});

		it('审计深链:会话建立后「在审计页查看」带 ?session= 参数;草稿期不带', async () => {
			const { container, ev } = await setupConnected();
			const auditLink = container.querySelector('.mh-link') as HTMLAnchorElement;
			expect(auditLink.textContent).toContain('在审计页查看');
			expect(auditLink.getAttribute('href')).not.toContain('?session=');
			ev({ type: 'SessionCreated', session_id: 'session_9f3a2c' });
			await tick();
			expect(auditLink.getAttribute('href')).toContain('/audit?session=session_9f3a2c');
		});
	});

describe('AgentWorkspace — 接力 CTA 消费(?handoff=,整合批1)', () => {
	beforeEach(() => {
		// 显式重置会话元数据(内存+localStorage)与地址栏:本组用例对"无会话"前置
		// 有硬依赖,不依赖 afterEach 钩子顺序假设
		resetAgentSessions();
		window.history.replaceState({}, '', '/');
	});

	afterEach(() => {
		// 清地址栏,避免污染同文件其他用例(全局 afterEach 不管 URL)
		window.history.replaceState({}, '', '/');
	});

	it('URL 带 handoff:无会话时自动建「来自规则助理」草稿会话并预填输入行,参数一次性清除', async () => {
		setCfg({ enabled: true });
		window.history.replaceState(
			{},
			'',
			'/agent?handoff=' + encodeURIComponent('把这段校验逻辑改写成 evorule 规则集')
		);
		const { container } = render(AgentWorkspace);
		await tick();
		const textarea = container.querySelector('.rinput textarea') as HTMLTextAreaElement;
		expect(textarea.disabled).toBe(false);
		expect(textarea.value).toBe('把这段校验逻辑改写成 evorule 规则集');
		// 参数一次性消费:预填后地址栏即清,刷新不重灌
		expect(window.location.search).toBe('');
		// 会话承载:自动建草稿,标题用接力语义
		expect(screen.getByText('来自规则助理')).toBeTruthy();
	});

	it('无 handoff 参数:不建会话不预填(输入行恒渲染但禁用,既有空态行为不变)', async () => {
		setCfg({ enabled: true });
		const { container } = render(AgentWorkspace);
		await tick();
		// 输入行恒渲染(disabled={!selected});无会话 → 禁用且空值
		const textarea = container.querySelector('.rinput textarea') as HTMLTextAreaElement;
		expect(textarea.disabled).toBe(true);
		expect(textarea.value).toBe('');
		// 未建「来自规则助理」会话
		expect(screen.queryByText('来自规则助理')).toBeNull();
	});

	it('enabled=false:保留参数不消费(启用引导优先,用户启用后 effect 重跑再消费)', async () => {
		setCfg({ enabled: false });
		window.history.replaceState({}, '', '/agent?handoff=hello');
		render(AgentWorkspace);
		await tick();
		expect(window.location.search).toBe('?handoff=hello');
	});
});
