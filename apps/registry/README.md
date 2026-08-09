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
| `GET /api/challenge`                       | A proof-of-work challenge for an anonymous write    |
| `POST /api/adapters`                       | Publish. Needs a bearer token                       |
| `POST /api/adapters/:id/rate`              | Rate 1 to 5. Needs a solved challenge               |

Maintainer routes answer 404 without a token, so they do not advertise
themselves:

| Route                      | Does                                           |
| -------------------------- | ---------------------------------------------- |
| `GET /api/moderation`      | The queue: everything held, worst first        |
| `POST /api/moderation/:id` | `{}` clears a hold, `{"drop":true}` deletes it |
| `POST /api/bans`           | Add or lift a ban                              |

## What the publish route checks

The upload arrives over the network, so the CLI's own validation proves nothing
here. Every field is checked again.

- The pack parses and passes `validatePack`
- The digest is recomputed and must match the body
- Steps are known types, and `repeat` is bounded
- A tool may not need a capability the pack does not declare
- Origins carry no path
- Every line of author-written prose passes `@yougotserved/moderation`

## Proof of work

Turnstile asks whether you are a browser. Most writes here come from an agent,
which is not one and should never be taught to pretend otherwise. So a write
costs CPU instead.

```bash
curl https://registry.yougotserved.dev/api/challenge
# { "challenge": "...", "bits": 20, "how": "..." }
```

Find a nonce where `sha256("<challenge>:<nonce>")` starts with 20 zero bits,
then send `{ challenge, nonce }` with the write. About a second of one core, and
a challenge can be spent once. `ygs-bridge` does this for you.

A browser can send `turnstileToken` instead. A maintainer token beats both.

## Moderation

Author-written prose is checked on publish. `block` refuses the upload with the
reason. `review` accepts it and hides it: the bytes are stored, nothing is
listed, and it shows up in the queue.

A hold lifts three ways. Republishing with clean text clears it without anyone
being asked, which is the fix path for a false positive. A moderator can clear
it, and that decision survives later republishes of text no worse than what they
read. Or a moderator drops the adapter.

```bash
curl -H "authorization: Bearer $TOKEN" $REGISTRY/api/moderation
curl -X POST -H "authorization: Bearer $TOKEN" $REGISTRY/api/moderation/someid -d '{}'
curl -X POST -H "authorization: Bearer $TOKEN" $REGISTRY/api/moderation/someid -d '{"drop":true}'
```

## Bans

Banning an address does nothing to someone renting a proxy pool, and no free
control changes that. So a ban can name any of four things:

| Kind          | Bans                                       |
| ------------- | ------------------------------------------ |
| `address`     | One address. Hashed before storage         |
| `asn`         | A whole network. What a proxy pool sits in |
| `voter`       | An install id, by its hash                 |
| `fingerprint` | The text itself, wherever it is sent from  |

The last two are what survive rotation. A fingerprint is deliberately lossy, so
unrelated text can collide with it: read the submission before banning one.

```bash
curl -X POST -H "authorization: Bearer $TOKEN" $REGISTRY/api/bans \
  -d '{"kind":"asn","value":"14061","reason":"Spam only, appeal to jeremy@...","days":30}'
curl -X POST -H "authorization: Bearer $TOKEN" $REGISTRY/api/bans \
  -d '{"kind":"asn","value":"14061","lift":true}'
```

Prefer `days` over a permanent ban. A wrong ban that lapses is a bad week; a
wrong permanent one is a person who never comes back and never finds out why.
The reason is shown to whoever is refused, so write it for them.

## Free tier

D1 gives 5 GB and 5 million row reads each day. A pack is about 1 kB, so this
stays free well past the point where it matters.
