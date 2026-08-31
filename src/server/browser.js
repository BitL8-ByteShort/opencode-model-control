import { spawn as nodeSpawn } from "node:child_process";

export function browserCommand(
  url,
  { platform = process.platform, env = process.env } = {},
) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  if (env.WSL_DISTRO_NAME) return { command: "wslview", args: [url] };
  return { command: "xdg-open", args: [url] };
}

export function launchBrowser(url, { spawn = nodeSpawn } = {}) {
  const { command, args } = browserCommand(url);
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
}
