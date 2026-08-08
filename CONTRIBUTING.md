# Contributing an adapter

An adapter is a JSON pack. It holds steps, not code, so a reviewer can read the
whole thing. Send one as a pull request, and a merge publishes it to the
registry.

Packs are reviewed by a person because an adapter runs against a signed-in
browser. The check below runs first and catches the mechanical problems, which
leaves the review to the parts that need judgement.

## Send a pack

Put the file in `adapters/`. The file name must match the pack id, so
`linkedin.ygs.json` holds the pack with id `linkedin`. Run the check before you
open the pull request.

```bash
node scripts/adapters.mjs check
```

## What the check rejects

The same rules run again on the server, because a pull request proves nothing
about what reaches the registry.

- A step type the interpreter does not have, such as `exec` or `eval`
- A tool that needs a capability the pack does not declare
- An origin with a path, since a pack is fenced by origin
- A file name that does not match the pack id
- A `repeat` without a bound

## Versions never change

A published version is fixed. Publishing the same bytes again does nothing, and
publishing different bytes under the same version is rejected. Raise the version
in the pack when you change it.

```json
{ "id": "linkedin", "version": "0.3.0" }
```

## What a reviewer looks for

The mechanical checks pass on packs that are still wrong. A review reads the
origins first, then asks whether each tool needs the reach it asks for.

- Origins as narrow as the tools allow
- `risk` and `requiresConfirm` that match what the steps do
- Selectors that key on roles and stable attributes, not generated class names
- A description that says what the tool returns

## Write an adapter first

Read [AUTHORING.md](./packages/adapter-sdk/AUTHORING.md) for the loop. An agent
reads the live page once, then writes the pack. You do not write one by hand.
