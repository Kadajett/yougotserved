# Registry

Live at <https://registry.yougotserved.dev>.

Stores and serves adapter packs. The Worker never runs adapter code, because a
pack is JSON. That keeps the extension inside the Chrome Web Store rule against
remotely hosted code.

## Deploy

Run these once. The `d1 create` step prints a `database_id`, which goes into
`wrangler.toml`.

```bash
wrangler login
wrangler d1 create yougotserved-registry
wrangler d1 execute yougotserved-registry --remote --file=schema.sql
wrangler secret put PUBLISH_TOKENS
wrangler secret put VOTER_SALT
wrangler deploy
```

## Local

The dev server uses a local D1 file and `.dev.vars`, which is gitignored. Never
put a real token in that file.

```bash
pnpm --filter @yougotserved/registry db:local
pnpm --filter @yougotserved/registry dev
```

## Publishing tokens

`PUBLISH_TOKENS` holds one token, or several separated by commas. Separate
tokens let one be revoked without locking the others out. A token shorter than
16 characters is ignored, so an empty secret cannot open the route.

## API

A pack is immutable. Publishing the same version with different bytes returns
409, so a pinned digest always resolves to the same content.

| Route                                      | Does                                                |
| ------------------------------------------ | --------------------------------------------------- |
| `GET /api/adapters?q=`                     | Search. Returns the latest version for each adapter |
| `GET /api/adapters/:id`                    | Detail, all versions, and the pack                  |
| `GET /api/adapters/:id/:version/pack.json` | Serve the pack and count the pull                   |
| `POST /api/adapters`                       | Publish. Needs a bearer token                       |
| `POST /api/adapters/:id/rate`              | Rate 1 to 5. One vote for each install id           |

## What the publish route checks

The upload arrives over the network, so the CLI's own validation proves nothing
here. Every field is checked again.

- The pack parses and passes `validatePack`
- The digest is recomputed and must match the body
- Steps are known types, and `repeat` is bounded
- A tool may not need a capability the pack does not declare
- Origins carry no path

## Free tier

D1 gives 5 GB and 5 million row reads each day. A pack is about 1 kB, so this
stays free well past the point where it matters.
