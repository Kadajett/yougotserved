import {
  defineSiteAdapter,
  defineTool,
  err,
  ok,
  p,
  type BrowserSession,
} from '@yougotserved/adapter-sdk';

const APPLY_FLOW = '[data-automation-id="applyFlowPage"]';
const ACCOUNT = '[data-automation-id="signInContent"]';
const ACCOUNT_FORM = 'form[data-automation-id="signInFormo"]';
const NEXT = '[data-automation-id="bottom-navigation-next-button"]';
const FORM_FIELD = '[data-automation-id^="formField-"]';

const answerParam = p.object({
  automationId: p.string('Control data-automation-id from inspection'),
  label: p.string('Expected field label'),
  kind: p.enum(['text', 'select', 'click'] as const, 'Control type'),
  value: p.string('Text, select value, or click target value').optional(),
});

const stepParam = p.object({
  heading: p.string('Expected Workday step heading'),
  answers: p.array(answerParam, 'Answers for this step'),
});

function safeAutomationId(value: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(value);
}

function byAutomationId(value: string): string {
  return `[data-automation-id=${JSON.stringify(value)}]`;
}

function applicationUrl(input: string): string {
  const url = new URL(input);
  url.search = '';
  url.hash = '';
  if (!/\/apply(?:\/|$)/.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/apply`;
  }
  return url.toString();
}

async function openEntry(page: BrowserSession, url: string) {
  await page.goto(applicationUrl(url));
  await page.waitFor({ networkIdle: true, forMs: 1_000 });
  if (
    (await page.exists(APPLY_FLOW)) ||
    (await page.exists('[data-automation-id="autofillWithResume"]'))
  ) {
    return null;
  }
  const text = await page.text('main, body');
  if (/job (?:is )?(?:closed|expired|not found)|no longer available/i.test(text ?? '')) {
    return err('not_found', 'This Workday job is no longer accepting applications.', {
      url: page.url,
    });
  }
  return err('selector_missing', 'Workday rendered without its application flow.', {
    hint: 'Re-run live selector discovery for examples/workday.adapter.ts.',
    url: page.url,
  });
}

async function enterAccountStep(page: BrowserSession) {
  if (await page.exists(ACCOUNT)) return;
  if (await page.exists('[data-automation-id="autofillWithResume"]')) {
    const entry = await page.extract({
      fields: {
        href: {
          selector: '[data-automation-id="autofillWithResume"]',
          prop: 'href',
        },
      },
    });
    if (typeof entry.href === 'string') await page.goto(entry.href);
    else await page.click('[data-automation-id="autofillWithResume"]');
    try {
      await page.waitFor({ selector: ACCOUNT }, { timeoutMs: 15_000 });
    } catch {
      // An existing signed-in session can advance directly to resume upload.
    }
  }
}

async function currentFields(page: BrowserSession, limit: number) {
  return page.extract({
    each: FORM_FIELD,
    limit,
    fields: {
      fieldAutomationId: { attr: 'data-automation-id' },
      label: {},
      controlAutomationId: {
        selector:
          'input[data-automation-id], textarea[data-automation-id], select[data-automation-id], button[data-automation-id]',
        attr: 'data-automation-id',
      },
      inputType: { selector: 'input', attr: 'type', fallback: null },
      hasTextarea: { selector: 'textarea', exists: true },
      hasSelect: { selector: 'select', exists: true },
      required: { selector: 'input[required], textarea[required], select[required]', exists: true },
    },
  });
}

export default defineSiteAdapter({
  id: 'workday',
  name: 'Workday',
  version: '0.1.0',
  description: 'Inspect and submit Workday job applications.',
  origins: ['https://*.myworkdayjobs.com'],
  capabilities: ['navigate', 'read', 'interact', 'upload'],
  uploads: {
    allowedExtensions: ['pdf', 'doc', 'docx'],
    maxBytes: 10 * 1024 * 1024,
  },

  tools: {
    inspect_application: defineTool({
      description: 'Inspect a Workday application.',
      returns: 'title, progress steps, account state and current fields',
      params: {
        url: p.url('Public Workday job URL'),
        limit: p.integer('Maximum current fields').default(50).min(1).max(100),
      },
      capabilities: ['navigate', 'read', 'interact'],
      handler: async (page, args) => {
        const unavailable = await openEntry(page, args.url);
        if (unavailable) return unavailable;
        await enterAccountStep(page);
        const title = await page.text('[data-automation-id="jobTitleHeading"]');
        const progress = await page.extract({
          fields: {
            steps: {
              selector: '[data-automation-id="progressBar"] li',
              all: true,
            },
          },
        });
        const accountRequired = await page.exists(ACCOUNT);
        const accountFields = accountRequired
          ? await page.extract({
              fields: {
                email: { selector: '[data-automation-id="email"]', exists: true },
                password: { selector: '[data-automation-id="password"]', exists: true },
                verifyPassword: {
                  selector: '[data-automation-id="verifyPassword"]',
                  exists: true,
                },
                signInAvailable: {
                  selector: '[data-automation-id="signInLink"]',
                  exists: true,
                },
              },
            })
          : null;
        const fields = accountRequired ? [] : await currentFields(page, args.limit);
        return ok(
          {
            title,
            url: page.url,
            accountRequired,
            accountFields,
            progressSteps: progress.steps,
            fields,
          },
          {
            summary: accountRequired
              ? `Workday account required for ${title ?? 'application'}`
              : `${fields.length} current Workday fields for ${title ?? 'application'}`,
          },
        );
      },
    }),

    apply: defineTool({
      description: 'Fill and submit a Workday application.',
      returns: 'job title, final URL and Workday confirmation text',
      risk: 'irreversible',
      timeoutMs: 600_000,
      capabilities: ['navigate', 'read', 'interact', 'upload'],
      params: {
        url: p.url('Public Workday job URL'),
        email: p.string('Workday account email'),
        password: p.string('Workday account password'),
        createAccount: p.boolean('Create a tenant account').default(false),
        resume: p.file('Resume to attach'),
        steps: p.array(stepParam, 'Ordered Workday steps after resume upload'),
      },
      handler: async (page, args) => {
        const unavailable = await openEntry(page, args.url);
        if (unavailable) return unavailable;
        await enterAccountStep(page);
        const title = await page.text('[data-automation-id="jobTitleHeading"]');

        if (await page.exists(ACCOUNT)) {
          if (!args.createAccount) {
            await page.click('[data-automation-id="signInLink"]');
            try {
              await page.waitFor(
                { selectorGone: '[data-automation-id="verifyPassword"]' },
                { timeoutMs: 10_000 },
              );
            } catch {
              return err('selector_missing', 'Workday sign-in form did not render.', {
                hint: 'Re-run live selector discovery for examples/workday.adapter.ts.',
                url: page.url,
              });
            }
          }
          await page.fill('[data-automation-id="email"]', args.email);
          await page.fill('[data-automation-id="password"]', args.password);
          if (args.createAccount) {
            await page.fill('[data-automation-id="verifyPassword"]', args.password);
          }
          await page.click(`${ACCOUNT_FORM} button[type="submit"]`);
          try {
            await page.waitFor({ selectorGone: ACCOUNT }, { timeoutMs: 30_000 });
          } catch {
            const accountText = await page.text(ACCOUNT);
            if (/captcha|challenge|verification code|verify.{0,20}human/i.test(accountText ?? '')) {
              return err('challenge_required', 'Workday requires account verification.', {
                hint: 'Complete verification in Chrome, then run the adapter again.',
                retryable: false,
                url: page.url,
              });
            }
            return err('failed', 'Workday account sign-in or creation failed.', {
              hint: accountText?.slice(0, 300),
              retryable: false,
              url: page.url,
            });
          }
        }

        const resumeInput = '[data-automation-id="file-upload-input-ref"], input[type="file"]';
        if (!(await page.exists(resumeInput))) {
          return err('selector_missing', 'Workday resume upload is missing.', {
            hint: 'Inspect the authenticated tenant before retrying.',
            url: page.url,
          });
        }
        await page.upload(resumeInput, args.resume);
        if (!(await page.exists(NEXT))) {
          return err('selector_missing', 'Workday next-step control is missing.', {
            hint: 'Inspect the authenticated tenant before retrying.',
            url: page.url,
          });
        }
        await page.click(NEXT);

        for (const step of args.steps) {
          const heading = await page.text(
            '[data-automation-id="pageHeaderTitle"], [data-automation-id="sectionTitle"]',
          );
          if (!heading?.includes(step.heading)) {
            return err('invalid_input', `Expected Workday step "${step.heading}".`, {
              hint: `Current heading: ${heading ?? 'unknown'}. Re-inspect this tenant.`,
              url: page.url,
            });
          }
          for (const answer of step.answers) {
            if (!safeAutomationId(answer.automationId)) {
              return err('invalid_input', `Invalid Workday automation ID: ${answer.automationId}`);
            }
            const selector = byAutomationId(answer.automationId);
            if (!(await page.exists(selector))) {
              return err('selector_missing', `Workday field ${answer.automationId} is missing.`, {
                hint: 'Inspect the authenticated tenant before retrying.',
                url: page.url,
              });
            }
            if (answer.kind === 'text') {
              if (answer.value === undefined) {
                return err('invalid_input', `Workday field ${answer.label} needs text.`);
              }
              await page.fill(selector, answer.value);
            } else if (answer.kind === 'select') {
              if (answer.value === undefined) {
                return err('invalid_input', `Workday field ${answer.label} needs a value.`);
              }
              await page.select(selector, answer.value);
            } else {
              await page.click(selector);
            }
          }
          await page.click(NEXT);
        }

        const submitText = await page.text(NEXT);
        if (!/submit/i.test(submitText ?? '')) {
          return err('invalid_input', 'Workday is not on its final review step.', {
            hint: `Current action is ${submitText ?? 'unknown'}; inspect before submitting.`,
            url: page.url,
          });
        }
        await page.click(NEXT);
        try {
          await page.waitFor({ selectorGone: APPLY_FLOW }, { timeoutMs: 60_000 });
        } catch {
          return err('failed', 'Workday did not confirm the submission.', {
            hint: 'Inspect validation errors in the connected Chrome tab.',
            retryable: false,
            url: page.url,
          });
        }
        const confirmation = await page.text('main, body');
        if (
          !/thank|received|submitted|application.{0,30}(?:complete|success)/i.test(
            confirmation ?? '',
          )
        ) {
          return err('selector_missing', 'Workday closed the flow without confirmation.', {
            hint: 'Verify the connected Chrome tab before retrying.',
            url: page.url,
          });
        }
        return ok(
          { title, url: page.url, message: confirmation },
          { summary: `Submitted ${title ?? 'Workday application'}` },
        );
      },
    }),
  },
});
