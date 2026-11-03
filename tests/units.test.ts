import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { approvalMessage } from '../src/approval.js';
import { boardDocument, taskLine } from '../src/format.js';
import { ProjectClient, type Board } from '../src/project.js';
import { CommandTokenProvider } from '../src/token-command.js';

const base = {
  TWAKE_PROJECT_URL: 'https://projects.example.com',
  TWAKE_PROJECT_TOKEN: 'token',
} as NodeJS.ProcessEnv;

describe('config', () => {
  it('reads the URL, derives the API URL and defaults', () => {
    const c = loadConfig(base);
    expect(c.appUrl).toBe('https://projects.example.com');
    expect(c.apiUrl).toBe('https://projects.example.com/api');
    expect(c.approval).toBe('elicit');
    expect(c.approvalTimeoutMs).toBe(600_000);
    expect(c.timeoutMs).toBe(30_000);
    expect(c.language).toBe('en');
  });

  it('accepts an explicit API URL, French and a client approval', () => {
    const c = loadConfig({ ...base, TWAKE_PROJECT_API_URL: 'https://api.example.com/v1', USER_LANGUAGE: 'fr-FR', TWAKE_PROJECT_APPROVAL: 'client' });
    expect(c.apiUrl).toBe('https://api.example.com/v1');
    expect(c.language).toBe('fr');
    expect(c.approval).toBe('client');
  });

  it('refuses plain HTTP except on localhost', () => {
    expect(() => loadConfig({ ...base, TWAKE_PROJECT_URL: 'http://projects.example.com' })).toThrow(/HTTPS/);
    expect(loadConfig({ ...base, TWAKE_PROJECT_URL: 'http://localhost:3000' }).appUrl).toBe('http://localhost:3000');
  });

  it('requires a URL and a token source', () => {
    expect(() => loadConfig({ TWAKE_PROJECT_TOKEN: 'x' } as NodeJS.ProcessEnv)).toThrow(/TWAKE_PROJECT_URL/);
    expect(() => loadConfig({ TWAKE_PROJECT_URL: 'https://p.example.com' } as NodeJS.ProcessEnv)).toThrow(/TWAKE_PROJECT_TOKEN_COMMAND/);
  });

  it('reads a token command and a token file before a static token', () => {
    expect(loadConfig({ ...base, TWAKE_PROJECT_TOKEN_COMMAND: 'get-token', TWAKE_PROJECT_TOKEN_FILE: '/tmp/f' }).auth).toEqual({ kind: 'command', command: 'get-token' });
    expect(loadConfig({ ...base, TWAKE_PROJECT_TOKEN_FILE: '/tmp/f' }).auth).toEqual({ kind: 'file', file: '/tmp/f' });
  });

  it('refuses an unknown approval mode and language', () => {
    expect(() => loadConfig({ ...base, TWAKE_PROJECT_APPROVAL: 'always' })).toThrow(/elicit or client/);
    expect(() => loadConfig({ ...base, USER_LANGUAGE: 'de' })).toThrow(/en or fr/);
  });
});

describe('CommandTokenProvider', () => {
  it('reuses a raw token instead of running the command for every request', async () => {
    const p = new CommandTokenProvider('date +%s%N');
    const a = await p.getToken();
    expect(await p.getToken()).toBe(a);
  });

  it('keeps a short-lived token for half its lifetime, whatever the margin', async () => {
    const soon = Math.floor(Date.now() / 1000) + 30;
    const p = new CommandTokenProvider(`printf '{"access_token":"%s","expires_at":${soon}}' $(date +%s%N)`, { marginSeconds: 3600 });
    const a = await p.getToken();
    expect(await p.getToken()).toBe(a);
  });

  it('runs the command again for a token about to expire', async () => {
    const now = Math.floor(Date.now() / 1000);
    const p = new CommandTokenProvider(`printf '{"access_token":"%s","expires_at":${now}}' $(date +%s%N)`);
    const a = await p.getToken();
    expect(await p.getToken()).not.toBe(a);
  });
});

describe('API errors', () => {
  const failing = (status: number, error: string) =>
    new ProjectClient({ apiUrl: 'https://p.example.com/api', timeoutMs: 1000 }, { getToken: async () => 't', invalidate() {} }, (async () =>
      new Response(JSON.stringify({ error }), { status })) as typeof fetch);

  it('hints from the error code, not the status', async () => {
    await expect(failing(409, 'label_taken').request('POST', '/boards/b1/labels')).rejects.toMatchObject({ hint: expect.stringContaining('already exists') });
    await expect(failing(409, 'stale_version').request('PUT', '/boards/b1/tasks/t1/description')).rejects.toMatchObject({ hint: expect.stringContaining('read it again') });
    await expect(failing(400, 'invalid_assignee').request('PUT', '/boards/b1/tasks/t1/assignees')).rejects.toMatchObject({ hint: expect.stringContaining('members of the board') });
    await expect(failing(400, 'invalid_request').request('POST', '/boards/b1/tasks')).rejects.toMatchObject({ hint: undefined });
  });
});

describe('approval message', () => {
  it('names the action, the account, the board, the exact content and a reference', () => {
    const msg = approvalMessage(
      { action: 'Create a task', as: 'Alice MARTIN · alice.martin@example.com (your account)', board: 'Projet (PROJ)', details: [['Title', 'Écrire la note'], ['Section', 'À faire']] },
      'fr',
      'ab12cd',
    );
    expect(msg).toBe(
      [
        'Twake Project : Create a task',
        'En tant que : Alice MARTIN · alice.martin@example.com (your account)',
        'Tableau : Projet (PROJ)',
        'Title : Écrire la note',
        'Section : À faire',
        '',
        'Réf. ab12cd · Acceptez pour le faire maintenant, refusez pour annuler.',
      ].join('\n'),
    );
  });

  it('skips empty details and keeps a multi-line content on its own lines', () => {
    const msg = approvalMessage({ action: 'Comment a task', as: 'me', details: [['Empty', undefined], ['Comment', 'line 1\nline 2']] }, 'en', 'ff00aa');
    expect(msg).toContain('Twake Project: Comment a task');
    expect(msg).not.toContain('Empty');
    expect(msg).toContain('Comment:\nline 1\nline 2');
  });
});

describe('format', () => {
  const task = {
    id: 't1',
    key: 'PROJ-3',
    title: 'Écrire la note',
    sectionId: 's1',
    parentId: null,
    priority: 3,
    dueDate: '2026-11-05',
    dueTime: '09:00:00',
    dueZone: 'Europe/Paris',
    deadline: null,
    completedAt: null,
    canceledAt: null,
    assignees: [{ userId: 'u1', email: 'alice.martin@example.com', name: 'Alice MARTIN', avatar: null }],
    labels: [],
    commentCount: 2,
  };

  it('renders a task with its key, facts and id', () => {
    const line = taskLine(task);
    expect(line).toContain('PROJ-3: Écrire la note');
    expect(line).toContain('priority high');
    expect(line).toContain('due 2026-11-05 09:00 (Europe/Paris)');
    expect(line).toContain('assigned to Alice MARTIN');
    expect(line).toContain('2 comments');
    expect(line).toContain('[id t1]');
  });

  it('marks a done task and ignores a deadline equal to the due date', () => {
    expect(taskLine({ ...task, completedAt: '2026-11-04T10:00:00Z', deadline: '2026-11-05' })).toContain('done');
    expect(taskLine({ ...task, deadline: '2026-11-05' })).not.toContain('deadline');
  });

  it('groups a board by section, then the tasks without one', () => {
    const board: Board = {
      id: 'b1',
      name: 'Projet',
      keyPrefix: 'PROJ',
      project: { id: 'p1', name: 'Projet', personal: false, managed: false },
      inbox: false,
      role: 'admin',
      archived: false,
      version: 1,
      layout: 'board',
      labels: [{ id: 'l1', name: 'urgent', color: null }],
      members: [{ userId: 'u1', email: 'alice.martin@example.com', name: 'Alice MARTIN', avatar: null }],
      sections: [
        { id: 's1', name: 'À faire' },
        { id: 's2', name: 'Terminé' },
      ],
      tasks: [
        task,
        { ...task, id: 't2', key: 'PROJ-4', title: 'Sous-tâche', parentId: 't1' },
        { ...task, id: 't3', key: 'PROJ-5', title: 'Sans section', sectionId: null as unknown as string },
      ],
    };
    const doc = boardDocument(board);
    expect(doc).toContain('Projet (PROJ) · project Projet · admin');
    expect(doc).toContain('members: Alice MARTIN');
    expect(doc).toContain('labels: urgent');
    expect(doc.indexOf('## À faire')).toBeLessThan(doc.indexOf('## Terminé'));
    expect(doc).toContain('Sous-tâche');
    expect(doc).toContain('## Without a section · 1');
  });
});
