/** Who the server acts as, for the "As" line of every approval: the user behind the OIDC token. */
import type { ProjectClient } from './project.js';

export interface Identity {
  id?: string;
  email?: string;
  name?: string;
}

/**
 * Resolves the caller from the OIDC userinfo endpoint of `issuer` (uuid, email, name), cached per token.
 * Without an issuer the identity stays partial: the tools still work, the approval just names the account
 * less precisely.
 */
export function makeIdentify(
  api: ProjectClient,
  opts: { issuer?: string; fetchFn?: typeof fetch } = {},
): () => Promise<Identity> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  let cache: { token: string; identity: Promise<Identity>; until: number } | undefined;

  const resolve = async (token: string): Promise<Identity> => {
    const out: Identity = {};
    if (!opts.issuer) return out;
    try {
      const base = opts.issuer.replace(/\/+$/, '');
      const conf = (await (await fetchFn(`${base}/.well-known/openid-configuration`)).json()) as { userinfo_endpoint?: string };
      if (conf.userinfo_endpoint) {
        const res = await fetchFn(conf.userinfo_endpoint, { headers: { authorization: `Bearer ${token}` } });
        if (res.ok) {
          const u = (await res.json()) as { uuid?: string; email?: string; name?: string; preferred_username?: string };
          out.id = u.uuid;
          out.email = u.email;
          out.name = u.name ?? u.preferred_username;
        }
      }
    } catch {
      /* identity stays partial */
    }
    return out;
  };

  return async () => {
    const token = await api.token();
    if (cache && cache.token === token && cache.until > Date.now()) return cache.identity;
    const identity = resolve(token);
    cache = { token, identity, until: Date.now() + 10 * 60_000 };
    // A failed lookup is retried on the next call rather than kept for ten minutes.
    identity.then((id) => {
      if (!id.id && cache && cache.token === token) cache = { ...cache, until: 0 };
    });
    return identity;
  };
}
