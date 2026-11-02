/**
 * The packed server, started for real over stdio against a fake Twake Project API and a fake SSO,
 * so a missing module or a bad startup path fails here rather than at the user's first call.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const BOARDS = [
  {
    id: 'b1',
    name: 'Projet',
    keyPrefix: 'PROJ',
    project: { id: 'p1', name: 'Projet', personal: false, managed: false },
    inbox: false,
    role: 'admin',
    archived: false,
    openTasks: 1,
    doneTasks: 0,
  },
];
const BOARD = {
  ...BOARDS[0],
  version: 1,
  layout: 'board',
  labels: [],
  members: [{ userId: 'u1', email: 'alice.martin@example.com', name: 'Alice MARTIN', avatar: null }],
  sections: [{ id: 's1', name: 'À faire' }],
  tasks: [
    {
      id: 't1',
      key: 'PROJ-1',
      title: 'Écrire la note',
      sectionId: 's1',
      parentId: null,
      priority: null,
      dueDate: null,
      dueTime: null,
      dueZone: null,
      deadline: null,
      completedAt: null,
      canceledAt: null,
      assignees: [],
      labels: [],
      commentCount: 0,
    },
  ],
};

let api: http.Server;
let sso: http.Server;
let client: Client;
const seen: string[] = [];

beforeAll(async () => {
  api = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    seen.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/api/projects') return json(res, 200, { projects: [{ id: 'p1', name: 'Projet', personal: false, managed: false, role: 'admin' }] });
    if (url.pathname === '/api/boards' && req.method === 'POST') return json(res, 500, { error: 'boom', message: 'the stack is down', statusCode: 500 });
    if (url.pathname === '/api/boards') return json(res, 200, { boards: BOARDS });
    if (url.pathname === '/api/boards/b1') return json(res, 200, BOARD);
    if (url.pathname === '/api/boards/b1/tasks/t1/complete') return json(res, 204, null);
    return json(res, 404, { error: 'not_found', message: 'no such route', statusCode: 404 });
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  const apiPort = (api.address() as AddressInfo).port;
  sso = http.createServer((req, res) => {
    if (req.url?.endsWith('/.well-known/openid-configuration')) return json(res, 200, { userinfo_endpoint: `http://127.0.0.1:${(sso.address() as AddressInfo).port}/userinfo` });
    if (req.url === '/userinfo') return json(res, 200, { uuid: 'u1', email: 'alice.martin@example.com' });
    return json(res, 404, {});
  });
  await new Promise<void>((r) => sso.listen(0, '127.0.0.1', r));

  client = new Client({ name: 'binary', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept' }));
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['build/index.js'],
      env: {
        ...process.env,
        TWAKE_PROJECT_URL: 'http://127.0.0.1',
        TWAKE_PROJECT_API_URL: `http://127.0.0.1:${apiPort}/api`,
        TWAKE_PROJECT_TOKEN: 'test-token',
        TWAKE_PROJECT_OIDC_ISSUER: `http://127.0.0.1:${(sso.address() as AddressInfo).port}/`,
        USER_LANGUAGE: 'fr',
      },
      stderr: 'ignore',
    }),
  );
});

afterAll(async () => {
  await client.close();
  await new Promise<void>((r) => api.close(() => r()));
  await new Promise<void>((r) => sso.close(() => r()));
});

describe('the built server over stdio', () => {
  it('lists its tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_board');
    expect(names).toContain('create_task');
    expect(names).toContain('complete_task');
    expect(names.length).toBeGreaterThanOrEqual(33);
  });

  it('reads a board from the API', async () => {
    const r = await client.callTool({ name: 'get_board', arguments: { board: 'PROJ' } });
    const text = (r.content as { text: string }[])[0].text;
    expect(text).toContain('Projet (PROJ)');
    expect(text).toContain('PROJ-1: Écrire la note');
  });

  it('asks for approval in French and writes on accept', async () => {
    const r = await client.callTool({ name: 'complete_task', arguments: { board: 'PROJ', task: 'PROJ-1', state: 'completed' } });
    expect(r.isError).toBeFalsy();
    expect(seen).toContain('POST /api/boards/b1/tasks/t1/complete');
  });

  it('reports an API error with its hint', async () => {
    const r = await client.callTool({ name: 'create_board', arguments: { name: 'Nouveau' } });
    const text = (r.content as { text: string }[])[0].text;
    expect(r.isError).toBe(true);
    expect(text).toContain('HTTP 500');
    expect(text).toContain('the stack is down');
  });
});
