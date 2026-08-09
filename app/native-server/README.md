# ygs-bridge

The native messaging host for [youGotServed](https://yougotserved.dev). It sits
between a coding agent and the Chrome extension, and it serves the MCP tools
the agent calls.

Give a coding agent one tool that does the job, instead of thirty that describe
a browser. Tools run in the browser you already signed in to, so there is no
second profile and no cookie export.

## Install

```
npm install -g ygs-bridge
```

Then register the host with Chrome, and load the extension.

```
ygs register
```

## What this package is

This package is the host half. The extension is the other half, and both have
to be installed for anything to work. Read
[the project README](https://github.com/Kadajett/yougotserved) for the whole
picture.

The host also serves the adapter registry tools. An agent can search for a
site adapter, read what it would be allowed to reach, and install it, without
leaving its session.

## Registry

Adapters come from <https://registry.yougotserved.dev>. Set `YGS_REGISTRY_URL`
to point somewhere else, such as a registry you run yourself.

An adapter is data, never code. It states the origins it may reach, and the
host refuses anything outside them.

## Licence

MIT. See [LICENSE](https://github.com/Kadajett/yougotserved/blob/master/LICENSE).
