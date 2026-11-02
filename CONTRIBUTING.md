# Contributing to mcp-twake-project

Thank you for your interest in mcp-twake-project! This project is part of the open source ecosystem of [Twake.ai](https://twake.ai), the sovereign and open source Digital Workplace developed by [LINAGORA](https://linagora.com).

## Code of conduct

By participating, you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a security issue

Please **do not** open a public issue for a vulnerability: follow [SECURITY.md](SECURITY.md).

## Development setup

```bash
git clone https://github.com/linagora/mcp-twake-project.git
cd mcp-twake-project
npm ci
npm run build
npm test
```

## Project layout

```
src/
  index.ts           # entry point: configuration, startup check, stdio transport
  config.ts          # environment variables, defaults, validation
  project.ts         # Twake Project API client, token sources, errors with hints
  identity.ts        # who the server acts as (OIDC userinfo), for the approval prompts
  approval.ts        # MCP elicitation approval: exact action, unique reference, fail closed
  format.ts          # compact, AI-friendly views of boards and tasks
  tools.ts           # the 40 tools (reads, then writes behind the approval gate)
  token-command.ts   # access token from an external command (cached until expiry)
scripts/             # live tests against a real Twake Project (never in CI)
tests/               # Vitest: units, tools against a fake API, the built server over stdio
```

## What to change where

- **A new tool**: declare it in `src/tools.ts` with `server.registerTool`, an `inputSchema` in Zod, and the right annotations (`READ` for a read, `WRITE` or `DESTRUCTIVE` otherwise). Every write must call `approver.confirm(...)` **before** any request, with the board, the exact content and the identity. Add it to the README table and to the CHANGELOG.
- **A new environment variable**: add it to `src/config.ts`, to `.env.example` and to the README configuration table.
- **An API change**: the contract lives in the Twake Project repository (`packages/api-contract`); check the route and its body there before changing a request.

## Before opening a pull request

```bash
npm run typecheck && npm run build && npm test
```

- Add or update tests: a behaviour change without a test is not ready.
- Update `CHANGELOG.md` under *Unreleased* for anything a user sees.
- Keep the approval gate fail-closed: a refusal, a timeout or a client that cannot ask must write nothing, and the tests must prove it.
- Anonymous data only in tests and docs: `Alice MARTIN`, `Bob DURAND`, `example.com` hostnames. Never a real colleague, token, hostname or personal data.
- Do not commit `build/`, `node_modules/` or `.env`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), signed off (DCO):

```bash
git commit -s -m "feat(tools): add transfer of a task to another board"
```

## License

mcp-twake-project is licensed under the [GNU Affero General Public License v3.0](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
