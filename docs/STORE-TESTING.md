# Test Instructions for Reviewers

Written in Simplified Technical English. Each step is one action.

## 1. What the extension does

youGotServed connects an AI coding agent to Chrome. The agent reads pages and
fills forms in the tabs that you open. The extension holds no AI model and makes
no decisions. It obeys commands from a program on the same computer.

The user starts every action. The extension does nothing on its own.

## 2. Why a second program is necessary

The extension cannot work alone. Please read this section before you test.

AI agents speak the Model Context Protocol. That protocol needs standard input
and output, or a local HTTP port. A Chrome extension can supply neither. So a
small companion program supplies both, and speaks to the extension through
Chrome native messaging.

The companion program is free and open source. Its name is `ygs-bridge`.

- Source code: https://github.com/Kadajett/yougotserved
- Package: https://www.npmjs.com/package/ygs-bridge

## 3. Before you start

You need these three items:

- Chrome 116 or a later version
- Node.js 20 or a later version
- A terminal

You do not need an account. You do not need a password. The test uses public
web pages only.

## 4. Install the companion program

1. Open a terminal.
2. Type `npm install -g ygs-bridge` and press Enter.
3. Type `ygs register` and press Enter.
4. Type `ygs doctor` and press Enter.

The `register` command writes a native messaging manifest. The manifest permits
one extension ID only. That ID is `hbdgbgagpkpjffpklnamcljpakneikee`, which is
the ID of the store listing. No other extension can connect.

The `doctor` command prints a report. Each line must show OK. If a line shows a
problem, the report tells you how to correct it.

## 5. Connect the extension

1. Install the extension from the Chrome Web Store.
2. Click the extension icon in the toolbar.
3. Read the status line in the popup.
4. Make sure the port is 12306.
5. Click Connect.

The status dot becomes green. The status text shows the connected state.

If the dot stays red, run `ygs doctor` again. The most frequent cause is a
Chrome restart that is not yet complete.

## 6. Test 1: read a page

This test needs no AI agent.

1. Open a new tab.
2. Go to https://news.ycombinator.com.
3. Click the extension icon.
4. Open the tools panel.
5. Run the `chrome_get_web_content` tool.

The tool returns the text of the page. This shows that the extension reads only
the tab that you chose.

## 7. Test 2: an adapter

An adapter is a JSON file. It names the sites that one tool can reach. An
adapter contains data, and never code. The extension cannot run code from our
servers, because no such path exists.

1. Open a terminal.
2. Type `ygs adapter search hackernews` and press Enter.
3. Type `ygs adapter install hackernews` and press Enter.
4. Read the origins that the command prints.
5. Type `ygs adapter list` and press Enter.

The origins are the only addresses that this adapter can open. The host refuses
every other address. You can read the same file at
`~/.yougotserved/adapters/hackernews.ygs.json`.

## 8. Test 3: an agent, which is optional

Use this test if you have an MCP client, such as Claude Desktop.

1. Add `ygs-bridge` to the client as an MCP server.
2. Restart the client.
3. Ask the client for the top stories on Hacker News.

The client calls the `hackernews_top_stories` tool. The extension opens the
site in your browser and reads the list.

## 9. Why each permission is necessary

| Permission        | Reason                                                      |
| ----------------- | ----------------------------------------------------------- |
| `nativeMessaging` | Speaks to the companion program. Nothing works without it.  |
| `tabs`            | Lists the open tabs, and moves between them.                |
| `activeTab`       | Acts on the tab that the user selected.                     |
| `scripting`       | Reads the text of a page, and fills a form.                 |
| `downloads`       | Saves a file when the user asks a tool to save one.         |
| `webRequest`      | Captures a network response for the network tool.           |
| `webNavigation`   | Detects the moment a page finishes to load.                 |
| `debugger`        | Records performance traces, and reads console messages.     |
| `offscreen`       | Runs the text-similarity engine in a worker, off the page.  |
| `storage`         | Keeps the port number and the user settings.                |
| `<all_urls>`      | An adapter can name any site, so the site set is not fixed. |

The `debugger` permission needs more words. Chrome shows a yellow bar while it
is in use. Three tools use it: the performance trace, the console reader, and
the network capture. Each tool attaches to one tab, and detaches at the end. The
extension never attaches without a command from the user.

The `<all_urls>` permission also needs more words. A user can install an adapter
for any site, so we cannot list the sites in advance. The limit is in the
adapter: each one declares its origins, and the host refuses every address
outside that list. Section 7 shows this.

## 10. What leaves the computer

Page content stays on the computer. The extension sends page content to the
companion program, and the companion program sends it to the AI client that the
user chose. We operate no server in that path.

The extension contacts one server of ours, and only when the user installs an
adapter. That server is `registry.yougotserved.dev`. It sends a JSON file. It
receives the adapter name and an anonymous count.

The full statement is in PRIVACY.md.

## 11. If you cannot install Node.js

Tell us, and we will supply a recorded demonstration of every step. Section 5
alone shows the connection, and needs no test of an agent.
