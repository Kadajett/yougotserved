import {
  defineSiteAdapter,
  defineTool,
  err,
  ok,
  p,
  type BrowserSession,
  type ExtractedRecord,
} from '@yougotserved/adapter-sdk';

const FORM = 'form';
const FIELD =
  'form [data-testid="field"]:has([id^="field-"][id$="-label"]), ' +
  'form .marginY--36:has(> [data-testid="field"])';
const LABEL = '[id^="field-"][id$="-label"], :scope > div:first-child p';
const CONTROL =
  '[role="radiogroup"], [role="combobox"], textarea, select, input:not([type="hidden"]):not([type="file"]), input[type="file"]';
const SUBMIT = 'form button[data-testid="Apply"][type="submit"]';

const answerParam = p.object({
  fieldId: p.string('Control ID returned by inspect_application'),
  label: p.string('Exact field label returned by inspect_application'),
  kind: p.enum(['text', 'combobox', 'radio'] as const, 'Control type'),
  value: p.string('Text value for a text control').optional(),
  optionIndex: p.integer('Option index for a combobox').min(0).optional(),
});

function safeFieldId(value: string): boolean {
  return /^field-\d+$/.test(value);
}

async function openForm(page: BrowserSession, url: string) {
  await page.goto(url);
  await page.waitFor({ networkIdle: true, forMs: 750 });
  if (/\/(?:login|signin|auth)(?:[/?#]|$)/i.test(page.url)) {
    return err('not_authenticated', 'Rippling redirected to authentication.', {
      url: page.url,
    });
  }
  if (!(await page.exists(FORM))) {
    const apply = 'button[data-testid="Apply now"]';
    if (!(await page.exists(apply))) {
      return err('selector_missing', 'Rippling rendered without an application button.', {
        hint: 'Re-run live selector discovery for examples/rippling.adapter.ts.',
        url: page.url,
      });
    }
    await page.click(apply);
    try {
      await page.waitFor({ selector: FORM }, { timeoutMs: 15_000 });
    } catch {
      return err('selector_missing', 'Rippling did not render its application form.', {
        hint: 'Re-run live selector discovery for examples/rippling.adapter.ts.',
        url: page.url,
      });
    }
  }
  return null;
}

async function inspectFields(page: BrowserSession, limit: number) {
  const fields = await page.extract({
    each: FIELD,
    limit,
    fields: {
      label: LABEL,
      fieldId: { selector: CONTROL, attr: 'id' },
      name: { selector: CONTROL, attr: 'name' },
      testId: { selector: CONTROL, attr: 'data-testid' },
      inputType: { selector: 'input:not([type="hidden"])', attr: 'type' },
      controlRole: { selector: CONTROL, attr: 'role' },
      hasFile: { selector: 'input[type="file"]', exists: true },
      hasTextarea: { selector: 'textarea', exists: true },
      hasSelect: { selector: 'select', exists: true },
    },
  });

  for (const field of fields) {
    if (field.controlRole === 'radiogroup' && typeof field.fieldId === 'string') {
      const extracted = await page.extract({
        fields: {
          options: {
            selector: `#${field.fieldId} [role="radio"]`,
            all: true,
          },
        },
      });
      field.options = Array.isArray(extracted.options) ? extracted.options.slice(0, 100) : [];
      continue;
    }
    if (
      field.controlRole !== 'combobox' ||
      typeof field.fieldId !== 'string' ||
      ['Pronouns', 'Phone number', 'Location'].includes(String(field.label))
    ) {
      field.options = [];
      continue;
    }
    const fieldId = field.fieldId;
    if (!safeFieldId(fieldId)) {
      field.options = [];
      continue;
    }
    await page.click(`#${fieldId}`);
    try {
      await page.waitFor({ selector: `#${fieldId}-list [role="option"]` }, { timeoutMs: 2_000 });
    } catch {
      // A combobox can legitimately have no options until the user types.
    }
    const extracted = await page.extract({
      fields: {
        options: {
          selector: `#${fieldId}-list [role="option"]`,
          all: true,
        },
      },
    });
    field.options = Array.isArray(extracted.options) ? extracted.options.slice(0, 100) : [];
    await page.press('Escape');
  }
  return fields;
}

export default defineSiteAdapter({
  id: 'rippling',
  name: 'Rippling ATS',
  version: '0.1.0',
  description: 'Inspect and submit public Rippling job applications.',
  origins: ['https://ats.rippling.com'],
  capabilities: ['navigate', 'read', 'interact', 'upload'],
  uploads: {
    allowedExtensions: ['pdf', 'doc', 'docx'],
    maxBytes: 10 * 1024 * 1024,
  },

  tools: {
    inspect_application: defineTool({
      description: 'Inspect a Rippling application.',
      returns: 'job title and fields with stable IDs, labels and options',
      params: {
        url: p.url('Public Rippling job URL'),
        limit: p.integer('Maximum fields').default(50).min(1).max(100),
      },
      capabilities: ['navigate', 'read', 'interact'],
      handler: async (page, args) => {
        const unavailable = await openForm(page, args.url);
        if (unavailable) return unavailable;
        if (!(await page.exists(FIELD))) {
          return err('selector_missing', 'Rippling rendered without parseable fields.', {
            hint: 'Re-run live selector discovery for examples/rippling.adapter.ts.',
            url: page.url,
          });
        }
        const title = page.title;
        const fields: ExtractedRecord[] = await inspectFields(page, args.limit);
        if (fields.length === 0) {
          return err('selector_missing', 'Rippling fields rendered but did not parse.', {
            hint: 'Re-run live selector discovery for examples/rippling.adapter.ts.',
            url: page.url,
          });
        }
        return ok(
          { title, url: page.url, fields },
          { summary: `${fields.length} fields for ${title ?? 'Rippling application'}` },
        );
      },
    }),

    apply: defineTool({
      description: 'Fill and submit a Rippling application.',
      returns: 'job title, final URL and Rippling confirmation text',
      risk: 'irreversible',
      timeoutMs: 240_000,
      capabilities: ['navigate', 'read', 'interact', 'upload'],
      params: {
        url: p.url('Public Rippling job URL'),
        firstName: p.string('Applicant first name'),
        lastName: p.string('Applicant last name'),
        email: p.string('Applicant email'),
        phone: p.string('Applicant phone').optional(),
        location: p.string('Applicant city and state').optional(),
        currentCompany: p.string('Current company').optional(),
        smsOptIn: p.boolean('Consent to application text updates').default(true),
        resume: p.file('Resume to attach'),
        answers: p.array(answerParam, 'Answers from inspect_application').default([]),
      },
      handler: async (page, args) => {
        const unavailable = await openForm(page, args.url);
        if (unavailable) return unavailable;
        const required = [
          '[data-testid="input-resume"]',
          '[data-testid="input-first_name"]',
          '[data-testid="input-last_name"]',
          '[data-testid="input-email"]',
          SUBMIT,
        ];
        for (const selector of required) {
          if (!(await page.exists(selector))) {
            return err('selector_missing', `Rippling field ${selector} is missing.`, {
              hint: 'Re-run live selector discovery for examples/rippling.adapter.ts.',
              url: page.url,
            });
          }
        }

        await page.upload('[data-testid="input-resume"]', args.resume);
        await page.fill('[data-testid="input-first_name"]', args.firstName);
        await page.fill('[data-testid="input-last_name"]', args.lastName);
        await page.fill('[data-testid="input-email"]', args.email);
        if (args.currentCompany && (await page.exists('[data-testid="input-current_company"]'))) {
          await page.fill('[data-testid="input-current_company"]', args.currentCompany);
        }
        if (args.phone && (await page.exists('[data-testid="input-phone_number"]'))) {
          await page.fill('[data-testid="input-phone_number"]', args.phone);
        }
        if (args.location && (await page.exists('[data-testid="input-undefined"]'))) {
          await page.fill('[data-testid="input-undefined"]', args.location, { typed: true });
          try {
            await page.waitFor(
              { selector: '#field-46-list [role="option"]' },
              { timeoutMs: 3_000 },
            );
            await page.click('#field-46-list [role="option"]:first-child');
          } catch {
            // Some Rippling forms accept free-text locations.
          }
        }

        for (const answer of args.answers) {
          if (!safeFieldId(answer.fieldId)) {
            return err('invalid_input', `Invalid Rippling field ID: ${answer.fieldId}`);
          }
          const currentLabel = await page.text(
            `#${answer.fieldId}-label, form .marginY--36:has(#${answer.fieldId}) > div:first-child p`,
          );
          if (currentLabel !== answer.label) {
            return err('invalid_input', `Rippling field ${answer.fieldId} changed labels.`, {
              hint: 'Call rippling_inspect_application again before submitting.',
              url: page.url,
            });
          }
          if (answer.kind === 'text') {
            if (answer.value === undefined) {
              return err('invalid_input', `Rippling field ${answer.label} needs a value.`);
            }
            await page.fill(`#${answer.fieldId}`, answer.value);
          } else if (answer.kind === 'combobox') {
            if (answer.optionIndex === undefined) {
              return err('invalid_input', `Rippling field ${answer.label} needs an option index.`);
            }
            await page.click(`#${answer.fieldId}`);
            const option = `#${answer.fieldId}-list-option-${answer.optionIndex}`;
            if (!(await page.exists(option))) {
              return err('invalid_input', `Rippling option ${answer.optionIndex} is missing.`, {
                hint: 'Call rippling_inspect_application again before submitting.',
                url: page.url,
              });
            }
            await page.click(option);
          } else {
            if (answer.optionIndex === undefined) {
              return err('invalid_input', `Rippling field ${answer.label} needs an option index.`);
            }
            const option = `#${answer.fieldId} > [role="radio"]:nth-child(${answer.optionIndex + 1})`;
            if (!(await page.exists(option))) {
              return err('invalid_input', `Rippling radio ${answer.optionIndex} is missing.`, {
                hint: 'Call rippling_inspect_application again before submitting.',
                url: page.url,
              });
            }
            await page.click(option);
          }
        }

        const sms = `[data-testid="sms_opt_in"] [role="radio"][data-value="${
          args.smsOptIn ? 'Yes' : 'No'
        }"]`;
        if (await page.exists(sms)) await page.click(sms);

        const title = page.title;
        await page.click(SUBMIT);
        try {
          await page.waitFor({ selectorGone: FORM }, { timeoutMs: 60_000 });
        } catch {
          const errors = await page.extract({
            fields: {
              messages: { selector: '[role="alert"], [data-testid*="error"]', all: true },
            },
          });
          const errorText = JSON.stringify(errors.messages);
          if (/captcha|challenge|verify.{0,20}human/i.test(errorText)) {
            return err('challenge_required', 'Rippling requires interactive verification.', {
              hint: 'Complete the challenge in Chrome, then submit again.',
              retryable: false,
              url: page.url,
            });
          }
          return err('failed', 'Rippling did not confirm the submission.', {
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
          return err('selector_missing', 'Rippling closed the form without confirmation.', {
            hint: 'Verify the connected Chrome tab before retrying.',
            url: page.url,
          });
        }
        return ok(
          { title, url: page.url, message: confirmation },
          { summary: `Submitted ${title ?? 'Rippling application'}` },
        );
      },
    }),
  },
});
