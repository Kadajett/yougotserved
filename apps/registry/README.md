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

## Sign-in

Identity comes from GitHub. Cloudflare sells no free way to hold consumer
accounts, and holding passwords is a liability a registry of browser adapters
does not need. GitHub already knows these people, and the account carries an age
we would otherwise have to establish ourselves.

Create an OAuth app at <https://github.com/settings/developers>:

| Field                      | Value                                                 |
| -------------------------- | ----------------------------------------------------- |
| Application name           | youGotServed                                          |
| Homepage URL               | `https://yougotserved.dev`                            |
| Authorization callback URL | `https://registry.yougotserved.dev/api/auth/callback` |

Then:

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

No scopes are requested. The registry wants to know who someone is, not to read
their code. Unset, every sign-in route answers 503 and everything else works
exactly as before.

| Route                           | Does                                            |
| ------------------------------- | ----------------------------------------------- |
| `GET /api/auth/login?return=`   | Start. `?device=` also approves a waiting agent |
| `GET /api/auth/callback`        | GitHub returns here. Sets the session cookie    |
| `GET /api/auth/me`              | The current account, or null                    |
| `POST /api/auth/logout`         | Drop the session                                |
| `POST /api/auth/device`         | An agent opens a device flow                    |
| `GET /auth/device`              | The page a human types the code into            |
| `POST /api/auth/device/approve` | Approve a waiting code. Needs a session         |
| `POST /api/auth/device/token`   | The agent polls. 202 while pending              |

### Signing in an agent

An agent has no browser to be redirected in, so it uses the device flow rather
than a loopback redirect. That works over SSH and inside a container, which is
where these agents actually run.

```bash
ygs account login     # prints a URL and an eight-character code
ygs account whoami
ygs account logout
```

The verifier never leaves the machine that started the flow until it polls, so a
code read off someone's screen is not enough to claim the token that comes out of
it. A grant can be claimed once.

## Tips

HTTP 402 is the status code reserved for payment and never standardised, so it
has been sitting unused since 1997. It is used here for its literal meaning and
nothing more: this is how to pay, and nothing on this registry is behind it.

```bash
curl -i https://registry.yougotserved.dev/api/tip
# HTTP/2 402
# { "optional": true, "gates": [], "accepts": [ { "payTo": "0x...", ... } ] }
```

`gates` is empty and is meant to stay empty. Every route works the same whether
anyone tips or not, and a claim answers `"unlocked": "nothing, on purpose"`. The
moment a rate limit starts pointing at a payment page, a tip jar has quietly
become a toll, so the two are kept apart.

| Route                     | Does                                        |
| ------------------------- | ------------------------------------------- |
| `GET /api/tip`            | 402, with how to pay                        |
| `POST /api/tip/claim`     | `{ txHash }`. Read off chain, then recorded |
| `GET /api/tip/supporters` | Verified tips, most recent first            |

Turn it on by uncommenting `TIP_ADDRESS` in `wrangler.toml`. Unset, every tip
route answers 404, which is the right default for a fork.

The Worker never holds a key. Receiving USDC needs only a public address, and
confirming a payment is a read of a public chain, so the worst this code can do
is report a tip wrongly rather than lose one.

A claim carries a transaction hash and nothing else, because a hash is the only
part a claimant cannot invent. The registry then checks the transaction
succeeded, that the log came from the token contract it expects, that the
recipient is the tip address, and how much moved. Amounts are handled as
`BigInt` throughout: USDC has six decimals and a float would round a large tip,
which is the one bug a tip jar must not have. A hash is the primary key, so the
same payment cannot be counted twice.

A tipper may attach a name and a note. Those are user text like any other and go
through the same checks as a pack description; a note that fails is dropped
while the tip still counts.

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
control changes that. So a ban can name any of five things:

| Kind          | Bans                                        |
| ------------- | ------------------------------------------- |
| `account`     | A GitHub account, by id. The sturdiest here |
| `address`     | One address. Hashed before storage          |
| `asn`         | A whole network. What a proxy pool sits in  |
| `voter`       | An install id, by its hash                  |
| `fingerprint` | The text itself, wherever it is sent from   |

An account and a fingerprint are what survive rotation. A fingerprint is deliberately lossy, so
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
