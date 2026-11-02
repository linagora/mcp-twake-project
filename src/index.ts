#!/usr/bin/env node
/**
 * mcp-twake-project: MCP server (stdio) for Twake Project (linagora/twake-tasks).
 *
 * Env: TWAKE_PROJECT_URL, and TWAKE_PROJECT_TOKEN_COMMAND (recommended: a command printing an OIDC
 * access token with the audience twake-projects), TWAKE_PROJECT_TOKEN_FILE or TWAKE_PROJECT_TOKEN;
 * optional TWAKE_PROJECT_API_URL, TWAKE_PROJECT_OIDC_ISSUER, USER_TIMEZONE, USER_LANGUAGE,
 * TWAKE_PROJECT_APPROVAL, TWAKE_PROJECT_APPROVAL_TIMEOUT_MS, TWAKE_PROJECT_TIMEOUT_MS.
 * `mcp-twake-project check` tests the configuration. Logs go to stderr only: stdout carries JSON-RPC.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, type Config } from './config.js';
import { makeIdentify } from './identity.js';
import { ProjectClient, fileTokenSource, type Project, type TokenSource } from './project.js';
import { CommandTokenProvider } from './token-command.js';
import { registerTools } from './tools.js';
import { VERSION } from './version.js';

function tokenSource(auth: Config['auth']): TokenSource {
  if (auth.kind === 'file') return fileTokenSource(auth.file);
  if (auth.kind === 'command') return new CommandTokenProvider(auth.command);
  return { getToken: async () => auth.token, invalidate() {} };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const api = new ProjectClient(config, tokenSource(config.auth));
  const identify = makeIdentify(api, { issuer: config.oidcIssuer });

  // Fail fast with an actionable message rather than exposing broken tools.
  let projects: { projects: Project[] };
  try {
    projects = await api.request('GET', '/projects');
  } catch (e) {
    const err = e as Error & { hint?: string };
    process.stderr.write(`mcp-twake-project: cannot use ${config.apiUrl}: ${err.message}${err.hint ? `\n${err.hint}` : ''}\n`);
    process.exit(1);
  }

  if (process.argv[2] === 'check') {
    const id = await identify().catch(() => undefined);
    process.stdout.write(
      `mcp-twake-project ${VERSION}: OK, ${projects.projects.length} project(s) at ${config.appUrl}\n` +
        `as ${id?.email ?? id?.id ?? 'unknown user (set TWAKE_PROJECT_OIDC_ISSUER)'}; approval: ${config.approval}\n`,
    );
    return;
  }

  const server = new McpServer({ name: 'mcp-twake-project', version: VERSION });
  registerTools(server, api, {
    appUrl: config.appUrl,
    timeZone: config.timeZone,
    approval: config.approval,
    approvalTimeoutMs: config.approvalTimeoutMs,
    language: config.language,
    identify,
  });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`mcp-twake-project ${VERSION} connected to ${config.appUrl}\n`);
}

main().catch((e) => {
  process.stderr.write(`mcp-twake-project: ${(e as Error).message}\n`);
  process.exit(1);
});
