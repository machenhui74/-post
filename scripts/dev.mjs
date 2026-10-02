import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = dirname(fileURLToPath(new URL(".", import.meta.url)));
const root = dirname(cwd);

function run(name, args) {
  const child = spawn("pnpm", args, { cwd: root, stdio: "inherit", shell: true });
  child.on("exit", (code) => {
    if (code) process.exitCode = code ?? 1;
  });
  return child;
}

console.log(`
GeoPost 启动
1. 本脚本会拉起 server(:8787) 与 web(:5173)
2. 另开终端执行: pnpm dev:ext
3. Chrome 打开 chrome://extensions → 开发者模式 → 加载已解压
   目录: apps/extension/.output/chrome-mv3
4. 浏览器打开 http://127.0.0.1:5173
Cookie 不会离开浏览器。
`);

run("server", ["--filter", "@geopost/server", "dev"]);
run("web", ["--filter", "@geopost/web", "dev"]);
