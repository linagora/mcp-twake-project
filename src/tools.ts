/** The MCP tools: reads are free, every write is approved by the user first (src/approval.ts). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Approver, ApprovalUnavailable, NotApproved, type ApprovalMode, type Language } from './approval.js';
import type { Board, BoardSummary, Project, ProjectClient, Section, Task } from './project.js';
import { boardDocument, boardLine, projectLine, sectionLine, taskLine, when } from './format.js';
import type { Identity } from './identity.js';

export interface ToolContext {
  appUrl: string;
  timeZone: string;
  approval: ApprovalMode;
  approvalTimeoutMs: number;
  language: Language;
  identify: () => Promise<Identity>;
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

const boardArg = z.string().min(1).describe('Board id (uuid), key prefix (e.g. TES3) or exact name.');
const taskArg = z.string().min(1).describe('Task id (uuid) or key (e.g. TES3-12).');

/** What the user sees when a write is refused, times out or the client cannot ask. */
function refusal(e: unknown, what: string) {
  if (e instanceof NotApproved) {
    return fail(
      e.outcome === 'decline'
        ? `Not done: you refused it, nothing was changed in Twake Project.`
        : `Not done: no answer to the approval request (dismissed, timed out or nobody available), nothing was changed. Do not retry on your own.`,
    );
  }
  if (e instanceof ApprovalUnavailable) return fail(`Not done: ${e.message}`);
  const err = e as Error & { hint?: string };
  return fail(`Error: ${err.message}${err.hint ? `\n${err.hint}` : ''}`);
}

export function registerTools(server: McpServer, api: ProjectClient, ctx: ToolContext): void {
  const approver = new Approver(server.server, ctx.approval, ctx.language, ctx.approvalTimeoutMs);

  const as = async (): Promise<string> => {
    const id = await ctx.identify().catch(() => ({}) as Identity);
    return id.email ? `${id.name ? `${id.name} · ` : ''}${id.email} (your account)` : 'your account';
  };

  const boards = async (includeArchived = false): Promise<BoardSummary[]> => {
    const out = await api.request<{ boards: BoardSummary[] }>('GET', '/boards');
    return includeArchived ? out.boards : out.boards.filter((b) => !b.archived);
  };

  /** A board from its id, key prefix or name. Throws with the close matches when it is ambiguous. */
  const board = async (ref: string): Promise<BoardSummary> => {
    const all = await boards(true);
    const lower = ref.trim().toLowerCase();
    const found =
      all.find((b) => b.id === ref) ??
      all.find((b) => b.keyPrefix.toLowerCase() === lower) ??
      all.filter((b) => b.name.toLowerCase() === lower)[0];
    if (found) return found;
    const near = all.filter((b) => b.name.toLowerCase().includes(lower)).slice(0, 8);
    throw Object.assign(new Error(`No board matches "${ref}".${near.length ? ` Close: ${near.map((b) => `${b.name} (${b.keyPrefix})`).join(', ')}.` : ''}`), {
      hint: 'Call list_boards to see the boards and their key prefixes.',
    });
  };

  const detail = (b: BoardSummary): Promise<Board> => api.request<Board>('GET', `/boards/${b.id}`);

  const task = async (b: BoardSummary, ref: string): Promise<{ board: Board; task: Task }> => {
    const boardDetail = await detail(b);
    const t = boardDetail.tasks.find((x) => x.id === ref) ?? boardDetail.tasks.find((x) => x.key.toLowerCase() === ref.toLowerCase());
    if (!t) throw new Error(`No task "${ref}" in ${b.name}. Call get_board to see its tasks.`);
    return { board: boardDetail, task: t };
  };

  const boardLabel = (b: BoardSummary) => `${b.name} (${b.keyPrefix})`;

  // ---------------------------------------------------------------- reads

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description: 'The Twake Project account this server acts as, and how many projects and boards it can see.',
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      try {
        const [id, p, b] = await Promise.all([
          ctx.identify().catch(() => ({}) as Identity),
          api.request<{ projects: Project[] }>('GET', '/projects'),
          boards(),
        ]);
        const name = id.name || id.email || 'unknown user';
        return ok(`${name}${id.email && id.name ? ` <${id.email}>` : ''} on ${ctx.appUrl}\n${p.projects.length} project(s), ${b.length} board(s)`);
      } catch (e) {
        return refusal(e, 'whoami');
      }
    },
  );

  server.registerTool(
    'list_projects',
    { title: 'List projects', description: 'The projects of this account, with the role on each.', inputSchema: {}, annotations: READ },
    async () => {
      try {
        const { projects } = await api.request<{ projects: Project[] }>('GET', '/projects');
        if (!projects.length) return ok('No project.');
        return ok(`${projects.length} project(s):\n${projects.map(projectLine).join('\n')}`);
      } catch (e) {
        return refusal(e, 'list_projects');
      }
    },
  );

  server.registerTool(
    'list_boards',
    {
      title: 'List boards',
      description: 'The boards (one per project by default, plus the personal Inbox), with counts and role. Filter by project or show archived ones.',
      inputSchema: {
        project: z.string().optional().describe('Project id or exact name.'),
        include_archived: z.boolean().optional().describe('Also list archived boards (default false).'),
      },
      annotations: READ,
    },
    async (a: { project?: string; include_archived?: boolean }) => {
      try {
        let list = await boards(a.include_archived ?? false);
        if (a.project) {
          const { projects } = await api.request<{ projects: Project[] }>('GET', '/projects');
          const p = projects.find((x) => x.id === a.project) ?? projects.find((x) => x.name.toLowerCase() === a.project!.toLowerCase());
          if (!p) throw new Error(`No project matches "${a.project}". Call list_projects first.`);
          list = list.filter((b) => b.project.id === p.id);
        }
        if (!list.length) return ok('No board.');
        return ok(`${list.length} board(s):\n${list.map(boardLine).join('\n')}`);
      } catch (e) {
        return refusal(e, 'list_boards');
      }
    },
  );

  server.registerTool(
    'get_board',
    {
      title: 'Read a board',
      description: 'A board in full: sections, tasks (with keys, due dates, assignees, labels), labels and members.',
      inputSchema: { board: boardArg },
      annotations: READ,
    },
    async (a: { board: string }) => {
      try {
        const b = await board(a.board);
        return ok(boardDocument(await detail(b)));
      } catch (e) {
        return refusal(e, 'get_board');
      }
    },
  );

  server.registerTool(
    'get_task',
    {
      title: 'Read a task',
      description: 'One task, its fields, its subtasks and its board/section. Accepts the id or the key (e.g. TES3-12).',
      inputSchema: { board: boardArg, task: taskArg },
      annotations: READ,
    },
    async (a: { board: string; task: string }) => {
      try {
        const b = await board(a.board);
        const { board: bd, task: t } = await task(b, a.task);
        const section = bd.sections.find((s) => s.id === t.sectionId)?.name;
        const subs = bd.tasks.filter((x) => x.parentId === t.id);
        const parent = t.parentId ? bd.tasks.find((x) => x.id === t.parentId) : undefined;
        const lines = [
          `${t.key}: ${t.title}`,
          `board ${boardLabel(b)}${section ? ` · section ${section}` : ''}`,
          `status ${t.completedAt ? 'done' : t.canceledAt ? 'canceled' : 'open'}${t.priority ? ` · priority ${t.priority}` : ''}`,
          when(t) ? `due ${when(t)}` : undefined,
          t.assignees?.length ? `assigned to ${t.assignees.map((p) => `${p.name || p.email} <${p.email}>`).join(', ')}` : undefined,
          t.labels?.length ? `labels ${t.labels.map((l) => l.name).join(', ')}` : undefined,
          t.recurrence ? `repeats every ${t.recurrence.every} ${t.recurrence.unit}${t.recurrence.fromCompletion ? ' from completion' : ''}` : undefined,
          parent ? `parent ${parent.key}: ${parent.title}` : undefined,
          `id ${t.id}${t.sectionId ? ` · section ${t.sectionId}` : ''}`,
          subs.length ? `\nSubtasks (${subs.length}):\n${subs.map((s) => `  ${taskLine(s)}`).join('\n')}` : undefined,
          `\nOpen in Twake Project: ${ctx.appUrl}`,
        ].filter(Boolean);
        return ok(lines.join('\n'));
      } catch (e) {
        return refusal(e, 'get_task');
      }
    },
  );

  server.registerTool(
    'search_tasks',
    {
      title: 'Search tasks',
      description: 'Full-text search on the keys, titles and descriptions of the tasks the account can see.',
      inputSchema: { query: z.string().min(1).describe('Words to look for.') },
      annotations: READ,
    },
    async (a: { query: string }) => {
      try {
        const out = await api.request<{ tasks: { task: Task; boardId: string; boardName: string; match?: { field: string; text: string } }[] }>(
          'GET',
          '/search',
          { query: { q: a.query } },
        );
        const list = out.tasks ?? [];
        if (!list.length) return ok(`No task matches "${a.query}".`);
        return ok(
          `${list.length} task(s) matching "${a.query}":\n${list
            .slice(0, 50)
            .map((r) => `${taskLine(r.task)}\n  board ${r.boardName} [${r.boardId}]${r.match ? ` · match ${r.match.field}: ${r.match.text.replace(/\s+/g, ' ').trim()}` : ''}`)
            .join('\n')}${list.length > 50 ? `\n\n${list.length} total, the first 50 shown.` : ''}`,
        );
      } catch (e) {
        return refusal(e, 'search_tasks');
      }
    },
  );

  server.registerTool(
    'my_tasks',
    {
      title: 'My tasks',
      description: 'The open tasks assigned to the account, across boards.',
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      try {
        const out = await api.request<{ tasks: { task: Task; boardId: string; boardName: string }[] }>('GET', '/my-tasks');
        const list = out.tasks ?? [];
        if (!list.length) return ok('No task is assigned to you.');
        return ok(`${list.length} task(s) assigned to you:\n${list.map((r) => `${taskLine(r.task)}\n  board ${r.boardName} [${r.boardId}]`).join('\n')}`);
      } catch (e) {
        return refusal(e, 'my_tasks');
      }
    },
  );

  server.registerTool(
    'get_agenda',
    {
      title: 'Agenda',
      description: 'The tasks scheduled in the next days (due date, deadline or recurring occurrence), grouped by day.',
      inputSchema: {
        days: z.number().int().min(1).max(60).optional().describe('How many days ahead (default 7).'),
        zone: z.string().optional().describe('Time zone (default: USER_TIMEZONE).'),
      },
      annotations: READ,
    },
    async (a: { days?: number; zone?: string }) => {
      try {
        const out = await api.request<{ today: string; tasks: (Task & { category?: string; boardId: string; boardName: string })[] }>('GET', '/agenda', {
          query: { zone: a.zone ?? ctx.timeZone, days: a.days ?? 7 },
        });
        const list = out.tasks ?? [];
        if (!list.length) return ok(`Nothing scheduled in the next ${a.days ?? 7} days (today ${out.today}).`);
        const byDay = new Map<string, typeof list>();
        for (const t of list) {
          const d = (t.dueDate ?? t.deadline ?? out.today)!;
          byDay.set(d, [...(byDay.get(d) ?? []), t]);
        }
        const days = [...byDay.entries()].sort(([x], [y]) => x.localeCompare(y));
        return ok(
          `Agenda from ${out.today} (next ${a.days ?? 7} days, ${a.zone ?? ctx.timeZone}):\n${days
            .map(([d, ts]) => `\n## ${d} · ${ts.length}\n${ts.map((t) => `${taskLine(t)}\n  board ${t.boardName} [${t.boardId}]`).join('\n')}`)
            .join('\n')}`,
        );
      } catch (e) {
        return refusal(e, 'get_agenda');
      }
    },
  );

  server.registerTool(
    'list_people',
    { title: 'List people', description: 'The people who share at least one board with the account, with their user id (needed to assign a task).', inputSchema: {}, annotations: READ },
    async () => {
      try {
        const { people } = await api.request<{ people: { userId: string; email: string; name: string | null }[] }>('GET', '/people');
        if (!people?.length) return ok('Nobody else shares a board with you.');
        return ok(`${people.length} person(s):\n${people.map((p) => `- ${p.name || p.email}${p.name ? ` <${p.email}>` : ''} [userId ${p.userId}]`).join('\n')}`);
      } catch (e) {
        return refusal(e, 'list_people');
      }
    },
  );

  server.registerTool(
    'get_task_comments',
    { title: 'Read the comments', description: 'The comments of a task, oldest first.', inputSchema: { board: boardArg, task: taskArg }, annotations: READ },
    async (a: { board: string; task: string }) => {
      try {
        const b = await board(a.board);
        const { task: t } = await task(b, a.task);
        const out = await api.request<{ comments: { id: string; body: string; author?: { name: string | null; email: string }; createdAt: string }[] }>(
          'GET',
          `/boards/${b.id}/tasks/${t.id}/comments`,
        );
        const list = out.comments ?? [];
        if (!list.length) return ok(`${t.key} has no comment.`);
        return ok(`${list.length} comment(s) on ${t.key}:\n${list.map((c) => `- ${c.createdAt} ${c.author ? c.author.name || c.author.email : '?'}: ${c.body}`).join('\n')}`);
      } catch (e) {
        return refusal(e, 'get_task_comments');
      }
    },
  );

  server.registerTool(
    'get_task_history',
    { title: 'Read the history', description: 'The changes recorded on a task, oldest first.', inputSchema: { board: boardArg, task: taskArg }, annotations: READ },
    async (a: { board: string; task: string }) => {
      try {
        const b = await board(a.board);
        const { task: t } = await task(b, a.task);
        const out = await api.request<{ history: { id: string; at?: string; createdAt?: string; actor?: { name: string | null; email: string }; kind?: string; field?: string }[] }>(
          'GET',
          `/boards/${b.id}/tasks/${t.id}/history`,
        );
        const list = out.history ?? [];
        if (!list.length) return ok(`No change recorded on ${t.key}.`);
        return ok(
          `${list.length} change(s) on ${t.key}:\n${list
            .map((h) => `- ${h.at ?? h.createdAt ?? '?'} ${h.actor ? h.actor.name || h.actor.email : '?'}: ${h.kind ?? h.field ?? ''}`)
            .join('\n')}`,
        );
      } catch (e) {
        return refusal(e, 'get_task_history');
      }
    },
  );

  server.registerTool(
    'get_task_description',
    { title: 'Read the description', description: 'The Markdown description of a task and its version (needed to write it back).', inputSchema: { board: boardArg, task: taskArg }, annotations: READ },
    async (a: { board: string; task: string }) => {
      try {
        const b = await board(a.board);
        const { task: t } = await task(b, a.task);
        const out = await api.request<{ markdown: string; version: number }>('GET', `/boards/${b.id}/tasks/${t.id}/description`);
        return ok(`${t.key} · version ${out.version}\n\n${out.markdown || '(empty)'}`);
      } catch (e) {
        return refusal(e, 'get_task_description');
      }
    },
  );

  server.registerTool(
    'list_notifications',
    { title: 'Notifications', description: 'The recent notifications (assignment, mention, following, reminder), unread first.', inputSchema: { unread_only: z.boolean().optional() }, annotations: READ },
    async (a: { unread_only?: boolean }) => {
      try {
        if (a.unread_only) {
          const out = await api.request<{ projects: { notifications?: unknown[] }[] }>('GET', '/notifications/unread');
          const n = (out.projects ?? []).reduce((s, p) => s + (p.notifications?.length ?? 0), 0);
          return ok(n ? `${n} unread notification(s).` : 'No unread notification.');
        }
        const out = await api.request<{ notifications: { id: string; reason: string; boardName: string; key: string; title: string; createdAt: string; readAt: string | null }[] }>(
          'GET',
          '/notifications',
        );
        const list = out.notifications ?? [];
        if (!list.length) return ok('No notification.');
        return ok(
          `${list.length} notification(s):\n${list
            .slice(0, 50)
            .map((x) => `- ${x.readAt ? '' : '[unread] '}${x.createdAt} ${x.reason} · ${x.key} ${x.title} (${x.boardName}) [id ${x.id}]`)
            .join('\n')}`,
        );
      } catch (e) {
        return refusal(e, 'list_notifications');
      }
    },
  );

  server.registerTool(
    'list_labels',
    { title: 'List labels', description: 'Every label name used on the account\'s boards.', inputSchema: {}, annotations: READ },
    async () => {
      try {
        const { labels } = await api.request<{ labels: string[] }>('GET', '/labels');
        return ok(labels?.length ? `${labels.length} label(s): ${labels.join(', ')}` : 'No label.');
      } catch (e) {
        return refusal(e, 'list_labels');
      }
    },
  );

  server.registerTool(
    'list_filters',
    { title: 'List filters', description: 'The saved filters (saved task views) of the account.', inputSchema: {}, annotations: READ },
    async () => {
      try {
        const { filters } = await api.request<{ filters: { id: string; name: string }[] }>('GET', '/filters');
        return ok(filters?.length ? `${filters.length} filter(s):\n${filters.map((f) => `- ${f.name} [id ${f.id}]`).join('\n')}` : 'No saved filter.');
      } catch (e) {
        return refusal(e, 'list_filters');
      }
    },
  );

  server.registerTool(
    'get_filter_tasks',
    { title: 'Tasks of a filter', description: 'The tasks matching a saved filter.', inputSchema: { filter: z.string().min(1).describe('Filter id or exact name.') }, annotations: READ },
    async (a: { filter: string }) => {
      try {
        const { filters } = await api.request<{ filters: { id: string; name: string }[] }>('GET', '/filters');
        const f = filters.find((x) => x.id === a.filter) ?? filters.find((x) => x.name.toLowerCase() === a.filter.toLowerCase());
        if (!f) throw new Error(`No filter matches "${a.filter}".`);
        const out = await api.request<{ tasks: { task: Task; boardId: string; boardName: string }[] }>('GET', `/filters/${f.id}/tasks`, { query: { zone: ctx.timeZone } });
        const list = out.tasks ?? [];
        return ok(list.length ? `${f.name}: ${list.length} task(s)\n${list.map((r) => `${taskLine(r.task)}\n  board ${r.boardName} [${r.boardId}]`).join('\n')}` : `${f.name}: no task.`);
      } catch (e) {
        return refusal(e, 'get_filter_tasks');
      }
    },
  );

  server.registerTool(
    'list_hidden_tasks',
    {
      title: 'Archived and trashed tasks',
      description: 'The archived tasks or the tasks in the trash of a board.',
      inputSchema: { board: boardArg, kind: z.enum(['archived', 'trash']) },
      annotations: READ,
    },
    async (a: { board: string; kind: 'archived' | 'trash' }) => {
      try {
        const b = await board(a.board);
        const out = await api.request<{ tasks: (Task & { at: string })[] }>('GET', `/boards/${b.id}/${a.kind}`);
        const list = out.tasks ?? [];
        return ok(list.length ? `${list.length} ${a.kind} task(s) in ${boardLabel(b)}:\n${list.map((t) => taskLine(t)).join('\n')}` : `No ${a.kind} task in ${boardLabel(b)}.`);
      } catch (e) {
        return refusal(e, 'list_hidden_tasks');
      }
    },
  );

  server.registerTool(
    'check_key_prefix',
    { title: 'Check a key prefix', description: 'Whether a board key prefix is free, and a suggestion when it is taken.', inputSchema: { prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,9}$/).describe('2 to 10 characters, A-Z and 0-9, starting with a letter.') }, annotations: READ },
    async (a: { prefix: string }) => {
      try {
        const out = await api.request<{ available: boolean; suggestion: string }>('GET', `/key-prefixes/${a.prefix}`);
        return ok(out.available ? `${a.prefix} is free.` : `${a.prefix} is taken: ${out.suggestion} is free.`);
      } catch (e) {
        return refusal(e, 'check_key_prefix');
      }
    },
  );

  server.registerTool(
    'get_board_sharing',
    { title: 'Board sharing', description: 'The people and pending invitations of a board.', inputSchema: { board: boardArg }, annotations: READ },
    async (a: { board: string }) => {
      try {
        const b = await board(a.board);
        const out = await api.request<{ people?: unknown[]; sharing?: unknown[]; invites?: unknown[] }>('GET', `/boards/${b.id}/sharing`);
        return ok(`${boardLabel(b)} sharing:\n${JSON.stringify(out, null, 1).slice(0, 3000)}`);
      } catch (e) {
        return refusal(e, 'get_board_sharing');
      }
    },
  );

  // ---------------------------------------------------------------- writes

  server.registerTool(
    'create_board',
    {
      title: 'Create a board',
      description: 'Create a board in a project (the personal Inbox when no project is given).',
      inputSchema: {
        name: z.string().min(1).max(100),
        key_prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,9}$/).optional().describe('Key prefix (2 to 10 characters A-Z 0-9); Twake Project picks one when omitted.'),
        project: z.string().optional().describe('Project id or exact name (default: your personal project).'),
      },
      annotations: WRITE,
    },
    async (a: { name: string; key_prefix?: string; project?: string }) => {
      try {
        let projectId: string | undefined;
        if (a.project) {
          const { projects } = await api.request<{ projects: Project[] }>('GET', '/projects');
          projectId = (projects.find((p) => p.id === a.project) ?? projects.find((p) => p.name.toLowerCase() === a.project!.toLowerCase()))?.id;
          if (!projectId) throw new Error(`No project matches "${a.project}".`);
        }
        await approver.confirm({
          action: 'Create a board',
          as: await as(),
          details: [
            ['Name', a.name],
            ['Key prefix', a.key_prefix],
            ['Project', a.project ?? 'your personal project'],
          ],
        });
        const b = await api.request<BoardSummary>('POST', '/boards', { body: { name: a.name, keyPrefix: a.key_prefix, projectId } });
        return ok(`Board created: ${b.name} (${b.keyPrefix}) [id ${b.id}]`);
      } catch (e) {
        return refusal(e, 'create_board');
      }
    },
  );

  server.registerTool(
    'update_board',
    {
      title: 'Rename a board or change its layout',
      description: 'Rename a board, or set how it opens (board, list or calendar).',
      inputSchema: {
        board: boardArg,
        name: z.string().min(1).max(100).optional(),
        layout: z.enum(['board', 'list', 'calendar']).optional(),
      },
      annotations: WRITE,
    },
    async (a: { board: string; name?: string; layout?: 'board' | 'list' | 'calendar' }) => {
      try {
        if (!a.name && !a.layout) throw new Error('Give a name or a layout.');
        const b = await board(a.board);
        await approver.confirm({
          action: a.name ? 'Rename a board' : 'Change a board layout',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Name', a.name ? `${b.name} → ${a.name}` : undefined],
            ['Layout', a.layout],
          ],
        });
        if (a.name) await api.request('PATCH', `/boards/${b.id}`, { body: { name: a.name } });
        if (a.layout) await api.request('PATCH', `/boards/${b.id}`, { body: { layout: a.layout } });
        return ok(`${boardLabel({ ...b, name: a.name ?? b.name })} updated.`);
      } catch (e) {
        return refusal(e, 'update_board');
      }
    },
  );

  server.registerTool(
    'move_board',
    {
      title: 'Move a board to another project',
      description: 'Move a board into another project.',
      inputSchema: { board: boardArg, project: z.string().min(1).describe('Project id or exact name.') },
      annotations: WRITE,
    },
    async (a: { board: string; project: string }) => {
      try {
        const b = await board(a.board);
        const { projects } = await api.request<{ projects: Project[] }>('GET', '/projects');
        const p = projects.find((x) => x.id === a.project) ?? projects.find((x) => x.name.toLowerCase() === a.project.toLowerCase());
        if (!p) throw new Error(`No project matches "${a.project}".`);
        await approver.confirm({
          action: 'Move a board',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Project', `${b.project.name} → ${p.name}`],
          ],
        });
        await api.request('POST', `/boards/${b.id}/move`, { body: { projectId: p.id } });
        return ok(`${boardLabel(b)} moved to ${p.name}.`);
      } catch (e) {
        return refusal(e, 'move_board');
      }
    },
  );

  const sectionOf = async (b: BoardSummary, ref: string) => {
    const bd = await detail(b);
    const s = bd.sections.find((x) => x.id === ref) ?? bd.sections.find((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (!s) throw new Error(`No section "${ref}" in ${boardLabel(b)}. Call get_board to see the sections.`);
    return { board: bd, section: s };
  };

  server.registerTool(
    'create_section',
    {
      title: 'Create a section',
      description: 'Add a column/section to a board (e.g. "À faire", "En cours", "Terminé").',
      inputSchema: {
        board: boardArg,
        name: z.string().min(1).max(100),
        category: z.enum(['backlog', 'unstarted', 'started', 'completed', 'canceled']).optional().describe('What the section means for the board (default unstarted).'),
        after: z.string().optional().describe('Section id after which to insert it.'),
      },
      annotations: WRITE,
    },
    async (a: { board: string; name: string; category?: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'; after?: string }) => {
      try {
        const b = await board(a.board);
        const category = a.category ?? 'unstarted';
        await approver.confirm({
          action: 'Create a section',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Section', a.name],
            ['Category', category],
          ],
        });
        const s = await api.request<Section>('POST', `/boards/${b.id}/sections`, { body: { name: a.name, category, afterId: a.after } });
        return ok(`Section created: ${s.name} [id ${s.id}]`);
      } catch (e) {
        return refusal(e, 'create_section');
      }
    },
  );

  server.registerTool(
    'update_section',
    {
      title: 'Rename a section',
      description: 'Rename a section, or change what it means for the board (backlog, unstarted, started, completed, canceled).',
      inputSchema: {
        board: boardArg,
        section: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        category: z.enum(['backlog', 'unstarted', 'started', 'completed', 'canceled']).optional(),
      },
      annotations: WRITE,
    },
    async (a: { board: string; section: string; name?: string; category?: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' }) => {
      try {
        if (!a.name && !a.category) throw new Error('Give a name or a category.');
        const b = await board(a.board);
        const { section } = await sectionOf(b, a.section);
        await approver.confirm({
          action: 'Rename a section',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Section', a.name ? `${section.name} → ${a.name}` : section.name],
            ['Category', a.category],
          ],
        });
        const body: Record<string, unknown> = {};
        if (a.name) body.name = a.name;
        if (a.category) body.category = a.category;
        await api.request('PATCH', `/boards/${b.id}/sections/${section.id}`, { body });
        return ok(`Section ${a.name ? `renamed to "${a.name}"` : `category set to ${a.category}`}.`);
      } catch (e) {
        return refusal(e, 'update_section');
      }
    },
  );

  server.registerTool(
    'delete_section',
    {
      title: 'Delete a section',
      description: 'Delete a section; its tasks go to another section or to the end of the board.',
      inputSchema: {
        board: boardArg,
        section: z.string().min(1),
        move_tasks_to: z.string().optional().describe('Section id or name that receives the tasks (default: none, they stay on the board).'),
      },
      annotations: DESTRUCTIVE,
    },
    async (a: { board: string; section: string; move_tasks_to?: string }) => {
      try {
        const b = await board(a.board);
        const { board: bd, section } = await sectionOf(b, a.section);
        const target = a.move_tasks_to ? bd.sections.find((s) => s.id === a.move_tasks_to || s.name.toLowerCase() === a.move_tasks_to!.toLowerCase()) : undefined;
        if (a.move_tasks_to && !target) throw new Error(`No section "${a.move_tasks_to}" to receive the tasks.`);
        const count = bd.tasks.filter((t) => t.sectionId === section.id).length;
        await approver.confirm({
          action: 'Delete a section',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Section', `${section.name} (${count} task${count === 1 ? '' : 's'})`],
            ['Its tasks go to', target ? target.name : 'no section (they stay on the board)'],
          ],
        });
        await api.request('DELETE', `/boards/${b.id}/sections/${section.id}`, { body: { tasksTo: target?.id ?? null } });
        return ok(`Section "${section.name}" deleted${count ? ` (${count} task${count === 1 ? '' : 's'} ${target ? `moved to ${target.name}` : 'left without a section'})` : ''}.`);
      } catch (e) {
        return refusal(e, 'delete_section');
      }
    },
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create a task',
      description: 'Add a task to a board (or a subtask to a task). Returns its key, e.g. TES3-12.',
      inputSchema: {
        board: boardArg,
        title: z.string().min(1).max(500),
        section: z.string().optional().describe('Section id or name (default: none).'),
        parent: taskArg.optional().describe('Task id or key to create a subtask.'),
      },
      annotations: WRITE,
    },
    async (a: { board: string; title: string; section?: string; parent?: string }) => {
      try {
        const b = await board(a.board);
        const bd = await detail(b);
        let sectionId: string | null = null;
        if (a.section) {
          const s = bd.sections.find((x) => x.id === a.section || x.name.toLowerCase() === a.section!.toLowerCase());
          if (!s) throw new Error(`No section "${a.section}" in ${boardLabel(b)}.`);
          sectionId = s.id;
        }
        let parentId: string | undefined;
        if (a.parent) parentId = (await task(b, a.parent)).task.id;
        await approver.confirm({
          action: a.parent ? 'Create a subtask' : 'Create a task',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Title', a.title],
            ['Section', bd.sections.find((s) => s.id === sectionId)?.name ?? (a.parent ? undefined : 'none')],
            ['Subtask of', a.parent],
          ],
        });
        const created = await api.request<{ id: string; key: string; title: string }>('POST', `/boards/${b.id}/tasks`, {
          body: parentId ? { parentId, title: a.title } : { sectionId, title: a.title },
        });
        return ok(`Task created: ${created.key} ${created.title} [id ${created.id}]`);
      } catch (e) {
        return refusal(e, 'create_task');
      }
    },
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update a task',
      description: 'Change the title, priority, due date/time, deadline, duration or recurrence of a task. Null clears a field.',
      inputSchema: {
        board: boardArg,
        task: taskArg,
        title: z.string().min(1).max(500).optional(),
        priority: z.number().int().min(1).max(4).nullable().optional().describe('1 low, 2 medium, 3 high, 4 urgent; null clears it.'),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe('YYYY-MM-DD, null clears it.'),
        due_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().describe('HH:MM, null clears it.'),
        due_zone: z.string().nullable().optional().describe('IANA time zone for the due time.'),
        deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe('YYYY-MM-DD, null clears it.'),
        duration_minutes: z.number().int().min(1).max(100_000).nullable().optional(),
        recurrence: z
          .object({ every: z.number().int().min(1).max(1000), unit: z.enum(['days', 'weeks', 'months', 'years']), from_completion: z.boolean().optional() })
          .nullable()
          .optional(),
      },
      annotations: WRITE,
    },
    async (a: {
      board: string;
      task: string;
      title?: string;
      priority?: number | null;
      due_date?: string | null;
      due_time?: string | null;
      due_zone?: string | null;
      deadline?: string | null;
      duration_minutes?: number | null;
      recurrence?: { every: number; unit: 'days' | 'weeks' | 'months' | 'years'; from_completion?: boolean } | null;
    }) => {
      try {
        const b = await board(a.board);
        const { task: t } = await task(b, a.task);
        const body: Record<string, unknown> = {};
        const changes: [string, string | undefined][] = [];
        const show = (v: unknown) => (v === null ? 'cleared' : String(v));
        if (a.title !== undefined) (body.title = a.title), changes.push(['Title', `${t.title} → ${a.title}`]);
        if (a.priority !== undefined) (body.priority = a.priority), changes.push(['Priority', show(a.priority)]);
        if (a.due_date !== undefined) (body.dueDate = a.due_date), changes.push(['Due date', show(a.due_date)]);
        if (a.due_time !== undefined) (body.dueTime = a.due_time), changes.push(['Due time', show(a.due_time)]);
        if (a.due_zone !== undefined) (body.dueZone = a.due_zone), changes.push(['Time zone', show(a.due_zone)]);
        if (a.deadline !== undefined) (body.deadline = a.deadline), changes.push(['Deadline', show(a.deadline)]);
        if (a.duration_minutes !== undefined) {
          body.duration = a.duration_minutes === null ? null : { amount: a.duration_minutes, unit: 'minutes' };
          changes.push(['Duration', show(a.duration_minutes === null ? null : `${a.duration_minutes} min`)]);
        }
        if (a.recurrence !== undefined) {
          body.recurrence = a.recurrence === null ? null : { every: a.recurrence.every, unit: a.recurrence.unit, fromCompletion: a.recurrence.from_completion ?? false };
          changes.push(['Repeats', show(a.recurrence === null ? null : `every ${a.recurrence.every} ${a.recurrence.unit}`)]);
        }
        if (!changes.length) throw new Error('Nothing to change.');
        await approver.confirm({ action: 'Update a task', as: await as(), board: boardLabel(b), details: [['Task', `${t.key}: ${t.title}`], ...changes] });
        await api.request('PATCH', `/boards/${b.id}/tasks/${t.id}`, { body });
        return ok(`${t.key} updated: ${changes.map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ')}.`);
      } catch (e) {
        return refusal(e, 'update_task');
      }
    },
  );

  server.registerTool(
    'move_task',
    {
      title: 'Move a task',
      description: 'Move a task to another section of its board (optionally after or before another task).',
      inputSchema: {
        board: boardArg,
        task: taskArg,
        section: z.string().nullable().optional().describe('Section id or name; null for no section.'),
        after: taskArg.optional(),
        before: taskArg.optional(),
      },
      annotations: WRITE,
    },
    async (a: { board: string; task: string; section?: string | null; after?: string; before?: string }) => {
      try {
        const b = await board(a.board);
        const { board: bd, task: t } = await task(b, a.task);
        let sectionId: string | null = t.sectionId;
        if (a.section !== undefined) {
          if (a.section === null || a.section === '') sectionId = null;
          else {
            const s = bd.sections.find((x) => x.id === a.section || x.name.toLowerCase() === a.section!.toLowerCase());
            if (!s) throw new Error(`No section "${a.section}" in ${boardLabel(b)}.`);
            sectionId = s.id;
          }
        }
        const afterId = a.after ? (await task(b, a.after)).task.id : undefined;
        const beforeId = a.before ? (await task(b, a.before)).task.id : undefined;
        await approver.confirm({
          action: 'Move a task',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Task', `${t.key}: ${t.title}`],
            ['Section', `${bd.sections.find((s) => s.id === t.sectionId)?.name ?? 'none'} → ${bd.sections.find((s) => s.id === sectionId)?.name ?? 'none'}`],
            ['After', a.after],
            ['Before', a.before],
          ],
        });
        await api.request('POST', `/boards/${b.id}/tasks/${t.id}/move`, { body: { sectionId, afterId, beforeId } });
        return ok(`${t.key} moved.`);
      } catch (e) {
        return refusal(e, 'move_task');
      }
    },
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Complete, cancel or reopen a task',
      description: 'Mark a task done, canceled, or back to open.',
      inputSchema: { board: boardArg, task: taskArg, state: z.enum(['completed', 'canceled', 'reopen']) },
      annotations: WRITE,
    },
    async (a: { board: string; task: string; state: 'completed' | 'canceled' | 'reopen' }) => {
      try {
        const b = await board(a.board);
        const { task: t } = await task(b, a.task);
        const label = a.state === 'reopen' ? 'Reopen a task' : a.state === 'completed' ? 'Complete a task' : 'Cancel a task';
        await approver.confirm({
          action: label,
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Task', `${t.key}: ${t.title}`],
            ['Now', a.state === 'reopen' ? 'open' : a.state],
          ],
        });
        await api.request('POST', `/boards/${b.id}/tasks/${t.id}/complete`, { body: { state: a.state === 'reopen' ? null : a.state } });
        return ok(`${t.key} is now ${a.state === 'reopen' ? 'open' : a.state}.`);
      } catch (e) {
        return refusal(e, 'complete_task');
      }
    },
  );

  server.registerTool(
    'assign_task',
    {
      title: 'Assign a task',
      description: 'Set the assignees of a task (the whole list replaces the previous one; empty unassigns). Use list_people for the user ids.',
      inputSchema: { board: boardArg, task: taskArg, user_ids: z.array(z.string()).max(50).describe('Twake Project user ids (uuid).') },
      annotations: WRITE,
    },
    async (a: { board: string; task: string; user_ids: string[] }) => {
      try {
        const b = await board(a.board);
        const { task: t } = await task(b, a.task);
        const { people } = await api.request<{ people: { userId: string; email: string; name: string | null }[] }>('GET', '/people');
        const names = a.user_ids.map((id) => people.find((p) => p.userId === id)?.email ?? id);
        await approver.confirm({
          action: 'Assign a task',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Task', `${t.key}: ${t.title}`],
            ['Assigned to', names.length ? names.join(', ') : 'nobody'],
          ],
        });
        await api.request('PUT', `/boards/${b.id}/tasks/${t.id}/assignees`, { body: { userIds: a.user_ids } });
        return ok(`${t.key} assigned to ${names.length ? names.join(', ') : 'nobody'}.`);
      } catch (e) {
        return refusal(e, 'assign_task');
      }
    },
  );

  server.registerTool(
    'set_task_description',
    {
      title: 'Write a task description',
      description: 'Replace the Markdown description of a task. Read it first with get_task_description: its version is required.',
      inputSchema: { board: boardArg, task: taskArg, markdown: z.string().max(50_000), version: z.number().int().min(0) },
      annotations: WRITE,
    },
    async (a: { board: string; task: string; markdown: string; version: number }) => {
      try {
        const b = await board(a.board);
        const { task: t } = await task(b, a.task);
        await approver.confirm({
          action: 'Write a task description',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Task', `${t.key}: ${t.title}`],
            ['Description', a.markdown.length > 800 ? `${a.markdown.slice(0, 800)}… (${a.markdown.length} characters)` : a.markdown],
          ],
        });
        await api.request('PUT', `/boards/${b.id}/tasks/${t.id}/description`, { body: { markdown: a.markdown, version: a.version } });
        return ok(`Description of ${t.key} written (${a.markdown.length} characters).`);
      } catch (e) {
        return refusal(e, 'set_task_description');
      }
    },
  );

  server.registerTool(
    'add_comment',
    { title: 'Comment a task', description: 'Add a comment to a task, in the user\'s name.', inputSchema: { board: boardArg, task: taskArg, body: z.string().min(1).max(10_000) }, annotations: WRITE },
    async (a: { board: string; task: string; body: string }) => {
      try {
        const b = await board(a.board);
        const { task: t } = await task(b, a.task);
        await approver.confirm({
          action: 'Comment a task',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Task', `${t.key}: ${t.title}`],
            ['Comment', a.body],
          ],
        });
        await api.request('POST', `/boards/${b.id}/tasks/${t.id}/comments`, { body: { body: a.body } });
        return ok(`Comment added to ${t.key}.`);
      } catch (e) {
        return refusal(e, 'add_comment');
      }
    },
  );

  server.registerTool(
    'create_label',
    { title: 'Create a label', description: 'Create a label on a board.', inputSchema: { board: boardArg, name: z.string().min(1).max(50), color: z.string().optional() }, annotations: WRITE },
    async (a: { board: string; name: string; color?: string }) => {
      try {
        const b = await board(a.board);
        await approver.confirm({ action: 'Create a label', as: await as(), board: boardLabel(b), details: [['Label', a.name], ['Color', a.color]] });
        const l = await api.request<{ id: string; name: string }>('POST', `/boards/${b.id}/labels`, { body: { name: a.name, color: a.color } });
        return ok(`Label created: ${l.name} [id ${l.id}]`);
      } catch (e) {
        return refusal(e, 'create_label');
      }
    },
  );

  server.registerTool(
    'set_task_labels',
    {
      title: 'Set the labels of a task',
      description: 'Replace the labels of a task (empty list removes them all).',
      inputSchema: { board: boardArg, task: taskArg, labels: z.array(z.string()).max(50).describe('Label ids or names.') },
      annotations: WRITE,
    },
    async (a: { board: string; task: string; labels: string[] }) => {
      try {
        const b = await board(a.board);
        const { board: bd, task: t } = await task(b, a.task);
        const ids = a.labels.map((ref) => {
          const l = bd.labels.find((x) => x.id === ref) ?? bd.labels.find((x) => x.name.toLowerCase() === ref.toLowerCase());
          if (!l) throw new Error(`No label "${ref}" on ${boardLabel(b)}. Create it with create_label.`);
          return l.id;
        });
        await approver.confirm({
          action: 'Set the labels of a task',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Task', `${t.key}: ${t.title}`],
            ['Labels', a.labels.length ? a.labels.join(', ') : 'none'],
          ],
        });
        await api.request('PUT', `/boards/${b.id}/tasks/${t.id}/labels`, { body: { labelIds: ids } });
        return ok(`${t.key}: labels ${a.labels.length ? a.labels.join(', ') : 'cleared'}.`);
      } catch (e) {
        return refusal(e, 'set_task_labels');
      }
    },
  );

  for (const [name, action, path, description] of [
    ['archive_task', 'Archive a task', 'archive', 'Remove a task from the board without deleting it (restorable).'],
    ['restore_task', 'Restore a task', 'restore', 'Bring back an archived or trashed task.'],
    ['trash_task', 'Move a task to the trash', '', 'Move a task to the trash (recoverable with restore_task).'],
  ] as const) {
    server.registerTool(
      name,
      { title: action, description, inputSchema: { board: boardArg, task: taskArg }, annotations: DESTRUCTIVE },
      async (a: { board: string; task: string }) => {
        try {
          const b = await board(a.board);
          const { task: t } = await task(b, a.task);
          await approver.confirm({ action, as: await as(), board: boardLabel(b), details: [['Task', `${t.key}: ${t.title}`]] });
          const url = `/boards/${b.id}/tasks/${t.id}${path ? `/${path}` : ''}`;
          await api.request(path ? 'POST' : 'DELETE', url);
          return ok(`${t.key} ${name === 'archive_task' ? 'archived' : name === 'restore_task' ? 'restored' : 'moved to the trash'}.`);
        } catch (e) {
          return refusal(e, name);
        }
      },
    );
  }

  server.registerTool(
    'add_reminder',
    {
      title: 'Add a reminder',
      description: 'Remind the user about a task at a given time, or a number of minutes before its due time.',
      inputSchema: {
        board: boardArg,
        task: taskArg,
        at: z.string().optional().describe('ISO date-time with offset, e.g. 2026-11-05T09:00:00+01:00.'),
        before_minutes: z.number().int().min(0).max(525_600).optional().describe('Minutes before the due time (needs a due date).'),
      },
      annotations: WRITE,
    },
    async (a: { board: string; task: string; at?: string; before_minutes?: number }) => {
      try {
        if (!a.at && a.before_minutes === undefined) throw new Error('Give "at" or "before_minutes".');
        const b = await board(a.board);
        const { task: t } = await task(b, a.task);
        await approver.confirm({
          action: 'Add a reminder',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Task', `${t.key}: ${t.title}`],
            ['Reminder', a.at ?? `${a.before_minutes} min before the due time`],
          ],
        });
        await api.request('POST', `/boards/${b.id}/tasks/${t.id}/reminders`, {
          body: a.at ? { at: a.at } : { beforeMinutes: a.before_minutes, zone: ctx.timeZone },
        });
        return ok(`Reminder added on ${t.key}.`);
      } catch (e) {
        return refusal(e, 'add_reminder');
      }
    },
  );

  server.registerTool(
    'remove_reminder',
    {
      title: 'Remove a reminder',
      description: 'Delete a reminder of a task.',
      inputSchema: { board: boardArg, task: taskArg, reminder_id: z.string().min(1) },
      annotations: DESTRUCTIVE,
    },
    async (a: { board: string; task: string; reminder_id: string }) => {
      try {
        const b = await board(a.board);
        const { task: t } = await task(b, a.task);
        await approver.confirm({
          action: 'Remove a reminder',
          as: await as(),
          board: boardLabel(b),
          details: [
            ['Task', `${t.key}: ${t.title}`],
            ['Reminder', a.reminder_id],
          ],
        });
        await api.request('DELETE', `/boards/${b.id}/tasks/${t.id}/reminders/${a.reminder_id}`);
        return ok(`Reminder removed from ${t.key}.`);
      } catch (e) {
        return refusal(e, 'remove_reminder');
      }
    },
  );

  server.registerTool(
    'mark_notifications_read',
    { title: 'Mark notifications read', description: 'Mark one notification, or every notification, as read.', inputSchema: { notification_id: z.string().optional() }, annotations: WRITE },
    async (a: { notification_id?: string }) => {
      try {
        await approver.confirm({
          action: 'Mark notifications as read',
          as: await as(),
          details: [['Notifications', a.notification_id ? `one (id ${a.notification_id})` : 'all']],
        });
        if (a.notification_id) await api.request('POST', `/notifications/${a.notification_id}/read`);
        else await api.request('POST', '/notifications/read', { body: {} });
        return ok('Notifications marked as read.');
      } catch (e) {
        return refusal(e, 'mark_notifications_read');
      }
    },
  );
}
