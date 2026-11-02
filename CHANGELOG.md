# Changelog

All notable changes to mcp-twake-project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-02

### Added
- `transfer_task` and `preview_task_transfer`: move a task and its subtasks to another board, after seeing what would be dropped (assignees who are not members of the target board) or created there (labels by name).
- Sharing: `get_board_sharing` (members with their role, pending invitations), `find_people_to_invite`, `invite_to_board`, `cancel_board_invite`, `set_board_member_role`, `remove_board_member`. Twake Project shares a board through its project: a personal project, or a project managed by a Twake Space, stays private, and the server explains the HTTP 403 it then gets.
- `get_board_sharing` renders members and invitations instead of raw JSON.

### Changed
- 47 tools (21 read-only, 26 writes approved by the user).

## [0.1.0] - 2026-11-02

### Added

- First release, on the Twake Project backend API (linagora/twake-tasks), acting as the user with an OIDC access token carrying the audience `twake-projects` (`TWAKE_PROJECT_TOKEN_COMMAND`, `TWAKE_PROJECT_TOKEN_FILE` or `TWAKE_PROJECT_TOKEN`).
- Prior approval of every write by the user, asked by the server itself through MCP elicitation (`TWAKE_PROJECT_APPROVAL=elicit`, the default): exact action, identity, board, task and content, unique reference; fails closed. `TWAKE_PROJECT_APPROVAL=client` leaves it to the MCP client. Prompts in English or French (`USER_LANGUAGE`).
- Read tools (19): `whoami`, `list_projects`, `list_boards`, `get_board`, `get_task`, `search_tasks`, `my_tasks`, `get_agenda`, `list_people`, `get_task_comments`, `get_task_history`, `get_task_description`, `list_notifications`, `list_labels`, `list_filters`, `get_filter_tasks`, `list_hidden_tasks` (archived, trash), `check_key_prefix`, `get_board_sharing`.
- Write tools (21, each approved first): `create_board`, `update_board`, `move_board`, `create_section`, `update_section`, `delete_section`, `create_task`, `update_task`, `move_task`, `complete_task`, `assign_task`, `set_task_description`, `add_comment`, `create_label`, `set_task_labels`, `archive_task`, `restore_task`, `trash_task`, `add_reminder`, `remove_reminder`, `mark_notifications_read`.
- Boards and tasks are found by name, key prefix, key or id; an ambiguous or missing name answers with the close matches.
- `mcp-twake-project check` tests the configuration.

### Tests

- Unit tests for the configuration, the approval prompts and the formatting.
- The 40 tools against a recording fake API: what each one sends, and that a refused, cancelled or unsupported approval writes nothing.
- End-to-end test of the built server over stdio against a fake Twake Project API and a fake identity provider.
- Live script `scripts/live.mjs`: reads, one refused write, then writes accepted and undone, in a real test board.
