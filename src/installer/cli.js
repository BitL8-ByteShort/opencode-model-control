import { OpenCodeIntegrationInstaller } from "./index.js";

export async function runIntegrationCli({
  args,
  operations,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const [requestedCommand, ...options] = args ?? [];
  const command = requestedCommand === "connect"
    ? "install"
    : requestedCommand === "disconnect"
      ? "uninstall"
      : requestedCommand;
  const unknown = options.filter((option) => !["--yes", "--json"].includes(option));
  if (!command || !["status", "install", "uninstall"].includes(command) || unknown.length > 0) {
    stderr.write("Usage: opencode-model-control <status|connect|disconnect> [--yes] [--json]\n");
    return 2;
  }
  if (["install", "uninstall"].includes(command) && !options.includes("--yes")) {
    stderr.write(
      `Refusing to ${requestedCommand} without explicit confirmation. Re-run with: opencode-model-control ${requestedCommand} --yes\n`,
    );
    return 2;
  }

  try {
    const backend = operations ?? defaultOperations();
    const result = await backend[command]();
    if (options.includes("--json")) {
      stdout.write(`${JSON.stringify(safeCliResult(result))}\n`);
    } else {
      stdout.write(formatResult(command, result));
    }
    return 0;
  } catch (error) {
    const message = error?.statusCode
      ? error.message
      : "OpenCode integration could not be changed safely.";
    if (options.includes("--json")) {
      stderr.write(
        `${JSON.stringify({ error: { code: error?.code ?? "INTEGRATION_ERROR", message } })}\n`,
      );
    } else {
      stderr.write(`${message}\n`);
    }
    return 1;
  }
}

function defaultOperations() {
  const installer = new OpenCodeIntegrationInstaller();
  return {
    status: () => installer.status(),
    uninstall: () => installer.uninstall(),
    async install() {
      const { ControlService } = await import("../server/service.js");
      const service = await new ControlService({ integrationInstaller: installer }).initialize();
      return service.installOpenCodeIntegration();
    },
  };
}

function safeCliResult(result) {
  return {
    installed: result.installed,
    managed: result.managed,
    healthy: result.healthy,
    requiresAttention: result.requiresAttention,
    changed: result.changed ?? false,
    code: result.code,
    message: result.message,
    configPath: result.configPath,
  };
}

function formatResult(command, result) {
  const state = result.installed
    ? "Connected"
    : result.requiresAttention
      ? "Needs attention"
      : "Not connected";
  const change =
    command === "install"
      ? result.changed
        ? " OpenCode must be restarted to load the connection."
        : " No config changes were needed."
      : command === "uninstall"
        ? " OpenCode must be restarted to remove the connection."
        : "";
  return `${state}: ${result.message}${change}\nConfig: ${result.configPath}\n`;
}
