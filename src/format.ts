/** Text forms of the API objects, compact for a model: one task per line-block, ids kept. */
import type { Board, BoardSummary, Project, Section, Task } from './project.js';

const PRIORITY = ['', 'low', 'medium', 'high', 'urgent'];

export function when(task: Pick<Task, 'dueDate' | 'dueTime' | 'dueZone' | 'deadline'>): string | undefined {
  const parts: string[] = [];
  if (task.dueDate) parts.push(task.dueTime ? `${task.dueDate} ${task.dueTime.slice(0, 5)}` : task.dueDate);
  if (task.dueZone) parts.push(`(${task.dueZone})`);
  if (task.deadline && task.deadline !== task.dueDate) parts.push(`deadline ${task.deadline}`);
  return parts.length ? parts.join(' ') : undefined;
}

export function statusOf(task: Task): string {
  if (task.completedAt) return 'done';
  if (task.canceledAt) return 'canceled';
  return 'open';
}

export function taskLine(task: Task, opts: { section?: string } = {}): string {
  const bits = [`${task.key}`, task.title];
  const facts: string[] = [];
  if (opts.section) facts.push(opts.section);
  if (task.priority) facts.push(`priority ${PRIORITY[task.priority] ?? task.priority}`);
  const w = when(task);
  if (w) facts.push(`due ${w}`);
  const st = statusOf(task);
  if (st !== 'open') facts.push(st);
  if (task.assignees?.length) facts.push(`assigned to ${task.assignees.map((a) => a.name || a.email).join(', ')}`);
  if (task.labels?.length) facts.push(`labels ${task.labels.map((l) => l.name).join(', ')}`);
  if (task.commentCount) facts.push(`${task.commentCount} comment${task.commentCount === 1 ? '' : 's'}`);
  if (task.recurrence) facts.push(`repeats every ${task.recurrence.every} ${task.recurrence.unit}`);
  if (task.parentId) facts.push('subtask');
  const head = `- ${bits[0]}: ${bits[1]}`;
  const id = ` [id ${task.id}]`;
  return facts.length ? `${head}\n  ${facts.join(' · ')}${id}` : `${head}${id}`;
}

export function boardLine(b: BoardSummary): string {
  const bits: string[] = [`${b.name} (${b.keyPrefix})`];
  if (b.inbox) bits.push('inbox');
  if (b.project?.name) bits.push(`project ${b.project.name}`);
  bits.push(b.role);
  if (b.archived) bits.push('archived');
  if (b.favorite) bits.push('favorite');
  if (b.openTasks !== undefined) bits.push(`${b.openTasks} open`);
  if (b.doneTasks !== undefined) bits.push(`${b.doneTasks} done`);
  return `- ${bits.join(' · ')} [id ${b.id}]`;
}

export function projectLine(p: Project): string {
  return `- ${p.name}${p.personal ? ' (personal)' : ''}${p.managed ? ' · managed' : ''} · ${p.role} [id ${p.id}]`;
}

export function sectionLine(s: Section): string {
  return `- ${s.name}${s.category ? ` (${s.category})` : ''} [id ${s.id}]`;
}

/** One board as a compact document: header, sections with their tasks, tasks without a section. */
export function boardDocument(board: Board): string {
  const lines: string[] = [
    `${board.name} (${board.keyPrefix}) · project ${board.project?.name ?? '?'} · ${board.role}${board.archived ? ' · archived' : ''}`,
    `id ${board.id}${board.layout ? ` · layout ${board.layout}` : ''} · ${board.tasks.length} task${board.tasks.length === 1 ? '' : 's'}`,
  ];
  if (board.members?.length) lines.push(`members: ${board.members.map((m) => m.name || m.email).join(', ')}`);
  if (board.labels?.length) lines.push(`labels: ${board.labels.map((l) => l.name).join(', ')}`);
  const sections = [...(board.sections ?? [])];
  const bySection = new Map<string | null, Task[]>();
  for (const t of board.tasks ?? []) {
    const key = t.sectionId && sections.some((s) => s.id === t.sectionId) ? t.sectionId : null;
    bySection.set(key, [...(bySection.get(key) ?? []), t]);
  }
  const childOf = new Set((board.tasks ?? []).filter((t) => t.parentId).map((t) => t.id));
  for (const s of sections) {
    const tasks = (bySection.get(s.id) ?? []).filter((t) => !t.parentId);
    lines.push('', `## ${s.name} [section ${s.id}] · ${tasks.length} task${tasks.length === 1 ? '' : 's'}`);
    for (const t of tasks) {
      lines.push(taskLine(t));
      for (const sub of (board.tasks ?? []).filter((x) => x.parentId === t.id)) lines.push(`  ${taskLine(sub).replace(/^/gm, '  ').trimStart()}`);
    }
  }
  const loose = (bySection.get(null) ?? []).filter((t) => !t.parentId && !childOf.has(t.id));
  if (loose.length) {
    lines.push('', `## Without a section · ${loose.length}`);
    for (const t of loose) lines.push(taskLine(t));
  }
  return lines.join('\n');
}
