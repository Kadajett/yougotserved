# Store listing

Every field the Chrome Web Store dashboard asks for. Paste each block as it is.
The permission answers are the ones a reviewer reads first, so each says what
uses the permission and what breaks without it.

Upload `app/chrome-extension/.output/yougotserved-extension-1.0.0-chrome.zip`.
Build it with `pnpm --filter yougotserved-extension zip`.

## Name and category

Category is Developer Tools. The audience is people who already run an MCP
client, not general browser users.

```text
Name:     youGotServed
Category: Developer Tools
Language: English
```

## Short description

The store allows 132 characters. This one is 118.

```text
Let your AI coding agent use the sites you are already signed in to, through site tools instead of raw browser calls.
```

## Detailed description

```text
youGotServed connects an MCP client, such as Claude Code, to the Chrome you
already use. Your agent works in your real profile, so every site you are
signed in to stays signed in. Nothing is scraped from a second browser and no
password is ever handed to a model.

The point is site tools. Instead of asking an agent to read a whole page and
guess at the buttons, an adapter gives it one clear tool, such as
linkedin_search_people, that returns the four fields it asked for. Reading a
search page can cost tens of thousands of tokens. The same result through an
adapter costs a few hundred.

An adapter is data, not code. It is a JSON file that lists steps, and a fixed
interpreter in this extension walks those steps. An adapter cannot read your
cookies, call fetch, or run JavaScript of its own, because the interpreter does
none of those things. It also states which sites it may touch, and the
extension refuses any address outside that list.

Adapters are shared through an open registry. Your agent can search it, read
what an adapter is allowed to do, and install it, without leaving the session.
Installing always shows the sites and the abilities first, and writes nothing
until you agree.

This extension needs a small local program to run. Install it with:
  npm install -g ygs-bridge

Source, adapters and the privacy policy:
https://github.com/Kadajett/yougotserved
```

## Single purpose

The store requires one sentence, and rejects an extension that reads as a
bundle of unrelated features.

```text
This extension lets a local MCP client drive the pages the user chooses, so an
AI coding agent can use sites the user is already signed in to.
```

## Permission justifications

One line for each permission in the manifest. A missing answer is a common
reason for a rejection.

```text
nativeMessaging
  Speaks to the local ygs-bridge program, which is how the MCP client reaches
  the browser. Without it the extension has nothing to talk to.

debugger
  Sets files on a file input for uploads, and captures response bodies. Chrome
  offers no other API for either. It is attached only for the tab a tool is
  working on, and detached after.

tabs, activeTab, scripting, webNavigation
  Read the page and act on it: click, fill, extract, and wait for a navigation
  to finish. These are the tools themselves.

<all_urls>
  Adapters are written for whatever sites the user chooses, so the tools must be
  able to reach the page the user points them at. The extension states each
  adapter's origins at install and refuses any address outside them.

webRequest
  Records network activity when the caller does not need a response body.
  Attaching the debugger instead would put a warning bar on the user's page.

downloads
  Saves a file a tool was asked to download.

storage
  Keeps settings and installed adapters on this machine.

offscreen
  Encodes screenshots and recordings, which needs a document.
```

## Remote code

The answer is no, and the reason matters, because an adapter arrives over the
network. A pack is JSON that a fixed interpreter reads. No JavaScript is
fetched, evaluated, or injected from any server.

```text
No, I am not using remote code.
```

## Data use

Nothing is collected. The extension has no analytics, no telemetry, and sends
nothing to us.

```text
Does not collect or transmit user data.
Privacy policy: https://github.com/Kadajett/yougotserved/blob/master/PRIVACY.md
```

## Screenshots

The store wants at least one, at 1280 by 800 or 640 by 400. Upload
`docs/store/screenshot-activity-panel.png`. It is a real run, and the panel
names the adapter tool beside each browser call it made.

Later additions, when there is something to show:

- The install step printing the origins and refusing without confirmation
- The registry page listing adapters
