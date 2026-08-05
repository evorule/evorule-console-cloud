/**
 * 清理占用端口 5174 的僵尸进程。
 *
 * 背景：playwright e2e 测试结束后，Windows 上 npm→vite→node 子进程树
 * 不一定被完全清理，残留的 node 进程会持有端口 5174。
 * 下次 `npm run dev` 时 vite 静默切到其他端口（strictPort:false），
 * 用户浏览器访问 5174 看到 "this site can't be reached"。
 *
 * 用法：npm run clean && npm run dev
 */
import { execSync } from 'child_process';

const PORT = 5174;

try {
	if (process.platform === 'win32') {
		execSync(
			`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ` +
				`Select-Object -ExpandProperty OwningProcess | ` +
				`ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
			{ stdio: 'pipe' }
		);
	} else {
		execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'pipe' });
	}
	console.log(`✓ Port ${PORT} cleaned`);
} catch {
	console.log(`✓ Port ${PORT} already free`);
}
