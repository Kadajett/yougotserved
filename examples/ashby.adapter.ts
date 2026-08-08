import {
  defineSiteAdapter,
  defineTool,
  err,
  ok,
  p,
  type BrowserSession,
} from '@yougotserved/adapter-sdk';

const BASE = 'https://jobs.ashbyhq.com';

// Verified on two live Ashby application forms on 2026-08-08. The
// data-field-path hook is supplied by Ashby and stays independent of the
// employer's generated question IDs and CSS-module class names.
const FORM = '.ashby-application-form-container';
const FIELD = '[data-field-path]';
const QUESTION = '.ashby-application-form-question-title';
const SUBMIT = '.ashby-application-form-submit-button';
const SUCCESS = '[role="status"]';

const answerParam = p.object({
  fieldPath: p.string('data-field-path returned by inspect_application'),
  kind: p.enum(
    ['text', 'textarea', 'select', 'yes_no', 'checkbox', 'radio'] as const,
    'Control type',
  ),
  value: p.string('Text, select value, or yes/no').optional(),
  optionIndices: p.array(p.integer('Zero-based option index')).optional(),
});

function authError(url: string) {
  if (!/\/(?:login|auth)(?:\/|\?|$)/i.test(url)) return null;
  return err('not_authenticated', 'Ashby redirected to an authentication page.', {
    hint: 'Open the application in the connected Chrome profile, then try again.',
    url,
  });
}

function fieldSelector(fieldPath: string): string | null {
  return /^[A-Za-z0-9_-]+$/.test(fieldPath) ? `[data-field-path="${fieldPath}"]` : null;
}

async function formError(page: BrowserSession) {
  const authentication = authError(page.url);
  if (authentication) return authentication;

  if (await page.exists(FORM)) return null;

  const pageText = await page.text('main');
  if (/job (?:is )?(?:closed|not found|no longer available)/i.test(pageText ?? '')) {
    return err('not_found', 'This Ashby job is no longer accepting applications.', {
      url: page.url,
    });
  }

  return err('selector_missing', 'The Ashby page rendered without an application form.', {
    hint: 'Re-run live selector discovery for examples/ashby.adapter.ts.',
    url: page.url,
  });
}

async function openApplication(page: BrowserSession, url: string) {
  await page.goto(url);
  try {
    await page.waitFor({ selector: FORM }, { timeoutMs: 15_000 });
  } catch {
    // formError below distinguishes a closed job, auth redirect, and moved selector.
  }
  return formError(page);
}

export default defineSiteAdapter({
  id: 'ashby',
  name: 'Ashby',
  version: '0.1.0',
  description: 'Inspect and submit public Ashby job applications.',
  origins: [BASE],
  capabilities: ['navigate', 'read', 'interact', 'upload'],
  uploads: {
    allowedExtensions: ['pdf', 'doc', 'docx'],
    maxBytes: 10 * 1024 * 1024,
  },

  tools: {
    inspect_application: defineTool({
      description: 'Inspect an Ashby application form.',
      returns: 'job title and up to 50 fields with paths, labels, controls and choices',
      params: {
        url: p.url('Public jobs.ashbyhq.com application URL'),
        limit: p.integer('Maximum fields to return').default(50).min(1).max(100),
      },
      capabilities: ['navigate', 'read'],
      handler: async (page, args) => {
        const unavailable = await openApplication(page, args.url);
        if (unavailable) return unavailable;

        const details = await page.extract({
          fields: {
            title: 'h1',
            company: { selector: 'img[alt]', attr: 'alt', fallback: null },
          },
        });
        const fields = await page.extract({
          each: FIELD,
          limit: args.limit,
          fields: {
            fieldPath: { attr: 'data-field-path' },
            label: { selector: QUESTION, fallback: null },
            required: {
              selector: 'input[required], textarea[required], select[required]',
              exists: true,
            },
            inputType: { selector: 'input', attr: 'type', fallback: null },
            inputId: { selector: 'input, textarea, select', attr: 'id', fallback: null },
            hasTextarea: { selector: 'textarea', exists: true },
            hasSelect: { selector: 'select', exists: true },
            hasCheckboxes: { selector: 'input[type="checkbox"]', exists: true },
            hasRadios: { selector: 'input[type="radio"]', exists: true },
            choices: {
              selector: `label:not(${QUESTION}), button`,
              all: true,
            },
          },
        });

        if (fields.length === 0) {
          return err('selector_missing', 'The Ashby form rendered without parseable fields.', {
            hint: 'Re-run live selector discovery for examples/ashby.adapter.ts.',
            url: page.url,
          });
        }

        return ok(
          { ...details, url: page.url, fields },
          {
            summary: `${fields.length} fields for ${String(details.title ?? 'Ashby application')}`,
          },
        );
      },
    }),

    apply: defineTool({
      description: 'Fill and submit an Ashby application.',
      returns: 'the job title, final URL and Ashby success message',
      risk: 'irreversible',
      timeoutMs: 90_000,
      capabilities: ['navigate', 'read', 'interact', 'upload'],
      params: {
        url: p.url('Public jobs.ashbyhq.com application URL'),
        name: p.string('Applicant full name'),
        email: p.string('Applicant email'),
        phone: p.string('Applicant phone').optional(),
        resume: p.file('Resume to attach'),
        answers: p.array(answerParam, 'Answers from inspect_application').default([]),
      },
      handler: async (page, args) => {
        const unavailable = await openApplication(page, args.url);
        if (unavailable) return unavailable;

        if (
          !(await page.exists('#_systemfield_name')) ||
          !(await page.exists('#_systemfield_email'))
        ) {
          return err(
            'selector_missing',
            'Ashby rendered without its standard name or email fields.',
            {
              hint: 'Re-run live selector discovery for examples/ashby.adapter.ts.',
              url: page.url,
            },
          );
        }

        await page.fill('#_systemfield_name', args.name);
        await page.fill('#_systemfield_email', args.email);

        if (args.phone && (await page.exists('#_systemfield_phone'))) {
          await page.fill('#_systemfield_phone', args.phone);
        }

        if (!(await page.exists('#_systemfield_resume'))) {
          return err('selector_missing', 'Ashby rendered without its standard resume field.', {
            hint: 'Re-run live selector discovery for examples/ashby.adapter.ts.',
            url: page.url,
          });
        }
        await page.upload('#_systemfield_resume', args.resume);

        for (const answer of args.answers) {
          const selector = fieldSelector(answer.fieldPath);
          if (!selector) {
            return err('invalid_input', `Invalid Ashby field path: ${answer.fieldPath}`);
          }
          if (!(await page.exists(selector))) {
            return err('selector_missing', `Ashby field ${answer.fieldPath} is missing.`, {
              hint: 'Call ashby_inspect_application again and use its current field paths.',
              url: page.url,
            });
          }

          if (answer.kind === 'text') {
            if (answer.value === undefined) {
              return err('invalid_input', `Text field ${answer.fieldPath} needs a value.`);
            }
            await page.fill(
              `${selector} input:not([type="file"]):not([type="checkbox"]):not([type="radio"])`,
              answer.value,
            );
          } else if (answer.kind === 'textarea') {
            if (answer.value === undefined) {
              return err('invalid_input', `Textarea ${answer.fieldPath} needs a value.`);
            }
            await page.fill(`${selector} textarea`, answer.value);
          } else if (answer.kind === 'select') {
            if (answer.value === undefined) {
              return err('invalid_input', `Select ${answer.fieldPath} needs a value.`);
            }
            await page.select(`${selector} select`, answer.value);
          } else if (answer.kind === 'yes_no') {
            const choice = answer.value?.toLowerCase();
            if (choice !== 'yes' && choice !== 'no') {
              return err('invalid_input', `Yes/no field ${answer.fieldPath} needs "yes" or "no".`);
            }
            await page.click(`${selector} button:nth-of-type(${choice === 'yes' ? 1 : 2})`);
          } else {
            const inputType = answer.kind;
            const options = await page.extract({
              each: `${selector} input[type="${inputType}"]`,
              limit: 50,
              fields: {
                id: { attr: 'id' },
                checked: { prop: 'checked' },
              },
            });
            const indices = answer.optionIndices ?? [];
            if (indices.length === 0) {
              return err(
                'invalid_input',
                `${answer.kind} field ${answer.fieldPath} needs optionIndices.`,
              );
            }
            for (const index of indices) {
              const option = options[index];
              const id = option?.id;
              if (!Number.isInteger(index) || index < 0 || typeof id !== 'string' || !id) {
                return err(
                  'invalid_input',
                  `Option ${index} is invalid for field ${answer.fieldPath}.`,
                );
              }
              if (!/^[A-Za-z0-9_-]+$/.test(id)) {
                return err(
                  'selector_missing',
                  `Ashby returned an unsafe option id for ${answer.fieldPath}.`,
                  {
                    hint: 'Re-run live selector discovery for examples/ashby.adapter.ts.',
                    url: page.url,
                  },
                );
              }
              if (option.checked !== true) await page.click(`label[for="${id}"]`);
            }
          }
        }

        if (!(await page.exists(SUBMIT))) {
          return err('selector_missing', 'Ashby rendered without its submit button.', {
            hint: 'Re-run live selector discovery for examples/ashby.adapter.ts.',
            url: page.url,
          });
        }

        const title = await page.text('h1');
        await page.click(SUBMIT);
        try {
          await page.waitFor({ selector: SUCCESS }, { timeoutMs: 45_000 });
        } catch {
          const errors = await page.extract({
            fields: {
              messages: {
                selector: '[role="alert"], [class*="error" i]',
                all: true,
              },
            },
          });
          const errorText = JSON.stringify(errors.messages);
          if (/captcha|challenge|verify.{0,20}human/i.test(errorText)) {
            return err('challenge_required', 'Ashby requires an interactive verification.', {
              hint: 'Complete the challenge in the connected Chrome tab, then submit again.',
              retryable: false,
              url: page.url,
            });
          }
          return err('failed', 'Ashby did not confirm the application submission.', {
            hint: `Inspect the live form for validation errors: ${errorText}`,
            retryable: false,
            url: page.url,
          });
        }

        const message = await page.text(SUCCESS);
        if (!/success|submitted|thanks for your interest/i.test(message ?? '')) {
          return err(
            'selector_missing',
            'Ashby returned a status without a recognizable success message.',
            {
              hint: 'Verify the application in the connected Chrome tab before retrying.',
              url: page.url,
            },
          );
        }

        return ok(
          { title, url: page.url, message },
          { summary: `Submitted ${title ?? 'Ashby application'}` },
        );
      },
    }),
  },
});
