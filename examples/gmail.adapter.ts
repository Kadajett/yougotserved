import {
  defineSiteAdapter,
  defineTool,
  err,
  ok,
  p,
  type BrowserSession,
  type ExtractedRecord,
} from '@yougotserved/adapter-sdk';

const BASE = 'https://mail.google.com';
const MAIN = '[role="main"]';
const THREAD_ROW = `${MAIN} [role="grid"] tr[role="row"]`;
const SENDER = '[email][name]';
const SUBJECT = '[role="gridcell"] [role="link"] [data-legacy-thread-id]';
const ROW_CONTENT = '[role="gridcell"] [role="link"]';
const ROW_DATE = '[role="gridcell"] [title][aria-label]';
const MESSAGE = `${MAIN} [data-message-id]`;
const THREAD_SUBJECT = `${MAIN} h2[data-legacy-thread-id]`;

function authenticationError(url: string) {
  if (!/accounts\.google\.com|\/signin|\/ServiceLogin/i.test(url)) return null;
  return err('not_authenticated', 'Gmail redirected to Google sign-in.', {
    hint: 'Sign in to Gmail in the connected Chrome profile, then run this again.',
    url,
  });
}

function gmailUrl(hash: string): string {
  return `${BASE}/mail/u/0/#${hash}`;
}

function safeThreadId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function openSearch(page: BrowserSession, query: string) {
  await page.goto(gmailUrl(`search/${encodeURIComponent(query)}`));
  await page.waitFor({ networkIdle: true, forMs: 1_000 });
  return authenticationError(page.url);
}

async function extractThreads(page: BrowserSession, limit: number): Promise<ExtractedRecord[]> {
  return page.extract({
    each: THREAD_ROW,
    limit,
    fields: {
      sender: { selector: SENDER, attr: 'name' },
      senderEmail: { selector: SENDER, attr: 'email' },
      subject: SUBJECT,
      threadId: { selector: SUBJECT, attr: 'data-legacy-thread-id' },
      content: ROW_CONTENT,
      timestamp: { selector: ROW_DATE, attr: 'title' },
    },
  });
}

function codeCandidates(text: string): string[] {
  const candidates =
    text.match(
      /\b(?:\d{4,10}|(?=[A-Za-z0-9-]{6,16}\b)(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{6,16})\b/g,
    ) ?? [];
  return [...new Set(candidates)].filter((candidate) => !/^20\d{2}$/.test(candidate));
}

function chooseCode(text: string): { code: string | null; candidates: string[] } {
  const candidates = codeCandidates(text);
  const lower = text.toLowerCase();
  const ranked = candidates
    .map((candidate, index) => {
      const position = lower.indexOf(candidate.toLowerCase());
      const context = lower.slice(Math.max(0, position - 120), position + 24);
      const score =
        (/security code|verification code|confirmation code|one.?time|passcode|\botp\b|code field/.test(
          context,
        )
          ? 100
          : 0) +
        (/code|verify|authentication/.test(lower.slice(0, 200)) ? 25 : 0) -
        index;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score);
  return { code: ranked[0]?.candidate ?? null, candidates };
}

async function threadMessages(page: BrowserSession, threadId: string) {
  await page.goto(gmailUrl(`all/${threadId}`));
  try {
    await page.waitFor({ selector: MESSAGE }, { timeoutMs: 15_000 });
  } catch {
    // The caller reports a typed selector error below.
  }
  if (!(await page.exists(MESSAGE))) return null;
  return page.extract({
    each: MESSAGE,
    limit: 20,
    fields: {
      messageId: { attr: 'data-legacy-message-id' },
      sender: { selector: SENDER, attr: 'name' },
      senderEmail: { selector: SENDER, attr: 'email' },
      timestamp: { selector: 'span[title][alt]', attr: 'title' },
      body: {},
    },
  });
}

export default defineSiteAdapter({
  id: 'gmail',
  name: 'Gmail',
  version: '0.1.0',
  description: 'Search job correspondence and retrieve authentication codes.',
  origins: ['https://mail.google.com'],
  signInUrl: 'https://mail.google.com/mail/u/0/',
  capabilities: ['navigate', 'read'],

  tools: {
    search_threads: defineTool({
      description: 'Search Gmail threads.',
      returns: 'sender, subject, timestamp, snippet and stable thread ID',
      params: {
        query: p.string('Gmail search query'),
        limit: p.integer('Maximum threads').default(10).min(1).max(50),
      },
      capabilities: ['navigate', 'read'],
      handler: async (page, args) => {
        const authError = await openSearch(page, args.query);
        if (authError) return authError;
        if (!(await page.exists(MAIN))) {
          return err('selector_missing', 'Gmail rendered without its main mailbox region.', {
            hint: 'Re-run live selector discovery for examples/gmail.adapter.ts.',
            url: page.url,
          });
        }
        if (!(await page.exists(THREAD_ROW))) {
          const text = await page.text(MAIN);
          if (/no emails|no messages|did not match/i.test(text ?? '')) {
            return ok([], { summary: `No Gmail threads for "${args.query}"` });
          }
          return err('selector_missing', 'Gmail search rendered without parseable rows.', {
            hint: 'Re-run live selector discovery for examples/gmail.adapter.ts.',
            url: page.url,
          });
        }
        const threads = await extractThreads(page, args.limit);
        const parsed = threads.filter(
          (thread) => typeof thread.subject === 'string' && typeof thread.threadId === 'string',
        );
        if (parsed.length === 0) {
          return err('selector_missing', 'Gmail rows rendered, but their fields did not parse.', {
            hint: 'Re-run live selector discovery for examples/gmail.adapter.ts.',
            url: page.url,
          });
        }
        return ok(parsed, {
          summary: `${parsed.length} Gmail threads for "${args.query}"`,
          truncated: parsed.length >= args.limit,
        });
      },
    }),

    get_thread: defineTool({
      description: 'Read a Gmail thread.',
      returns: 'subject and up to 20 messages with sender, timestamp and body',
      params: {
        threadId: p.string('Thread ID returned by search_threads'),
      },
      capabilities: ['navigate', 'read'],
      handler: async (page, args) => {
        if (!safeThreadId(args.threadId)) {
          return err('invalid_input', 'Gmail thread ID has an invalid format.');
        }
        const messages = await threadMessages(page, args.threadId);
        const authError = authenticationError(page.url);
        if (authError) return authError;
        if (!messages) {
          return err('selector_missing', 'Gmail rendered without parseable messages.', {
            hint: 'Re-run live selector discovery for examples/gmail.adapter.ts.',
            url: page.url,
          });
        }
        const subject = await page.text(THREAD_SUBJECT);
        return ok(
          { subject, threadId: args.threadId, url: page.url, messages },
          { summary: `${messages.length} messages in ${subject ?? 'Gmail thread'}` },
        );
      },
    }),

    find_auth_codes: defineTool({
      description: 'Find recent authentication codes.',
      returns: 'likely code candidates with matching Gmail thread provenance',
      params: {
        hint: p.string('Company, platform, or subject hint').optional(),
        sender: p.string('Optional sender email or domain').optional(),
        hours: p.integer('How far back to search').default(24).min(1).max(168),
        limit: p.integer('Maximum matching threads').default(5).min(1).max(10),
      },
      capabilities: ['navigate', 'read'],
      handler: async (page, args) => {
        const age =
          args.hours % 24 === 0 ? `newer_than:${args.hours / 24}d` : `newer_than:${args.hours}h`;
        const parts = [
          age,
          '{subject:"security code" subject:"verification code" subject:"confirmation code" subject:OTP "one-time code"}',
        ];
        if (args.hint) parts.push(`"${args.hint.replace(/"/g, '')}"`);
        if (args.sender) parts.push(`from:(${args.sender.replace(/[()\s]/g, '')})`);
        const query = parts.join(' ');
        const authError = await openSearch(page, query);
        if (authError) return authError;
        if (!(await page.exists(MAIN))) {
          return err('selector_missing', 'Gmail rendered without its main mailbox region.', {
            hint: 'Re-run live selector discovery for examples/gmail.adapter.ts.',
            url: page.url,
          });
        }
        if (!(await page.exists(THREAD_ROW))) {
          return ok([], { summary: 'No recent authentication-code emails found' });
        }

        const threads = await extractThreads(page, args.limit);
        const results: Array<Record<string, unknown>> = [];
        for (const thread of threads) {
          const threadId = stringValue(thread.threadId);
          if (!safeThreadId(threadId)) continue;
          let content = stringValue(thread.content);
          let selected = chooseCode(content);
          if (!selected.code) {
            const messages = await threadMessages(page, threadId);
            content = (messages ?? []).map((message) => stringValue(message.body)).join(' ');
            selected = chooseCode(content);
          }
          if (!selected.code) continue;
          results.push({
            code: selected.code,
            candidates: selected.candidates,
            sender: thread.sender,
            senderEmail: thread.senderEmail,
            subject: thread.subject,
            timestamp: thread.timestamp,
            threadId,
            threadUrl: gmailUrl(`all/${threadId}`),
          });
        }
        return ok(results, {
          summary: `${results.length} recent authentication-code emails`,
          truncated: threads.length >= args.limit,
        });
      },
    }),
  },
});
