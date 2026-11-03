# mcp-twake-project

[![npm version](https://img.shields.io/npm/v/mcp-twake-project.svg)](https://www.npmjs.com/package/mcp-twake-project) [![CI](https://github.com/linagora/mcp-twake-project/actions/workflows/ci.yml/badge.svg)](https://github.com/linagora/mcp-twake-project/actions/workflows/ci.yml) [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE) [![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)

**Give your AI assistant secure access to Twake Project, the projects, boards and tasks of the [Twake.ai](https://twake.ai) Digital Workplace.**

## What is it?

`mcp-twake-project` is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. MCP is the open standard that lets AI assistants (Claude Desktop, Claude Code, Hermes Agent, Cursor, VS Code and many others) use external tools. This server exposes your Twake Project to the assistant as **47 tools**: projects, boards, sections and tasks (keys, due dates, deadlines, priorities, assignees, labels, descriptions, comments, history, reminders), saved filters, the agenda and notifications, and actions as you: create a board or a task, plan it, move it, transfer it to another board, assign it, comment it, complete it, archive it, share a board.

Twake Project organises the work of a team into projects and boards, each task carrying a readable key (for example `ATLAS-12`). The server talks to the Twake Project backend API, as **you**, with an OIDC access token from your identity provider.

**Nothing is done without your prior approval.** Before every write, the server itself shows you the exact action (who acts, in which board, with which text and dates) through MCP elicitation, and acts only on your explicit OK. A refusal, a timeout or a client that cannot ask means nothing is done.

## Part of Twake.ai

[Twake.ai](https://twake.ai) is the truly open source and sovereign Digital Workplace developed by [LINAGORA](https://linagora.com): Twake Mail, Twake Calendar, Twake Drive, Twake Chat, Twake Space, Twake Project and Twake Visio, with a single account, hosted in France or on your own infrastructure.

Open source MCP servers connect AI assistants to the whole workplace:

| MCP server | Twake.ai service | Protocol |
|---|---|---|
| [mcp-twake-mail](https://github.com/linagora/mcp-twake-mail) | Twake Mail | JMAP |
| [mcp-twake-dav](https://github.com/linagora/mcp-twake-dav) | Twake Calendar and contacts | CalDAV / CardDAV |
| [mcp-twake-drive](https://github.com/linagora/mcp-twake-drive) | Twake Drive | cozy-stack API |
| [mcp-twake-chat](https://github.com/linagora/mcp-twake-chat) | Twake Chat | Matrix (end-to-end encrypted) |
| [mcp-twake-space](https://github.com/linagora/mcp-twake-space) | Twake Space | Twake Space API |
| **mcp-twake-project** (this project) | Twake Project | Twake Project API |

## What it brings

- **Know where the work stands**: "What is left in the Atlas board? What did we finish this week?"
- **Find**: "Which tasks mention the September invoice?", "What is assigned to me?"
- **Plan**: "What does my week look like?" (the agenda of the next days, from due dates, deadlines and recurring tasks).
- **Prepare**: "Add a task 'Send the quote' to the Atlas board, due Thursday, priority high, assigned to Bob".
- **Follow**: read a task's description, its comments and its history before answering.
- **Act for you, with your OK each time**: "Move these three tasks to Done", "comment on ATLAS-12 that the client answered", "create a board for the new project".
- **Sovereignty**: the server runs next to your assistant and talks directly to your Twake Project.

## Features

### 47 MCP tools

21 read-only, 26 that write and ask for your approval first (⚠️).

| Category | Tools |
|---|---|
| Account | `whoami` |
| Projects and boards | `list_projects`, `list_boards`, `get_board`, `get_board_sharing`, `find_people_to_invite`, `check_key_prefix`, `list_hidden_tasks` (archived, trash) |
| Tasks, read | `get_task` (by id or key), `search_tasks`, `my_tasks`, `get_agenda`, `get_task_description`, `get_task_comments`, `get_task_history`, `preview_task_transfer` |
| Views | `list_labels`, `list_filters`, `get_filter_tasks`, `list_notifications`, `list_people` |
| Boards, write ⚠️ | `create_board`, `update_board` (name, layout), `move_board` |
| Sections ⚠️ | `create_section`, `update_section`, `delete_section` ⚠️ |
| Tasks, write ⚠️ | `create_task`, `update_task`, `move_task`, `complete_task`, `assign_task`, `set_task_description`, `transfer_task`, `add_comment` |
| Organisation ⚠️ | `create_label`, `set_task_labels`, `archive_task` ⚠️, `restore_task`, `trash_task` ⚠️ |
| Reminders ⚠️ | `add_reminder`, `remove_reminder` ⚠️ |
| Sharing ⚠️ | `invite_to_board`, `cancel_board_invite` ⚠️, `set_board_member_role`, `remove_board_member` ⚠️ |
| Notifications ⚠️ | `mark_notifications_read` |

⚠️ = asks for your approval first (and for the deletions and the sharing writes, `destructiveHint`). Read tools carry `readOnlyHint`. The server never deletes a board, and `trash_task` is recoverable with `restore_task`.

### Highlights

- **Keys, not only ids**: a task is addressed by its key (`ATLAS-12`) or its id; a board by its id, its key prefix or its name.
- **Informed approval**: the prompt names the board, the task, the exact text and dates, who acts, and carries a unique reference. Sharing is approved as what it is: the project and how many boards it holds.
- **Descriptions that do not collide**: writing a description takes its version, so a change made meanwhile is not overwritten silently (HTTP 409, read again).
- **Clear errors**: a role that does not allow the action, a board or task that does not exist (with the close names), an expired token, a version conflict: each says what to do.
- **Sovereignty**: the server runs next to your assistant and talks directly to your Twake Project.

## Limits

- **Sharing**: Twake Project shares a board through its project. A personal project, or a project managed by a Twake Space, stays private: `get_board_sharing`, `find_people_to_invite` and the sharing writes answer HTTP 403 on such a board, and the error says so. Create a project in Twake Project itself to invite people.
- **Sections**: every section carries a category (`backlog`, `unstarted`, `started`, `completed`, `canceled`), which tells the board what it means.
- **Transfer**: moving a task to another board gives it a new number there; its previous key is kept. Assignees who are not members of the target board are dropped, and labels follow by name. `preview_task_transfer` says what would be dropped or created before anything moves.
- **No deletion of a board**: the API has no route for it; a task in the trash can be restored with `restore_task` but not destroyed for good from the server.

## Requirements

- **Node.js** >= 22
- A **Twake Project** account, on a Twake.ai instance (for example `https://projects.example.com`)
- An **access token** accepted by that instance with the audience **`twake-projects`**, from a token command, a token file (`0600`) or a static token
- For writes, an MCP client that supports **elicitation** (Hermes Agent, Claude Code, VS Code…), or `TWAKE_PROJECT_APPROVAL=client`
- An **MCP client**: Claude Desktop, Claude Code, Hermes Agent, Cursor, VS Code, or any MCP-compatible assistant

## Installation

```bash
npm install -g mcp-twake-project   # or run it on demand with npx -y mcp-twake-project
mcp-twake-project check            # tests the configuration
```

From source:

```bash
git clone https://github.com/linagora/mcp-twake-project.git
cd mcp-twake-project
npm ci
npm run build          # then run: node build/index.js
```

## Configuration

### Acting as you (access token)

Twake Project accepts the OIDC access tokens of your identity provider when they carry the audience `twake-projects`. Ask your identity provider administrator to add that audience to the OIDC client of your assistant, then give the server a command that prints a fresh access token:

```bash
TWAKE_PROJECT_TOKEN_COMMAND="my-token-broker twake-projects --json"   # prints {"access_token": "...", "expires_at": <epoch s>}
TWAKE_PROJECT_OIDC_ISSUER=https://sso.example.com/                    # to name you in the approval prompts
```

Everything is then done as you: tasks, comments and assignments carry your name. Every write is approved by you first (below).

### Getting an access token by hand

For a test, copy the access token your identity provider issues for the `twake-projects` audience and store it in a file only you can read:

```bash
mkdir -p ~/.config/mcp-twake-project
umask 077; read -rsp "Token: " T; echo; printf %s "$T" > ~/.config/mcp-twake-project/token
```

An access token expires: prefer `TWAKE_PROJECT_TOKEN_COMMAND` for daily use.

### Prior approval

With `TWAKE_PROJECT_APPROVAL=elicit` (the default), every write tool sends the client an [elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation) request before it acts, for instance:

```
Twake Project : Create a section
En tant que : Alice MARTIN · alice.martin@example.com (your account)
Tableau : Projet (PROJ)
Section : À faire
Category : unstarted

Réf. 3f9a1c · Acceptez pour le faire maintenant, refusez pour annuler.
```

The server acts only on *accept*. On a refusal, a dismissal or a timeout (`TWAKE_PROJECT_APPROVAL_TIMEOUT_MS`, 10 minutes by default) it does nothing and tells the assistant not to retry. A client without elicitation support gets an error and nothing is done. Set `TWAKE_PROJECT_APPROVAL=client` only when your MCP client asks you to confirm every write tool itself. `USER_LANGUAGE=fr` writes the prompts in French.

### Environment

| Variable | Description | Default |
|---|---|---|
| `TWAKE_PROJECT_URL` | Twake Project web app, e.g. `https://projects.example.com` | required |
| `TWAKE_PROJECT_TOKEN_COMMAND` | Command printing an access token (raw or JSON `{access_token, expires_at}`) | |
| `TWAKE_PROJECT_TOKEN_FILE` | File holding the token (must be `0600`), read at each call | |
| `TWAKE_PROJECT_TOKEN` | The token itself (development only) | |
| `TWAKE_PROJECT_API_URL` | Backend API when not served under `<TWAKE_PROJECT_URL>/api` | `<TWAKE_PROJECT_URL>/api` |
| `TWAKE_PROJECT_OIDC_ISSUER` | OIDC issuer, to name you in the approval prompts (userinfo) | |
| `TWAKE_PROJECT_APPROVAL` | `elicit`: the server asks you before every write; `client`: your MCP client does | `elicit` |
| `TWAKE_PROJECT_APPROVAL_TIMEOUT_MS` | How long a prompt waits for your answer | `600000` |
| `USER_LANGUAGE` | Language of the prompts, `en` or `fr` | `en` |
| `USER_TIMEZONE` | IANA time zone for the agenda and the reminders, e.g. `Europe/Paris` | `Europe/Paris` |
| `TWAKE_PROJECT_TIMEOUT_MS` | HTTP timeout of one API call | `30000` |

One of the three token variables is required. `mcp-twake-project check` tests the configuration.

## Use it with your assistant

### Claude Desktop

```json
{
  "mcpServers": {
    "twake-project": {
      "command": "npx",
      "args": ["-y", "mcp-twake-project"],
      "env": {
        "TWAKE_PROJECT_URL": "https://projects.example.com",
        "TWAKE_PROJECT_TOKEN_COMMAND": "/usr/local/bin/my-token-broker twake-projects --json",
        "TWAKE_PROJECT_OIDC_ISSUER": "https://sso.example.com/",
        "USER_TIMEZONE": "Europe/Paris"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add twake-project --scope user \
  -e TWAKE_PROJECT_URL=https://projects.example.com \
  -e TWAKE_PROJECT_TOKEN_COMMAND="/usr/local/bin/my-token-broker twake-projects --json" \
  -e TWAKE_PROJECT_OIDC_ISSUER=https://sso.example.com/ \
  -- npx -y mcp-twake-project
```

### Hermes Agent

Hermes shows the approval prompts in the desktop app, the terminal or on your messaging platform, and declines them where nobody can answer (cron jobs, one-shot queries).

```yaml
mcp_servers:
  twake_project:
    command: npx
    args: ["-y", "mcp-twake-project"]
    env:
      TWAKE_PROJECT_URL: https://projects.example.com
      TWAKE_PROJECT_TOKEN_COMMAND: my-token-broker twake-projects --json
      TWAKE_PROJECT_OIDC_ISSUER: https://sso.example.com/
      TWAKE_PROJECT_APPROVAL_TIMEOUT_MS: "330000"
      USER_LANGUAGE: fr
      USER_TIMEZONE: Europe/Paris
    timeout: 420            # longer than the approval wait
    elicitation:
      enabled: true
      timeout: 300
```

## Recommended safe configuration

- Use a token that expires (a token command), not a static one; revoke it when you stop using the server.
- Keep `TWAKE_PROJECT_APPROVAL=elicit`: every write waits for your explicit OK, whatever the assistant decides. For a read-only assistant, also exclude the write tools in your MCP client:

  ```yaml
  tools:
    exclude: [trash_task, delete_section, remove_reminder]
  ```

- Read each prompt: it says who acts (you), where (which board, which task), and exactly what.
- Task titles, descriptions and comments are written by other people (prompt injection): see [SECURITY.md](SECURITY.md).

## Usage examples

- "What is left to do in the Atlas board?"
- "What did we finish this week in the project?"
- "Add 'Send the quote to the client' to the Atlas board, due Thursday at 5 pm, priority high, assigned to Bob, and say the client waits for the pricing page."
- "Which tasks mention 'September invoice'?" then "open the one from the Finance board and summarise its history."
- "Comment ATLAS-12: the client answered, we resume on Monday."
- "What does my week look like?" then "move the preparation tasks to In progress".
- "Create a board 'Recruitment 2027' with the key prefix RECR in the HR project."

## Troubleshooting

| Symptom | Fix |
|---|---|
| `TWAKE_PROJECT_URL is required` | Set the web app URL. |
| `HTTP 401` | The access token is expired, or the identity provider does not accept the audience `twake-projects` for this client. |
| `HTTP 403` | Your role on that board does not allow the action (viewer, editor, admin). |
| `No board matches "…"` | `list_boards` shows the boards, their key prefixes and the close names. |
| `No task "…" in …` | `get_board` or `search_tasks` gives the id and the key to use. |
| `HTTP 409` | The description changed since it was read: read it again with `get_task_description`, then write it back. |
| `cannot ask the user for approval` | Your MCP client does not support elicitation: use one that does, or `TWAKE_PROJECT_APPROVAL=client` if it confirms writes itself. |
| `must not be readable by other users` | `chmod 600` the token file. |

## Development

```bash
npm ci
npm run typecheck        # sources and tests
npm run build
npm test                 # Vitest: units, the 47 tools against a recording fake API,
                         # and the built server over stdio against a fake API and identity provider
```

Live test against a real Twake Project, in a test board it restores at the end (a refused write first, then accepted ones that are undone):

```bash
TWAKE_PROJECT_URL=https://projects.example.com \
TWAKE_PROJECT_TOKEN_COMMAND="…" \
TWAKE_PROJECT_OIDC_ISSUER=https://sso.example.com/ \
LIVE_BOARD='Test board' node scripts/live.mjs
```

## Contributing

Contributions are welcome: read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md). Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Release notes are in [CHANGELOG.md](CHANGELOG.md).

## License

Licensed under the **GNU Affero General Public License v3.0** ([AGPL-3.0](LICENSE)).

Copyright © 2026 [LINAGORA](https://linagora.com)

## About

`mcp-twake-project` is developed by [LINAGORA](https://linagora.com), French open source software publisher, as part of [Twake.ai](https://twake.ai). For support, hosting or integration of Twake.ai and its AI connectors, contact LINAGORA at [https://linagora.com](https://linagora.com).
