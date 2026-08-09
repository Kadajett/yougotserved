# Privacy

youGotServed runs on your machine. The extension sends no data to us, and there
is no analytics code and no telemetry in it. Page content goes to your own MCP
client over a local connection, and nowhere else.

Three things reach the network, and each one is an action you start. This page
says what each one sends.

## What stays on your machine

The extension speaks to a local host program over Chrome native messaging. That
host speaks to your MCP client. Nothing in that path leaves your computer.

- Page text, screenshots and network captures
- The pages you open and what you type into them
- Your cookies and your signed-in sessions, which the extension never reads out
- Installed adapter packs, held in `~/.yougotserved/adapters`

## What the registry receives

The registry serves adapter packs. It sees a request only when you search for an
adapter, install one, or rate one.

- **Search**: your search words, and the usual web request data
- **Install**: which adapter and version you pulled, counted for each day
- **Rating**: your score from 1 to 5, with a salted hash of a random install id

The install id is random, made once, and kept in a file on your machine. The
registry stores only a salted hash of it, so it can count one vote for each
machine without learning which machine sent it. You can delete the file at any
time.

```bash
rm ~/.yougotserved/adapters/.install-id
```

## What an adapter can reach

An adapter states its origins, and the host refuses any address outside them. It
also states its capabilities, and the install step prints both before it writes
anything to disk.

An adapter is data, not code. It cannot read your cookies, call `fetch`, or run
JavaScript of its own, because the interpreter that walks its steps does none of
those things.

## Permissions and why

The store shows a list at install time. Each item below is used for the work the
tools do, and for nothing else.

- `debugger`: file uploads and response body capture, which Chrome allows no
  other way
- `<all_urls>`: adapters are written for sites you choose, so the tools must be
  able to reach the page you are on
- `nativeMessaging`: to speak to the local host
- `tabs`, `activeTab`, `scripting`: to find, read and drive the page you point a
  tool at
- `webNavigation`: to start a persistent user script at the right moment
- `downloads`, `webRequest`, `storage`, `offscreen`: used by single tools

That is the whole list. The extension does not ask for `history`, `bookmarks`,
`sidePanel`, `contextMenus` or `alarms`, and the tools that used them are gone.

## Contact

Open an issue at <https://github.com/Kadajett/yougotserved/issues>.
