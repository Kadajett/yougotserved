# Test Instructions

## Why a second program is needed

The extension cannot work alone. AI agents speak the Model Context Protocol.
That protocol needs standard input and output, or a local port. A Chrome
extension supplies neither. So a small companion program supplies both, and
speaks to the extension through native messaging.

It is free and open source: https://github.com/Kadajett/yougotserved

## Setup

You need Chrome 116 or later, Node.js 20 or later, and a terminal. You do not
need an account. You do not need a password.

1. Open a terminal.
2. Type `npm install -g ygs-bridge` and press Enter.
3. Type `ygs register` and press Enter.
4. Type `ygs doctor` and press Enter.

Each line of the report must show OK.

The `register` command writes a native messaging manifest. The manifest permits
one extension ID only, which is `hbdgbgagpkpjffpklnamcljpakneikee`. No other
extension can connect.

## Test

1. Click the extension icon.
2. Make sure the port is 12306.
3. Click Connect.
4. Open https://news.ycombinator.com in a tab.
5. Run the `chrome_get_web_content` tool from the popup.

The status dot becomes green at step 3. The tool returns the text of that tab
only.

If the dot stays red, run `ygs doctor` again. The usual cause is a Chrome
restart that is not yet complete.

## Adapters

An adapter is a JSON file. It declares the sites that one tool can reach. It
holds data, and never code. The extension cannot run remote code, because no
such path exists.

Type `ygs adapter install hackernews`. The command prints the origins. The host
refuses every address outside them. You can read the file at
`~/.yougotserved/adapters/hackernews.ygs.json`.

## Permissions

- `nativeMessaging`: speaks to the companion program.
- `tabs`, `activeTab`: lists the tabs, and acts on the chosen one.
- `scripting`: reads the text of a page, and fills a form.
- `downloads`: saves a file when the user asks.
- `webRequest`, `webNavigation`: captures a response, and detects a page load.
- `debugger`: records performance traces, and reads console messages.
- `offscreen`: runs the text-similarity engine in a worker.
- `storage`: keeps the port number and the settings.
- `<all_urls>`: an adapter can name any site.

The `debugger` permission attaches to one tab on a user command, and detaches at
the end. Chrome shows its yellow bar throughout. Three tools use it: the
performance trace, the console reader, and the network capture.

The `<all_urls>` permission cannot be narrower, because a user can install an
adapter for any site. The real limit sits inside each adapter, as the origins
above show.

## Data

Page content stays on the computer. The extension sends it to the companion
program. The companion program sends it to the AI client that the user chose. We
operate no server in that path.

The extension contacts `registry.yougotserved.dev` only when the user installs
an adapter. It receives a JSON file, and sends the adapter name.

Tell us if you cannot install Node.js. We will send a recorded demonstration.
