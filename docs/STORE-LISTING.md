# Store listing

Every field the Chrome Web Store dashboard asks for, in the order the dashboard
asks for it. Work down this file and paste each block into the box above it.

Each permission gets its own box, and each box wants an answer about that one
permission. A shared answer across several boxes reads as a copied form.

## Package

```text
Upload:  app/chrome-extension/.output/yougotserved-extension-1.0.0-chrome.zip
Build:   pnpm --filter yougotserved-extension zip
```

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
hackernews_top_stories, that returns the four fields it asked for. Reading a
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

## Single purpose description

One sentence. The store rejects an extension that reads as a bundle of
unrelated features.

```text
This extension lets a local MCP client drive the pages the user chooses, so an AI coding agent can use sites the user is already signed in to.
```

## nativeMessaging justification

```text
Speaks to the local ygs-bridge program, which is how the MCP client reaches the browser. Without it the extension has nothing to talk to.
```

## tabs justification

```text
Finds the tab a tool was pointed at, and reports which tabs are open when the agent asks. Without it a tool cannot tell one tab from another.
```

## activeTab justification

```text
Reads and captures the tab the user is looking at when a call names no other tab. The screenshot tool is the main caller.
```

## scripting justification

```text
Runs the read and click steps inside the page. This is the tool work itself, so no tool functions without it.
```

## downloads justification

```text
Saves a file that a tool was asked to download, and reports where it landed.
```

## webRequest justification

```text
Records network activity for a tab when the caller does not need response bodies. Attaching the debugger instead would put a warning bar across the user's page.
```

## webNavigation justification

```text
Tells a persistent user script when to run, at document start or at DOM ready. The tab update event fires too late for either.
```

## debugger justification

```text
Sets files on a file input for uploads, and captures response bodies. Chrome offers no other API for either. It is attached only for the tab a tool is working on, and detached when that work ends.
```

## offscreen justification

```text
Encodes screenshots and recordings. That work needs a document, and a service worker does not have one.
```

## storage justification

```text
Keeps settings and the list of installed adapters on this machine.
```

## Host permission justification

This box is asking about `<all_urls>`. A vague answer is the usual cause of a
slow review, so it says why no fixed list is possible.

```text
An adapter is written for whatever site the user chooses, so a tool has to reach the page the user points it at. There is no fixed list we could declare up front, because the user decides which adapters to install.

The extension does not treat this as open access. Every adapter states its own origins, those origins are shown before it is installed, and the extension refuses any address outside them.
```

## Remote code

Pick the first radio button. The box below it still wants an answer, because an
adapter arrives over the network.

```text
No, I am not using Remote code
```

```text
No JavaScript or Wasm is fetched or evaluated. An adapter arrives over the network, but it is JSON that lists steps, and a fixed interpreter inside the package reads it. There is no eval, no Function constructor, and no script tag pointing outside the package.
```

## Data usage

Leave every box unchecked. The extension sends nothing to us, and page content
goes to a local program on the user's own machine.

Then certify all three disclosures, which are true. Nothing is sold, nothing is
transferred, and nothing touches creditworthiness or lending.

```text
Collected data categories: none
Privacy policy: https://github.com/Kadajett/yougotserved/blob/master/PRIVACY.md
```

## Screenshots

The store wants at least one, at 1280 by 800 or 640 by 400, and allows five.
Upload `docs/store/screenshot-activity-panel.png`, a 24-bit PNG with no alpha.

It is a real run, and the panel names the adapter tool beside each browser call
it made. Later additions, when there is something to show:

- The install step printing the origins and refusing without confirmation
- The registry page listing adapters
