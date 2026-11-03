/** The tools against a recording fake API: what each one sends, and that a refused write writes nothing. */
import { describe, expect, it, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from '../src/tools.js';
import type { ProjectClient } from '../src/project.js';

const BOARDS = [
  { id: 'b1', name: 'Projet', keyPrefix: 'PROJ', project: { id: 'p1', name: 'Projet', personal: false, managed: false }, inbox: false, role: 'admin', archived: false, openTasks: 2, doneTasks: 0 },
  { id: 'b2', name: 'Inbox', keyPrefix: 'INBOX', project: { id: 'p0', name: 'Personal', personal: true, managed: false }, inbox: true, role: 'admin', archived: false },
];
const TASK = {
  id: 't1',
  key: 'PROJ-1',
  title: 'Écrire la note',
  sectionId: 's1',
  parentId: null,
  priority: 2,
  dueDate: '2026-11-05',
  dueTime: null,
  dueZone: null,
  deadline: null,
  completedAt: null,
  canceledAt: null,
  assignees: [],
  labels: [],
  commentCount: 0,
};
const LISTED = { ...TASK, category: null, parentTitle: null, boardId: 'b1', boardName: 'Projet', projectId: 'p1' };
const BOARD = {
  ...BOARDS[0],
  version: 3,
  layout: 'board',
  labels: [{ id: 'l1', name: 'urgent', color: null }],
  sections: [{ id: 's1', name: 'À faire' }],
  tasks: [TASK],
};

class FakeApi {
  calls: { method: string; path: string; body?: unknown; query?: unknown }[] = [];
  async request(method: string, path: string, opts: { body?: unknown; query?: unknown } = {}) {
    this.calls.push({ method, path, body: opts.body, query: opts.query });
    if (method === 'POST' && path === '/boards') return { id: 'b9', name: (opts.body as { name: string }).name, keyPrefix: 'NEW' };
    if (path === '/boards') return { boards: BOARDS };
    if (path === '/boards/b1') return BOARD;
    if (path === '/boards/b2') return { ...BOARD, id: 'b2', name: 'Inbox', keyPrefix: 'INBOX', inbox: true, sections: [], tasks: [] };
    if (path === '/boards/b1/sharing') return {
      members: [{ userId: 'u1', email: 'alice.martin@example.com', name: 'Alice MARTIN', role: 'admin' }, { userId: 'u2', email: 'bob.durand@example.com', name: 'Bob DURAND', role: 'editor' }],
      invites: [{ id: 'i1', email: 'chloe.petit@example.com', role: 'viewer' }],
    };
    if (path === '/boards/b1/sharing/people') return { people: [{ userId: 'u3', email: 'chloe.petit@example.com', name: 'Chloé PETIT', role: 'viewer' }] };
    if (path === '/boards/b1/tasks/t1/transfer/preview') return { droppedAssignees: [{ userId: 'u2', name: 'Bob DURAND', email: 'bob.durand@example.com' }], createdLabels: ['urgent'] };
    if (path === '/boards/b1/tasks/t1/transfer') return { droppedAssignees: [], createdLabels: ['urgent'], key: 'INBOX-7' };
    if (path === '/projects') return { projects: [{ id: 'p1', name: 'Projet', personal: false, managed: false, role: 'admin' }] };
    if (path === '/my-tasks') return { tasks: [LISTED] };
    if (path.startsWith('/search')) return { tasks: [{ ...LISTED, excerpt: null, match: { field: 'title', text: 'Écrire la note' } }] };
    if (path === '/people') return { people: [{ userId: 'u1', email: 'alice.martin@example.com', name: 'Alice MARTIN' }] };
    if (path === '/labels') return { labels: ['urgent'] };
    if (path === '/filters') return { filters: [{ id: 'f1', name: 'Mes urgences' }] };
    if (path === '/filters/f1/tasks') return { tasks: [LISTED] };
    if (path === '/notifications') return { notifications: [{ id: 'n1', reason: 'assigned', boardName: 'Projet', key: 'PROJ-1', title: 'Écrire la note', createdAt: '2026-11-02T08:00:00Z', readAt: null }] };
    if (path === '/notifications/unread') return { projects: [{ projectId: 'p1', count: 2 }, { projectId: 'p0', count: 1 }] };
    if (path === '/settings') return { language: null };
    if (path === '/boards/b1/archived' || path === '/boards/b1/trash') return { tasks: [{ ...TASK, at: '2026-11-01T08:00:00Z' }] };
    if (path === '/key-prefixes/PRO') return { available: false, suggestion: 'PRO2' };
    if (path === '/key-prefixes/NOU') return { available: false, suggestion: 'NOU2' };
    if (path === '/boards/b1/sharing') return { people: [{ email: 'alice.martin@example.com' }] };
    if (path.startsWith('/boards/b1/tasks/t1/comments')) return { comments: [{ id: 'c1', body: 'Bonjour', author: { name: 'Bob DURAND', email: 'bob.durand@example.com' }, createdAt: '2026-11-02T08:00:00Z' }] };
    if (path.startsWith('/boards/b1/tasks/t1/history')) return { entries: [{ actor: { userId: 'u2', name: 'Bob DURAND', email: 'bob.durand@example.com', avatar: null }, field: 'title', from: 'Note', to: 'Écrire la note', name: null, at: '2026-11-02T08:00:00Z' }] };
    if (path.endsWith('/description') && method === 'GET') return { markdown: '# Note', version: 4 };
    if (method === 'POST' && path === '/boards/b1/tasks') return { id: 't9', key: 'PROJ-9', title: (opts.body as { title: string }).title };
    if (method === 'POST' && path === '/boards/b1/labels') return { id: 'l9', name: (opts.body as { name: string }).name };
    if (method === 'POST' && path === '/boards/b1/sections') return { id: 's9', name: (opts.body as { name: string }).name };
    return undefined;
  }
}

let api: FakeApi;
let client: Client;
let elicit: (message: string) => 'accept' | 'decline' | 'cancel';
let prompts: string[];

async function connect(mode: 'accept' | 'decline' | 'cancel' | 'none' = 'accept') {
  api = new FakeApi();
  prompts = [];
  const server = new McpServer({ name: 'test', version: '1' });
  registerTools(server, api as unknown as ProjectClient, {
    appUrl: 'https://projects.example.com',
    timeZone: 'Europe/Paris',
    approval: 'elicit',
    approvalTimeoutMs: 1000,
    language: 'fr',
    identify: async () => ({ id: 'u0', email: 'alice.martin@example.com', name: 'Alice MARTIN' }),
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new Client({ name: 'c', version: '1' }, { capabilities: mode === 'none' ? {} : { elicitation: { form: {} } } });
  if (mode !== 'none') {
    client.setRequestHandler(ElicitRequestSchema, async (r) => {
      prompts.push(r.params.message);
      return { action: mode === 'accept' ? 'accept' : mode };
    });
  }
  await client.connect(ct);
}

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: (r.content as { text: string }[]).map((c) => c.text).join('\n'), isError: !!r.isError };
};
const writes = () => api.calls.filter((c) => c.method !== 'GET');
const callTool = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });

describe('reads', () => {
  beforeEach(() => connect('accept'));

  it('lists boards with their key prefix and role', async () => {
    const r = await call('list_boards');
    expect(r.text).toContain('Projet (PROJ)');
    expect(r.text).toContain('admin');
    expect(r.text).toContain('2 open');
    expect(prompts).toHaveLength(0);
  });

  it('resolves a board by key prefix and renders it', async () => {
    const r = await call('get_board', { board: 'proj' });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('## À faire [section s1] · 1 task');
    expect(r.text).toContain('PROJ-1: Écrire la note');
  });

  it('says which boards are close when a board does not exist', async () => {
    const r = await call('get_board', { board: 'Pro' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No board matches "Pro"');
  });

  it('finds a task by key and shows its subtasks', async () => {
    const r = await call('get_task', { board: 'PROJ', task: 'proj-1' });
    expect(r.text).toContain('PROJ-1: Écrire la note');
    expect(r.text).toContain('section À faire');
    expect(r.text).toContain('id t1');
  });

  it('searches tasks with their board', async () => {
    const r = await call('search_tasks', { query: 'note' });
    expect(r.text).toContain('PROJ-1: Écrire la note');
    expect(r.text).toContain('board Projet [b1] · match title: Écrire la note');
    expect(api.calls.at(-1)?.query).toEqual({ q: 'note' });
  });

  it('lists my tasks, the agenda, people, labels, filters and their tasks', async () => {
    const mine = await call('my_tasks');
    expect(mine.text).toContain('1 task(s) assigned to you');
    expect(mine.text).toContain('PROJ-1: Écrire la note');
    expect(mine.text).toContain('board Projet [b1]');
    const people = await call('list_people');
    expect(people.text).toContain('Alice MARTIN <alice.martin@example.com>');
    expect(people.text).toContain('[userId u1]');
    expect((await call('list_filters')).text).toContain('Mes urgences [id f1]');
    expect((await call('get_filter_tasks', { filter: 'mes urgences' })).text).toContain('PROJ-1');
    expect((await call('list_labels')).text).toContain('urgent');
    expect((await call('list_hidden_tasks', { board: 'PROJ', kind: 'trash' })).text).toContain('1 trash task');
    expect((await call('check_key_prefix', { prefix: 'PRO' })).text).toContain('PRO2 is free');
  });

  it('reads the comments, the history and the description', async () => {
    expect((await call('get_task_comments', { board: 'PROJ', task: 'PROJ-1' })).text).toContain('Bonjour');
    expect((await call('get_task_history', { board: 'PROJ', task: 'PROJ-1' })).text).toContain('Bob DURAND: title Note → Écrire la note');
    expect((await call('get_task_description', { board: 'PROJ', task: 'PROJ-1' })).text).toContain('version 4');
  });

  it('counts the unread notifications of every project', async () => {
    expect((await call('list_notifications', { unread_only: true })).text).toBe('3 unread notification(s).');
  });

  it('sends the agenda with the configured zone and the asked days', async () => {
    await call('get_agenda', { days: 3 });
    expect(api.calls.at(-1)?.query).toEqual({ zone: 'Europe/Paris', days: 3 });
  });
});

describe('writes are approved first', () => {
  it('a refused write sends nothing', async () => {
    await connect('decline');
    const r = await call('create_task', { board: 'PROJ', title: 'Nouvelle tâche', section: 'À faire' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Not done');
    expect(prompts).toHaveLength(1);
    expect(writes()).toEqual([]);
  });

  it('cancelled or unanswered, nothing is written either', async () => {
    await connect('cancel');
    await call('create_task', { board: 'PROJ', title: 'X' });
    expect(writes()).toEqual([]);
  });

  it('a client that cannot ask is refused, and nothing is written', async () => {
    await connect('none');
    const r = await call('trash_task', { board: 'PROJ', task: 'PROJ-1' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('cannot ask the user for approval');
    expect(writes()).toEqual([]);
  });

  it('shows the board, the account and the exact content, and creates the task once', async () => {
    await connect('accept');
    const r = await call('create_task', { board: 'PROJ', title: 'Nouvelle tâche', section: 'À faire' });
    expect(r.text).toContain('Task created: PROJ-9 Nouvelle tâche');
    expect(prompts[0]).toContain('Twake Project : Create a task');
    expect(prompts[0]).toContain('En tant que : Alice MARTIN · alice.martin@example.com (your account)');
    expect(prompts[0]).toContain('Tableau : Projet (PROJ)');
    expect(prompts[0]).toContain('Title : Nouvelle tâche');
    expect(writes()).toEqual([{ method: 'POST', path: '/boards/b1/tasks', body: { sectionId: 's1', title: 'Nouvelle tâche' }, query: undefined }]);
  });

  it('creates a subtask with the parent id', async () => {
    await connect('accept');
    await call('create_task', { board: 'PROJ', title: 'Sous-tâche', parent: 'PROJ-1' });
    expect(writes()[0].body).toEqual({ parentId: 't1', title: 'Sous-tâche' });
  });

  it('moves a task to another section', async () => {
    await connect('accept');
    await call('move_task', { board: 'PROJ', task: 'PROJ-1', section: 'À faire' });
    expect(writes()[0]).toMatchObject({ method: 'POST', path: '/boards/b1/tasks/t1/move', body: { sectionId: 's1' } });
  });

  it('completes, reopens and trashes a task', async () => {
    await connect('accept');
    await call('complete_task', { board: 'PROJ', task: 'PROJ-1', state: 'completed' });
    await call('complete_task', { board: 'PROJ', task: 'PROJ-1', state: 'reopen' });
    await call('trash_task', { board: 'PROJ', task: 'PROJ-1' });
    expect(writes().map((w) => `${w.method} ${w.path} ${w.body === undefined ? '' : JSON.stringify(w.body)}`)).toEqual([
      'POST /boards/b1/tasks/t1/complete {"state":"completed"}',
      'POST /boards/b1/tasks/t1/complete {"state":null}',
      'DELETE /boards/b1/tasks/t1 ',
    ]);
  });

  it('updates the fields it was given, and refuses an empty change', async () => {
    await connect('accept');
    const r = await call('update_task', { board: 'PROJ', task: 'PROJ-1', priority: 4, due_date: null });
    expect(r.text).toContain('priority 4');
    expect(writes()[0].body).toEqual({ priority: 4, dueDate: null });
    const none = await call('update_task', { board: 'PROJ', task: 'PROJ-1' });
    expect(none.isError).toBe(true);
    expect(none.text).toContain('Nothing to change');
  });

  it('assigns by user id and labels by name', async () => {
    await connect('accept');
    await call('assign_task', { board: 'PROJ', task: 'PROJ-1', user_ids: ['u1'] });
    expect(writes()[0].body).toEqual({ userIds: ['u1'] });
    await call('set_task_labels', { board: 'PROJ', task: 'PROJ-1', labels: ['urgent'] });
    expect(writes()[1].body).toEqual({ labelIds: ['l1'] });
  });

  it('writes a description with its version and comments in the user name', async () => {
    await connect('accept');
    await call('set_task_description', { board: 'PROJ', task: 'PROJ-1', markdown: '# Nouveau', version: 4 });
    expect(writes()[0].body).toEqual({ markdown: '# Nouveau', version: 4 });
    await call('add_comment', { board: 'PROJ', task: 'PROJ-1', body: 'Bien reçu' });
    expect(writes()[1].body).toEqual({ body: 'Bien reçu' });
  });

  it('adds a reminder relative to the due time with the configured zone', async () => {
    await connect('accept');
    await call('add_reminder', { board: 'PROJ', task: 'PROJ-1', before_minutes: 30 });
    expect(writes()[0].body).toEqual({ beforeMinutes: 30, zone: 'Europe/Paris' });
  });

  it('creates a board with the project asked', async () => {
    await connect('accept');
    const r = await call('create_board', { name: 'Nouveau', key_prefix: 'NEW', project: 'Projet' });
    expect(r.text).toContain('Board created: Nouveau (NEW)');
    expect(writes()[0].body).toEqual({ name: 'Nouveau', keyPrefix: 'NEW', projectId: 'p1' });
  });

  it('derives a free key prefix from the name when none is given', async () => {
    await connect('accept');
    await call('create_board', { name: 'Nouveau' });
    expect(prompts[0]).toContain('Key prefix : NOU2');
    expect(writes()[0].body).toEqual({ name: 'Nouveau', keyPrefix: 'NOU2', projectId: undefined });
  });

  it('sets your own layout of a board', async () => {
    await connect('accept');
    await call('update_board', { board: 'PROJ', layout: 'list' });
    expect(writes()).toEqual([{ method: 'PUT', path: '/boards/b1/layout', body: { layout: 'list' }, query: undefined }]);
  });

  it('restores a task found among the archived and trashed ones', async () => {
    await connect('accept');
    const r = await call('restore_task', { board: 'PROJ', task: 'PROJ-1' });
    expect(r.text).toBe('PROJ-1 restored.');
    expect(api.calls.map((c) => c.path)).toEqual(expect.arrayContaining(['/boards/b1/archived', '/boards/b1/trash']));
    expect(writes()).toEqual([{ method: 'POST', path: '/boards/b1/tasks/t1/restore', body: undefined, query: undefined }]);
  });

  it('renders the sharing of a board with roles and invitations', async () => {
    await connect('accept');
    const r = await call('get_board_sharing', { board: 'PROJ' });
    expect(r.text).toContain('2 members');
    expect(r.text).toContain('Alice MARTIN <alice.martin@example.com> · admin [userId u1]');
    expect(r.text).toContain('Pending invitations (1)');
    expect(r.text).toContain('chloe.petit@example.com · viewer [invite i1]');
  });

  it('finds people to invite', async () => {
    await connect('accept');
    const r = await call('find_people_to_invite', { board: 'PROJ', query: 'chloe' });
    expect(r.text).toContain('Chloé PETIT <chloe.petit@example.com>');
    expect(api.calls.at(-1)?.query).toEqual({ q: 'chloe' });
  });

  it('previews a transfer without moving anything', async () => {
    await connect('accept');
    const r = await call('preview_task_transfer', { board: 'PROJ', task: 'PROJ-1', target_board: 'INBOX' });
    expect(r.text).toContain('assignees dropped: Bob DURAND <bob.durand@example.com>');
    expect(r.text).toContain('other project (Personal)');
    expect(r.text).toContain('labels created there: urgent');
    expect(writes()).toEqual([{ method: 'POST', path: '/boards/b1/tasks/t1/transfer/preview', body: { boardId: 'b2', sectionId: null }, query: undefined }]);
    expect(prompts).toHaveLength(0);
  });

  it('transfers a task once approved', async () => {
    await connect('accept');
    const r = await call('transfer_task', { board: 'PROJ', task: 'PROJ-1', target_board: 'INBOX' });
    expect(r.text).toContain('moved to Inbox (INBOX), its key there is INBOX-7');
    expect(prompts[0]).toContain('Move a task to another board');
    expect(prompts[0]).toContain('To : Inbox (INBOX)');
    expect(prompts[0]).toContain('assignees dropped: Bob DURAND <bob.durand@example.com>');
    expect(prompts[0]).toContain('people outside it lose their assignments, follows and reminders');
    expect(writes().at(-1)).toMatchObject({ method: 'POST', path: '/boards/b1/tasks/t1/transfer', body: { boardId: 'b2', sectionId: null } });
  });

  it('refuses a transfer to a section the target board does not have', async () => {
    await connect('accept');
    const r = await call('transfer_task', { board: 'PROJ', task: 'PROJ-1', target_board: 'INBOX', target_section: 'Nope' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No section "Nope" on Inbox (INBOX): it has none');
    expect(writes()).toEqual([]);
  });

  it('refuses to move a task to its own board', async () => {
    await connect('accept');
    const r = await call('transfer_task', { board: 'PROJ', task: 'PROJ-1', target_board: 'PROJ' });
    expect(r.isError).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('invites someone, changes a role and removes a member, each time after approval', async () => {
    await connect('accept');
    await call('invite_to_board', { board: 'PROJ', email: 'Chloe.Petit@example.com', role: 'editor' });
    expect(writes().at(-1)?.body).toEqual({ email: 'chloe.petit@example.com', role: 'editor' });
    await call('set_board_member_role', { board: 'PROJ', user_id: 'u2', role: 'admin' });
    expect(writes().at(-1)).toMatchObject({ method: 'PUT', path: '/boards/b1/members/u2', body: { role: 'admin' } });
    const removed = await call('remove_board_member', { board: 'PROJ', email: 'bob.durand@example.com' });
    expect(removed.text).toContain('Bob DURAND removed');
    expect(writes().at(-1)).toMatchObject({ method: 'DELETE', path: '/boards/b1/members/u2' });
    expect(prompts).toHaveLength(3);
  });

  it('cancels an invitation', async () => {
    await connect('accept');
    const r = await call('cancel_board_invite', { board: 'PROJ', invite_id: 'i1' });
    expect(r.text).toContain('chloe.petit@example.com');
    expect(writes().at(-1)).toMatchObject({ method: 'DELETE', path: '/boards/b1/invites/i1' });
  });

  it('removes nobody when the member does not exist', async () => {
    await connect('accept');
    const r = await call('remove_board_member', { board: 'PROJ', email: 'nobody@example.com' });
    expect(r.isError).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('exposes the writes with destructive annotations where they delete', async () => {
    await connect('accept');
    const tools = (await client.listTools()).tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.trash_task.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.transfer_task.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get_board.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.length).toBe(47);
  });
});
