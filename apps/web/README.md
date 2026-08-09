# web

A minimal TanStack Start app with one route and plain CSS.

```bash
pnpm install
pnpm dev
```

Edit `src/routes/index.tsx` to get started. Add route files under
`src/routes`; TanStack Router updates `src/routeTree.gen.ts` for you.

Build the production app with:

```bash
pnpm build
```

## Deploy to Cloudflare Workers

This project uses the Cloudflare Vite plugin (configured in `vite.config.ts`) and `wrangler.jsonc`:

1. Install Wrangler: `npm install -g wrangler`
2. Authenticate: `wrangler login`
3. Deploy: `npx wrangler deploy`

For production env vars, run `wrangler secret put MY_VAR` for each secret listed in `.env.example`. Public (non-secret) vars go in `wrangler.jsonc` under `vars`.

KV, D1, R2, and Durable Object bindings are configured in `wrangler.jsonc` — see https://developers.cloudflare.com/workers/wrangler/configuration/.

## Porting status

This app replaces `apps/registry` and `apps/site` with one deploy. It is not
live yet, and nothing points at it.

The Worker name here is `yougotserved-web-staging` on purpose. The live Worker
is `yougotserved-registry`, and the workers.dev hostname derives from the name,
so published installs still resolve through it. Taking that name before the port
finishes would replace a working registry with a blank app. Rename at cutover,
and not before.

### Verified

- Build produces a Cloudflare Worker: 682 kB raw, 141 kB gzip, against a 3 MB
  compressed limit. Room for the registry code.
- A server route returns plain JSON, checked by response body under
  `wrangler dev --local`, not by a green build. `/api/health` answers
  `{"ok":true,...}` with status 200. This is the property the bridge depends on:
  it calls `response.json()` and nothing else.
- `assets.run_worker_first` is unset in the generated config, so a static hit is
  served without a Worker invocation. Merging does not put the marketing page
  behind a billed request.

### Not verified

- `ctx.waitUntil`, which the download counter on `pack.json` wants so the count
  does not block the response.
- Whether the two lazy `await import()` calls in `publish()` survive a real
  deploy. They work under `wrangler dev --local`.
- D1 and KV bindings, which have to be copied from `apps/registry/wrangler.toml`
  along with the cron trigger.

### To carry across

3357 lines and 22 routes, in `apps/registry/src`:

| file             | lines | notes                                      |
| ---------------- | ----- | ------------------------------------------ |
| `index.ts`       | 1574  | the router and every handler               |
| `page.ts`        | 637   | server-rendered HTML, becomes React routes |
| `auth.ts`        | 460   | GitHub OAuth, sessions, device grants      |
| `facilitator.ts` | 323   | x402 settlement                            |
| `tips.ts`        | 252   | the tip jar                                |
| `blocked.ts`     | 111   | blocklist cache, needs the KV binding      |

`apps/registry/tests` has 29 tests. They import from `src/` directly and should
move with the code rather than being rewritten.
