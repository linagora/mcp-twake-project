# Security Policy

mcp-twake-project gives an AI assistant access to the projects, boards and tasks of [Twake.ai](https://twake.ai) Project, and can write in them. We take its security seriously and thank everyone who reports issues responsibly.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions or pull requests.**

Report them privately, by one of these channels:

1. GitHub private vulnerability reporting: [Report a vulnerability](https://github.com/linagora/mcp-twake-project/security/advisories/new);
2. email to **dpo@linagora.com**.

Please include the affected version or commit, a description of the issue and its impact, steps to reproduce, and any suggested fix. We will acknowledge your report within **5 business days** and agree with you on a disclosure date once a fix is available.

## Security model and hardening

- **Prior approval**: with `TWAKE_PROJECT_APPROVAL=elicit` (the default), the server asks the user, through MCP elicitation, to approve every write before doing it, with the exact action, the board, the task, the exact content, the identity it acts as and a unique reference. It fails closed: refusal, timeout, error or a client without elicitation means nothing is done. `TWAKE_PROJECT_APPROVAL=client` hands this to the MCP client and should only be used with a client that confirms every write.
- **Acting as you**: the server uses an OIDC access token obtained from `TWAKE_PROJECT_TOKEN_COMMAND` at each expiry. Twake Project applies your own rights (viewer, editor, admin per board): the server can do nothing more than you can. The token is never written to disk nor logged by the server.
- **Token file**: `TWAKE_PROJECT_TOKEN_FILE` must be readable by you only (`0600`): the server refuses a file readable by others. The token is never logged nor returned by a tool.
- **Writing**: every write tool changes data the members of the board see, in your name. `trash_task` is reversible (`restore_task`); `delete_section` and `remove_reminder` are not. The server never deletes a board and never deletes a task permanently.
- **Descriptions**: writing a task description requires its version, so a change made meanwhile is refused (HTTP 409) rather than overwritten silently.
- **Prompt injection**: task titles, descriptions, comments and notification texts are written by other people and apps. MCP clients should treat them as data, never as instructions.
- **Transport**: HTTPS only (plain HTTP is accepted for `localhost` only).
- **No local file access**: beyond the token file or command it is configured with, the server neither reads nor writes files on the machine.
