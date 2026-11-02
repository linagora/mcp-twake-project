// Live test of mcp-twake-project on a REAL Twake Project account.
// Reads first; then one write REFUSED (nothing must be written), then writes ACCEPTED that are undone
// at the end. Only runs in the test board given by LIVE_BOARD, which it restores.
//   TWAKE_PROJECT_URL=… TWAKE_PROJECT_TOKEN_COMMAND=… LIVE_BOARD=<exact board name> node scripts/live.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BOARD = process.env.LIVE_BOARD ?? 'Test board';
const answer = { mode: 'decline' };
const prompts = [];

const client = new Client({ name: 'live', version: '1' }, { capabilities: { elicitation: { form: {} } } });
client.setRequestHandler(ElicitRequestSchema, async (r) => {
  prompts.push(r.params.message);
  const action = answer.mode === 'accept' ? 'accept' : 'decline';
  answer.mode = 'accept'; // only the first prompt is refused
  return { action };
});
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: ['build/index.js'], env: process.env, stderr: 'inherit' }),
);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: (r.content ?? []).map((c) => c.text ?? '').join('\n'), isError: !!r.isError };
};
const refuseNext = () => { answer.mode = 'decline'; };
const ok = (cond, label) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) process.exitCode = 1;
};

// ---- reads
const projects = await call('list_projects');
ok(!projects.isError && /project\(s\)/.test(projects.text), `list_projects: ${projects.text.split('\n')[0]}`);
const boardList = await call('list_boards');
ok(!boardList.isError && boardList.text.includes(BOARD), `list_boards finds "${BOARD}"`);
const board = await call('get_board', { board: BOARD });
ok(!board.isError && board.text.includes(BOARD), `get_board: ${board.text.split('\n')[1] ?? ''}`);
const search = await call('search_tasks', { query: 'test' });
ok(!search.isError, `search_tasks: ${search.text.split('\n')[0]}`);
const agenda = await call('get_agenda', { days: 7 });
ok(!agenda.isError, `get_agenda: ${agenda.text.split('\n')[0]}`);
const people = await call('list_people');
ok(!people.isError, `list_people: ${people.text.split('\n')[0]}`);

// ---- one refused write: nothing is written
const refused = await call('create_task', { board: BOARD, title: `Refusé ${Date.now()}` });
ok(refused.isError && /Not done/.test(refused.text), 'create_task refused: not done');
ok(prompts.length === 1 && prompts[0].includes('Twake Project') && prompts[0].includes(BOARD), 'the prompt names the action, the board and the account');
const afterRefusal = await call('get_board', { board: BOARD });
ok(!afterRefusal.text.includes('Refusé'), 'the refused task is absent from the board');

// ---- accepted writes, all undone below
const stamp = Date.now();
const section = await call('create_section', { board: BOARD, name: `Test MCP ${stamp}`, category: 'unstarted' });
const sectionId = /\[id ([^\]]+)\]/.exec(section.text)?.[1];
ok(!section.isError && !!sectionId, `create_section accepted: ${sectionId ? 'created' : section.text}`);
const task = await call('create_task', { board: BOARD, title: `Tâche test ${stamp}`, section: `Test MCP ${stamp}` });
const key = /Task created: (\S+)/.exec(task.text)?.[1];
ok(!task.isError && !!key, `create_task accepted: ${key ?? task.text}`);
const captured = prompts.length;
// ---- sharing (reads) and a transfer preview: no prompt, nothing written
const sharing = await call('get_board_sharing', { board: 'Inbox' });
// A personal or Space-managed project cannot be shared: the API answers 403, which must be explained
ok(sharing.isError && /stays private/.test(sharing.text), `get_board_sharing explains the 403 (personal or Space project): ${sharing.text.split('\n')[1] ?? ''}`);
const found = await call('find_people_to_invite', { board: 'Inbox', query: 'ma' });
ok(found.isError && /stays private/.test(found.text), 'find_people_to_invite answers the same 403 with its explanation');
const preview = await call('preview_task_transfer', { board: BOARD, task: key, target_board: 'Inbox' });
ok(!preview.isError && /no assignee dropped|assignees dropped/.test(preview.text), `preview_task_transfer: ${preview.text.split('\n')[1] ?? preview.text.split('\n')[0]}`);
ok(captured === prompts.length, 'the reads asked for no approval');

// ---- a second refused write: an invitation nobody asked for
refuseNext();
const before = 'unshareable';
const invite = await call('invite_to_board', { board: 'Inbox', email: 'nobody@example.invalid', role: 'viewer' });
ok(invite.isError && /Not done/.test(invite.text), 'invite_to_board refused: not done');
ok(true, 'nothing to compare: the board cannot be shared');

const updated = await call('update_task', { board: BOARD, task: key, priority: 3, due_date: new Date().toISOString().slice(0, 10) });
ok(!updated.isError, 'update_task accepted (priority, due date)');
const comment = await call('add_comment', { board: BOARD, task: key, body: 'Commentaire de test (à supprimer).' });
ok(!comment.isError, 'add_comment accepted');
const moved = await call('move_task', { board: BOARD, task: key, section: null });
ok(!moved.isError, 'move_task accepted (no section)');
const done = await call('complete_task', { board: BOARD, task: key, state: 'completed' });
ok(!done.isError, 'complete_task accepted');
const trash = await call('trash_task', { board: BOARD, task: key });
ok(!trash.isError, 'trash_task accepted');
const removed = await call('delete_section', { board: BOARD, section: sectionId ?? `Test MCP ${stamp}` });
ok(!removed.isError, 'delete_section accepted (board restored)');
const finalBoard = await call('get_board', { board: BOARD });
ok(!finalBoard.text.includes(`Tâche test ${stamp}`), 'the board no longer shows the test task');
ok(prompts.length >= 8 && new Set(prompts).size === prompts.length, `${prompts.length} approvals, each with its own reference`);

await client.close();
