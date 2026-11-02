export interface Config {
  /** Twake Project web app, used for "open in Twake Project" links, e.g. https://projects.example.com */
  appUrl: string;
  /** Backend API base URL, default <appUrl>/api */
  apiUrl: string;
  auth: { kind: 'file'; file: string } | { kind: 'command'; command: string } | { kind: 'static'; token: string };
  /** OIDC issuer, to know the signed-in user (userinfo): the "as" line of every approval. */
  oidcIssuer?: string;
  /** elicit: the server asks the user to approve every write; client: the MCP client does it. */
  approval: 'elicit' | 'client';
  approvalTimeoutMs: number;
  language: 'en' | 'fr';
  timeZone: string;
  timeoutMs: number;
}

function httpsUrl(name: string, raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`${name} must use HTTPS (only localhost may use HTTP)`);
  }
  return url;
}

function positive(name: string, raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}

function language(raw: string | undefined): 'en' | 'fr' {
  if (!raw) return 'en';
  const l = raw.slice(0, 2).toLowerCase();
  if (l !== 'en' && l !== 'fr') throw new Error('USER_LANGUAGE must be en or fr');
  return l;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (!env.TWAKE_PROJECT_URL) throw new Error('TWAKE_PROJECT_URL is required (e.g. https://projects.example.com)');
  const app = httpsUrl('TWAKE_PROJECT_URL', env.TWAKE_PROJECT_URL);
  const appUrl = `${app.origin}${app.pathname}`.replace(/\/+$/, '');
  const apiUrl = env.TWAKE_PROJECT_API_URL
    ? httpsUrl('TWAKE_PROJECT_API_URL', env.TWAKE_PROJECT_API_URL).href.replace(/\/+$/, '')
    : `${appUrl}/api`;
  let auth: Config['auth'];
  if (env.TWAKE_PROJECT_TOKEN_COMMAND) auth = { kind: 'command', command: env.TWAKE_PROJECT_TOKEN_COMMAND };
  else if (env.TWAKE_PROJECT_TOKEN_FILE) auth = { kind: 'file', file: env.TWAKE_PROJECT_TOKEN_FILE };
  else if (env.TWAKE_PROJECT_TOKEN) auth = { kind: 'static', token: env.TWAKE_PROJECT_TOKEN };
  else {
    throw new Error(
      'Set TWAKE_PROJECT_TOKEN_COMMAND (a command printing an OIDC access token), TWAKE_PROJECT_TOKEN_FILE or TWAKE_PROJECT_TOKEN',
    );
  }
  const approval = (env.TWAKE_PROJECT_APPROVAL ?? 'elicit').toLowerCase();
  if (approval !== 'elicit' && approval !== 'client') throw new Error('TWAKE_PROJECT_APPROVAL must be elicit or client');
  return {
    appUrl,
    apiUrl,
    auth,
    oidcIssuer: env.TWAKE_PROJECT_OIDC_ISSUER,
    approval,
    approvalTimeoutMs: positive('TWAKE_PROJECT_APPROVAL_TIMEOUT_MS', env.TWAKE_PROJECT_APPROVAL_TIMEOUT_MS, 600_000),
    language: language(env.USER_LANGUAGE),
    timeZone: env.USER_TIMEZONE ?? 'Europe/Paris',
    timeoutMs: positive('TWAKE_PROJECT_TIMEOUT_MS', env.TWAKE_PROJECT_TIMEOUT_MS, 30_000),
  };
}
