/** HTTP client of the Twake Project backend API (linagora/twake-tasks, Fastify under /api). */
import { readFile, stat } from 'node:fs/promises';

export interface TokenSource {
  getToken(): Promise<string>;
  invalidate(): void;
}

/** Access token read from a private file at each call, so a rotated token is picked up. */
export function fileTokenSource(file: string): TokenSource {
  return {
    async getToken() {
      const st = await stat(file);
      if (st.mode & 0o077) throw new Error(`${file} must not be readable by other users (chmod 0600)`);
      const token = (await readFile(file, 'utf8')).trim();
      if (!token) throw new Error(`${file} is empty`);
      return token;
    },
    invalidate() {},
  };
}

export class ProjectError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

/** Refusals of twake-tasks (apps/backend/src/refusalStatus.ts) that call for something other than a retry. */
const CODE_HINTS: Record<string, string> = {
  stale_version: 'The item changed since it was read (version conflict): read it again and retry.',
  stale_neighbours: 'The tasks around it moved since the board was read: read it again and retry.',
  archived: 'The board, the task or its parent is archived or in the trash: restore it first.',
  last_admin: 'The project needs at least one admin: make someone else admin first.',
  label_taken: 'A label with this name already exists on the board.',
  section_name_taken: 'A section with this name already exists on the board.',
  key_prefix_taken: 'This key prefix is taken: call check_key_prefix for a free one.',
  section_not_empty: 'The section still holds tasks: move them to another section.',
  too_many_invites: 'Too many pending invitations on this project: cancel some first.',
  too_many_reminders: 'The task has as many reminders as allowed: remove one first.',
  invalid_assignee: 'Only members of the board can be assigned; an invited person becomes a member at their next sign-in.',
  invalid_section: 'No such section on this board: call get_board to see its sections.',
  invalid_parent: 'The parent task is not usable here: a subtask moves with its parent, and is restored after it.',
  same_board: 'The task is already on that board.',
};

function hintFor(status: number, code: string, path: string): string | undefined {
  if (status === 401) return 'The access token is invalid or expired, or the SSO does not accept the audience "twake-projects" for this client.';
  if (status === 403) {
    if (/\/sharing|\/invites|\/members\//.test(path)) {
      return 'Twake Project shares a board through its project: a personal project, or a project managed by a Twake Space, stays private. Create a project in Twake Project itself to invite people.';
    }
    if (code === 'forbidden' || code === 'not_member') return 'Your role on this board does not allow it (viewer, editor or admin).';
    return 'Twake Project refused this action for your account.';
  }
  if (status === 404) return 'Not found, or not visible with this token: check the board id and the task id.';
  if (status === 429) return 'Rate limited by Twake Project: retry in a moment.';
  return CODE_HINTS[code];
}

export class ProjectClient {
  constructor(
    private readonly config: { apiUrl: string; timeoutMs: number },
    private readonly tokens: TokenSource,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  token(): Promise<string> {
    return this.tokens.getToken();
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.config.apiUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { authorization: `Bearer ${await this.tokens.getToken()}`, accept: 'application/json' };
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      const res = await this.fetchFn(url.toString(), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (res.status === 401 && attempt === 0) {
        this.tokens.invalidate();
        continue;
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        data = text;
      }
      if (res.ok) return data as T;
      const body = (data && typeof data === 'object' ? data : {}) as { error?: string; message?: string; statusCode?: number };
      const code = body.error ?? `http_${res.status}`;
      const message = `${method} ${path}: HTTP ${res.status} ${code}${body.message ? ` (${body.message})` : ''}`;
      throw new ProjectError(message, res.status, code, hintFor(res.status, code, path));
    }
  }
}

/** Boards, sections and tasks: the small amount of shared logic every tool needs. */
export interface Person {
  userId: string;
  email: string;
  name: string | null;
  avatar: string | null;
}

export interface Label {
  id: string;
  name: string;
  color: string | null;
}

export interface Section {
  id: string;
  name: string;
  category?: string | null;
  position?: number;
}

export interface Task {
  id: string;
  key: string;
  title: string;
  sectionId: string | null;
  parentId: string | null;
  priority: number | null;
  dueDate: string | null;
  dueTime: string | null;
  dueZone: string | null;
  deadline: string | null;
  duration?: { amount: number; unit: string } | null;
  recurrence?: { every: number; unit: string; fromCompletion: boolean } | null;
  completedAt: string | null;
  canceledAt: string | null;
  assignees?: Person[];
  labels?: Label[];
  commentCount?: number;
}

/** A task in a list that spans boards: my tasks, a saved filter, the search. */
export interface ListedTask extends Task {
  boardId: string;
  boardName: string;
}

export interface BoardSummary {
  id: string;
  name: string;
  keyPrefix: string;
  project: { id: string; name: string; personal: boolean; managed: boolean };
  inbox: boolean;
  role: string;
  archived: boolean;
  favorite?: boolean;
  openTasks?: number;
  doneTasks?: number;
  totalTasks?: number;
  members?: Person[];
  memberCount?: number;
}

export interface Board extends BoardSummary {
  version: number;
  layout?: string;
  defaultLayout?: string;
  invited?: string[];
  labels: Label[];
  sections: Section[];
  tasks: Task[];
}

export interface Project {
  id: string;
  name: string;
  personal: boolean;
  managed: boolean;
  role: string;
}
