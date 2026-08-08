import {
  defineSiteAdapter,
  defineTool,
  err,
  ok,
  p,
  type BrowserSession,
} from '@yougotserved/adapter-sdk';

const FORM = 'main form';
const RESUME = 'form input[type="file"][data-ui="resume"]';
const SUBMIT = 'form button[type="submit"][data-ui="apply-button"]';
const TEXT_QUESTION = 'form label:has(input[data-ui^="CA_"], textarea[data-ui^="CA_"])';
const RADIO_QUESTION = 'form div:has(> div > fieldset[role="radiogroup"][data-ui])';

const answerParam = p.object({
  fieldName: p.string('Field name returned by inspect_application'),
  label: p.string('Exact question returned by inspect_application'),
  kind: p.enum(['text', 'radio'] as const, 'Control type'),
  value: p.string('Text or radio value returned by inspection'),
});

function safeFieldName(value: string): boolean {
  return /^(?:CA|QA)_\d+$/.test(value);
}

function applyUrl(input: string): string {
  const url = new URL(input);
  if (!url.pathname.endsWith('/apply/')) {
    url.pathname = `${url.pathname.replace(/\/?$/, '/')}apply/`;
  }
  return url.toString();
}

async function openForm(page: BrowserSession, url: string) {
  await page.goto(applyUrl(url));
  await page.waitFor({ networkIdle: true, forMs: 750 });
  if (/\/(?:login|signin|auth)(?:[/?#]|$)/i.test(page.url)) {
    return err('not_authenticated', 'Workable redirected to authentication.', {
      url: page.url,
    });
  }
  if (await page.exists(FORM)) return null;
  const text = await page.text('main, body');
  if (/job (?:is )?(?:closed|expired|not found)|no longer accepting/i.test(text ?? '')) {
    return err('not_found', 'This Workable job is no longer accepting applications.', {
      url: page.url,
    });
  }
  return err('selector_missing', 'Workable rendered without an application form.', {
    hint: 'Re-run live selector discovery for examples/workable.adapter.ts.',
    url: page.url,
  });
}

export default defineSiteAdapter({
  id: 'workable',
  name: 'Workable',
  version: '0.1.0',
  description: 'Inspect and submit public Workable job applications.',
  origins: ['https://apply.workable.com'],
  capabilities: ['navigate', 'read', 'interact', 'upload'],
  uploads: {
    allowedExtensions: ['pdf', 'doc', 'docx'],
    maxBytes: 10 * 1024 * 1024,
  },

  tools: {
    inspect_application: defineTool({
      description: 'Inspect a Workable application.',
      returns: 'job title, standard controls and custom questions with values',
      params: {
        url: p.url('Public Workable job URL'),
        limit: p.integer('Maximum custom questions').default(50).min(1).max(100),
      },
      capabilities: ['navigate', 'read'],
      handler: async (page, args) => {
        const unavailable = await openForm(page, args.url);
        if (unavailable) return unavailable;
        const title = await page.text('header h1, header h2, h1');
        const standard = await page.extract({
          fields: {
            firstName: { selector: 'input[data-ui="firstname"]', exists: true },
            lastName: { selector: 'input[data-ui="lastname"]', exists: true },
            email: { selector: 'input[data-ui="email"]', exists: true },
            phone: { selector: 'input[name="phone"]', exists: true },
            resume: { selector: RESUME, exists: true },
            coverLetter: { selector: 'textarea[data-ui="cover_letter"]', exists: true },
          },
        });
        const textQuestions = await page.extract({
          each: TEXT_QUESTION,
          limit: args.limit,
          fields: {
            fieldName: {
              selector: 'input[data-ui^="CA_"], textarea[data-ui^="CA_"]',
              attr: 'data-ui',
            },
            label: {},
            kind: { selector: '[data-workable-kind="text"]', fallback: 'text' },
            required: {
              selector: 'input[required], textarea[required]',
              exists: true,
            },
          },
        });
        const radioQuestions = await page.extract({
          each: RADIO_QUESTION,
          limit: args.limit,
          fields: {
            fieldName: {
              selector: 'fieldset[role="radiogroup"][data-ui]',
              attr: 'data-ui',
            },
            label: ':scope > span:first-child',
            kind: { selector: '[data-workable-kind="radio"]', fallback: 'radio' },
            options: {
              selector: '[data-ui="option"] input[type="radio"]',
              prop: 'value',
              all: true,
            },
            optionLabels: { selector: '[data-ui="option"]', all: true },
          },
        });
        const questions = [...textQuestions, ...radioQuestions].filter(
          (question) => typeof question.fieldName === 'string' && safeFieldName(question.fieldName),
        );
        if (!standard.resume || !(await page.exists(SUBMIT))) {
          return err('selector_missing', 'Workable standard fields did not parse.', {
            hint: 'Re-run live selector discovery for examples/workable.adapter.ts.',
            url: page.url,
          });
        }
        return ok(
          { title, url: page.url, standard, questions },
          {
            summary: `${questions.length} custom questions for ${title ?? 'Workable application'}`,
          },
        );
      },
    }),

    apply: defineTool({
      description: 'Fill and submit a Workable application.',
      returns: 'job title, final URL and Workable confirmation text',
      risk: 'irreversible',
      timeoutMs: 240_000,
      capabilities: ['navigate', 'read', 'interact', 'upload'],
      params: {
        url: p.url('Public Workable job URL'),
        firstName: p.string('Applicant first name'),
        lastName: p.string('Applicant last name'),
        email: p.string('Applicant email'),
        phone: p.string('Applicant phone').optional(),
        coverLetter: p.string('Optional cover letter').optional(),
        resume: p.file('Resume to attach'),
        answers: p.array(answerParam, 'Answers from inspect_application').default([]),
      },
      handler: async (page, args) => {
        const unavailable = await openForm(page, args.url);
        if (unavailable) return unavailable;
        const required = [
          'input[data-ui="firstname"]',
          'input[data-ui="lastname"]',
          'input[data-ui="email"]',
          RESUME,
          SUBMIT,
        ];
        for (const selector of required) {
          if (!(await page.exists(selector))) {
            return err('selector_missing', `Workable field ${selector} is missing.`, {
              hint: 'Re-run live selector discovery for examples/workable.adapter.ts.',
              url: page.url,
            });
          }
        }
        await page.upload(RESUME, args.resume);
        await page.fill('input[data-ui="firstname"]', args.firstName);
        await page.fill('input[data-ui="lastname"]', args.lastName);
        await page.fill('input[data-ui="email"]', args.email);
        if (args.phone && (await page.exists('input[name="phone"]'))) {
          await page.fill('input[name="phone"]', args.phone);
        }
        if (args.coverLetter && (await page.exists('textarea[data-ui="cover_letter"]'))) {
          await page.fill('textarea[data-ui="cover_letter"]', args.coverLetter);
        }

        for (const answer of args.answers) {
          if (!safeFieldName(answer.fieldName)) {
            return err('invalid_input', `Invalid Workable field name: ${answer.fieldName}`);
          }
          if (answer.kind === 'text') {
            const selector = `[data-ui="${answer.fieldName}"]`;
            if (!(await page.exists(selector))) {
              return err('selector_missing', `Workable field ${answer.fieldName} is missing.`, {
                hint: 'Call workable_inspect_application again before submitting.',
                url: page.url,
              });
            }
            await page.fill(selector, answer.value);
          } else {
            const selector =
              `fieldset[data-ui="${answer.fieldName}"] ` +
              `[data-ui="option"]:has(input[value="${answer.value}"])`;
            if (!(await page.exists(selector))) {
              return err('invalid_input', `Workable radio value ${answer.value} is missing.`, {
                hint: 'Call workable_inspect_application again before submitting.',
                url: page.url,
              });
            }
            await page.click(selector);
          }
        }

        const title = await page.text('header h1, header h2, h1');
        await page.click(SUBMIT);
        try {
          await page.waitFor({ selectorGone: FORM }, { timeoutMs: 60_000 });
        } catch {
          const errors = await page.extract({
            fields: {
              messages: { selector: '[role="alert"], [data-ui*="error"]', all: true },
            },
          });
          const errorText = JSON.stringify(errors.messages);
          if (/captcha|challenge|verify.{0,20}human/i.test(errorText)) {
            return err('challenge_required', 'Workable requires interactive verification.', {
              hint: 'Complete the challenge in Chrome, then submit again.',
              retryable: false,
              url: page.url,
            });
          }
          return err('failed', 'Workable did not confirm the submission.', {
            hint: `Inspect validation errors: ${errorText}`,
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
          return err('selector_missing', 'Workable closed the form without confirmation.', {
            hint: 'Verify the connected Chrome tab before retrying.',
            url: page.url,
          });
        }
        return ok(
          { title, url: page.url, message: confirmation },
          { summary: `Submitted ${title ?? 'Workable application'}` },
        );
      },
    }),
  },
});
