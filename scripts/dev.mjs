/**
 * 交互式 dev 启动器。
 *
 * 流程：
 * 1. 检测端口 5174 是否被占用
 * 2. 如果被占用 → 弹出确认提示（显示占用进程信息）
 * 3. 用户确认 → 清理僵尸进程 → 启动 vite dev
 * 4. 用户拒绝 → 退出，提示手动处理
 * 5. 端口空闲 → 直接启动 vite dev
 *
 * 用法：npm run dev（已配置为调用本脚本）
 */
import { execSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import net from 'net';

const PORT = 5174;

/** 检测端口是否被占用 */
function isPortInUse(port) {
	return new Promise((resolve) => {
		const tester = net
			.createServer()
			.once('error', (err) => resolve(err.code === 'EADDRINUSE'))
			.once('listening', function () {
				this.close();
				resolve(false);
			})
			.listen(port);
	});
}

/** 获取占用端口的进程信息 */
function getOccupant(port) {
	try {
		if (process.platform === 'win32') {
			const pid = execSync(
				`powershell -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"`,
				{ encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
			).trim();
			if (!pid) return null;
			const name = execSync(
				`powershell -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName"`,
				{ encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
			).trim();
			const start = execSync(
				`powershell -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartTime.ToString('HH:mm:ss')"`,
				{ encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
			).trim();
			return { pid: parseInt(pid), name: name || 'unknown', start };
		} else {
			const pid = execSync(`lsof -ti:${port} 2>/dev/null`, { encoding: 'utf-8' }).trim();
			if (!pid) return null;
			return { pid: parseInt(pid), name: 'unknown', start: '?' };
		}
	} catch {
		return null;
	}
}

/** 清理占用端口的进程 */
function killOccupant(port) {
	if (process.platform === 'win32') {
		execSync(
			`powershell -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ` +
				`Select-Object -ExpandProperty OwningProcess | ` +
				`ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
			{ stdio: 'pipe' }
		);
	} else {
		execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'pipe' });
	}
}

/** 命令行交互式确认（stdin 非 TTY 时自动通过） */
function confirm(question) {
	// 非 TTY 环境（IDE、CI）无法交互 → 自动确认
	if (!process.stdin.isTTY) {
		console.log(`${question} [非交互环境，自动确认]`);
		return Promise.resolve(true);
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			const a = answer.trim().toLowerCase();
			resolve(a === '' || a === 'y' || a === 'yes');
		});
	});
}

async function main() {
	const inUse = await isPortInUse(PORT);

	if (inUse) {
		const occ = getOccupant(PORT);
		const info = occ
			? `PID ${occ.pid} (${occ.name})，启动于 ${occ.start}`
			: '未知进程';

		console.log('');
		console.log('  ┌─────────────────────────────────────────────────────┐');
		console.log('  │  ⚠  端口 5174 被占用                                │');
		console.log('  │                                                     │');
		console.log(`  │  占用进程: ${info.padEnd(45)}│`);
		console.log('  │  常见原因: e2e 测试后残留的僵尸进程                  │');
		console.log('  │                                                     │');
		console.log('  │  清理后可安全启动 dev server                         │');
		console.log('  └─────────────────────────────────────────────────────┘');
		console.log('');

		const ok = await confirm('  是否清理并启动 dev server？[Y/n] ');

		if (!ok) {
			console.log('');
			console.log('  已取消。如需手动处理：');
			console.log('    npm run clean   # 清理端口');
			console.log('    或手动停止占用进程后重试');
			console.log('');
			process.exit(1);
		}

		console.log('  正在清理...');
		killOccupant(PORT);
		await new Promise((r) => setTimeout(r, 1500));
		console.log('  ✓ 端口已清理');
		console.log('');
	}

	// 启动 vite dev — 直接调用 vite.js，避免 shell 注入风险
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const projectRoot = resolve(__dirname, '..');
	const viteEntry = resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

	// 透传用户参数(如 --host 127.0.0.1 --port 5174)
	const vite = spawn(process.execPath, [viteEntry, 'dev', ...process.argv.slice(2)], {
		cwd: projectRoot,
		stdio: 'inherit'
	});

	vite.on('close', (code) => {
		process.exit(code ?? 0);
	});
}

main();
