import {
  defineSiteAdapter,
  defineTool,
  err,
  ok,
  p,
  type BrowserSession,
  type ExtractedRecord,
} from '@yougotserved/adapter-sdk';

const FORM = '#application-form';
const FIELD = `${FORM} .field-wrapper, ${FORM} .eeoc__question__wrapper`;
const APPLY_BUTTON = 'button[aria-label="Apply"]';
const SUBMIT = `${FORM} button[type="submit"]`;

const answerParam = p.object({
  fieldId: p.string('Field id returned by inspect_application'),
  kind: p.enum(['text', 'textarea', 'select'] as const, 'Control type'),
  value: p.string('Text value').optional(),
  optionIndex: p.integer('Zero-based select option index').optional(),
});

function safeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

async function openForm(page: BrowserSession, url: string) {
  await page.goto(url);
  if (!(await page.exists(FORM)) && (await page.exists(APPLY_BUTTON))) {
    await page.click(APPLY_BUTTON);
  }
  try {
    await page.waitFor({ selector: FORM }, { timeoutMs: 15_000 });
  } catch {
    // The checks below distinguish closed jobs, auth redirects, and selector changes.
  }

  if (/\/(?:login|auth)(?:\/|\?|$)/i.test(page.url)) {
    return err('not_authenticated', 'Greenhouse redirected to an authentication page.', {
      url: page.url,
    });
  }
  if (await page.exists(FORM)) return null;

  const text = await page.text('main');
  if (/job (?:is )?(?:closed|not found|no longer available)/i.test(text ?? '')) {
    return err('not_found', 'This Greenhouse job is no longer accepting applications.', {
      url: page.url,
    });
  }
  return err('selector_missing', 'The Greenhouse page rendered without an application form.', {
    hint: 'Re-run live selector discovery for examples/greenhouse.adapter.ts.',
    url: page.url,
  });
}

async function selectReactOption(page: BrowserSession, fieldId: string, optionIndex: number) {
  if (!Number.isInteger(optionIndex) || optionIndex < 0) {
    return err('invalid_input', `Select ${fieldId} needs a non-negative optionIndex.`);
  }
  await page.click(`#${fieldId}`);
  const option = `#react-select-${fieldId}-option-${optionIndex}`;
  if (!(await page.exists(option))) {
    await page.press('Escape');
    return err('invalid_input', `Option ${optionIndex} is not available for ${fieldId}.`, {
      hint: 'Call greenhouse_inspect_application again for current option indices.',
      url: page.url,
    });
  }
  await page.click(option);
  return null;
}

export default defineSiteAdapter({
  id: 'greenhouse',
  name: 'Greenhouse',
  version: '0.1.0',
  description: 'Inspect and submit public Greenhouse job applications.',
  origins: [
    'https://job-boards.greenhouse.io',
    'https://job-boards.eu.greenhouse.io',
    'https://boards.greenhouse.io',
  ],
  capabilities: ['navigate', 'read', 'interact', 'upload'],
  uploads: {
    allowedExtensions: ['pdf', 'doc', 'docx'],
    maxBytes: 10 * 1024 * 1024,
  },

  tools: {
    inspect_application: defineTool({
      description: 'Inspect a Greenhouse application form.',
      returns: 'job title and fields with ids, labels, controls and select choices',
      params: {
        url: p.url('Public Greenhouse job URL'),
        limit: p.integer('Maximum fields to return').default(50).min(1).max(100),
      },
      capabilities: ['navigate', 'read', 'interact'],
      handler: async (page, args) => {
        const unavailable = await openForm(page, args.url);
        if (unavailable) return unavailable;

        const title = await page.text('main h1');
        const rawFields = await page.extract({
          each: FIELD,
          limit: args.limit,
          fields: {
            fieldId: { selector: 'input[id], textarea[id], select[id]', attr: 'id' },
            label: { selector: 'label', fallback: null },
            inputType: { selector: 'input', attr: 'type', fallback: null },
            role: { selector: 'input, textarea, select', attr: 'role', fallback: null },
            hasTextarea: { selector: 'textarea', exists: true },
            hasFile: { selector: 'input[type="file"]', exists: true },
            required: {
              selector: '[aria-required="true"], input[required], textarea[required]',
              exists: true,
            },
          },
        });

        const fields: ExtractedRecord[] = [];
        for (const field of rawFields) {
          const fieldId = field.fieldId;
          if (typeof fieldId !== 'string' || !safeToken(fieldId)) continue;
          let choices: ExtractedRecord[] = [];
          if (field.role === 'combobox' && fieldId !== 'country') {
            await page.click(`#${fieldId}`);
            choices = await page.extract({
              each: '[role="option"][id^="react-select-"]',
              limit: 100,
              fields: {
                id: { attr: 'id' },
                label: { prop: 'textContent' },
                optionIndex: { attr: 'id', regex: '-option-(\\d+)$', number: true },
              },
            });
            await page.press('Escape');
          }
          fields.push({ ...field, choices });
        }

        if (fields.length === 0) {
          return err(
            'selector_missing',
            'Greenhouse rendered without parseable application fields.',
            {
              hint: 'Re-run live selector discovery for examples/greenhouse.adapter.ts.',
              url: page.url,
            },
          );
        }

        return ok(
          { title, url: page.url, fields },
          { summary: `${fields.length} fields for ${title ?? 'Greenhouse application'}` },
        );
      },
    }),

    apply: defineTool({
      description: 'Fill and submit a Greenhouse application.',
      returns: 'job title, final URL and Greenhouse confirmation text',
      risk: 'irreversible',
      timeoutMs: 240_000,
      capabilities: ['navigate', 'read', 'interact', 'upload'],
      params: {
        url: p.url('Public Greenhouse job URL'),
        firstName: p.string('Applicant first name'),
        lastName: p.string('Applicant last name'),
        preferredName: p.string('Preferred first name').optional(),
        email: p.string('Applicant email'),
        phone: p.string('Applicant phone').optional(),
        phoneCountry: p.string('Visible phone country name').default('United States'),
        resume: p.file('Resume to attach'),
        answers: p.array(answerParam, 'Answers from inspect_application').default([]),
      },
      handler: async (page, args) => {
        const unavailable = await openForm(page, args.url);
        if (unavailable) return unavailable;

        for (const required of ['first_name', 'last_name', 'email', 'resume']) {
          if (!(await page.exists(`#${required}`))) {
            return err('selector_missing', `Greenhouse field #${required} is missing.`, {
              hint: 'Re-run live selector discovery for examples/greenhouse.adapter.ts.',
              url: page.url,
            });
          }
        }

        await page.fill('#first_name', args.firstName);
        await page.fill('#last_name', args.lastName);
        if (args.preferredName && (await page.exists('#preferred_name'))) {
          await page.fill('#preferred_name', args.preferredName);
        }
        await page.fill('#email', args.email);

        if (args.phone && (await page.exists('#phone'))) {
          await page.fill('#phone', args.phone);
          if (await page.exists('#country')) {
            await page.click('#country');
            const countries = await page.extract({
              each: '[role="option"][id^="react-select-country-option-"]',
              limit: 300,
              fields: {
                id: { attr: 'id' },
                label: { prop: 'textContent' },
              },
            });
            const country = countries.find(
              (choice) =>
                typeof choice.id === 'string' &&
                typeof choice.label === 'string' &&
                (choice.label === args.phoneCountry ||
                  choice.label.startsWith(`${args.phoneCountry} +`)),
            );
            if (typeof country?.id !== 'string' || !safeToken(country.id)) {
              return err('invalid_input', `Phone country ${args.phoneCountry} is unavailable.`);
            }
            await page.click(`#${country.id}`);
          }
        }

        await page.upload('#resume', args.resume);

        for (const answer of args.answers) {
          if (!safeToken(answer.fieldId)) {
            return err('invalid_input', `Invalid Greenhouse field id: ${answer.fieldId}`);
          }
          const selector = `#${answer.fieldId}`;
          if (!(await page.exists(selector))) {
            return err('selector_missing', `Greenhouse field ${answer.fieldId} is missing.`, {
              hint: 'Call greenhouse_inspect_application again for current field ids.',
              url: page.url,
            });
          }

          if (answer.kind === 'select') {
            if (answer.optionIndex === undefined) {
              return err('invalid_input', `Select ${answer.fieldId} needs optionIndex.`);
            }
            const selectionError = await selectReactOption(
              page,
              answer.fieldId,
              answer.optionIndex,
            );
            if (selectionError) return selectionError;
          } else {
            if (answer.value === undefined) {
              return err('invalid_input', `${answer.kind} ${answer.fieldId} needs a value.`);
            }
            await page.fill(selector, answer.value);
          }
        }

        if (!(await page.exists(SUBMIT))) {
          return err('selector_missing', 'Greenhouse rendered without its submit button.', {
            hint: 'Re-run live selector discovery for examples/greenhouse.adapter.ts.',
            url: page.url,
          });
        }

        const title = await page.text('main h1');
        await page.click(SUBMIT);
        try {
          await page.waitFor({ selectorGone: FORM }, { timeoutMs: 45_000 });
        } catch {
          if (await page.exists('#security-input-0')) {
            return err(
              'challenge_required',
              'Greenhouse emailed an eight-character security code.',
              {
                hint: 'Call greenhouse_complete_verification with the code from the applicant email.',
                retryable: false,
                url: page.url,
              },
            );
          }
          const errors = await page.extract({
            fields: {
              messages: { selector: '[role="alert"], .error, .field-error', all: true },
            },
          });
          const errorText = JSON.stringify(errors.messages);
          if (/captcha|challenge|verify.{0,20}human/i.test(errorText)) {
            return err('challenge_required', 'Greenhouse requires interactive verification.', {
              hint: 'Complete the challenge in the connected Chrome tab, then submit again.',
              retryable: false,
              url: page.url,
            });
          }
          return err('failed', 'Greenhouse did not confirm the application submission.', {
            hint: `Inspect the live form for validation errors: ${errorText}`,
            retryable: false,
            url: page.url,
          });
        }

        const confirmation = await page.text('main');
        if (
          !/thank|received|submitted|application.{0,30}(?:complete|success)/i.test(
            confirmation ?? '',
          )
        ) {
          return err(
            'selector_missing',
            'Greenhouse closed the form without recognizable confirmation.',
            {
              hint: 'Verify the application in the connected Chrome tab before retrying.',
              url: page.url,
            },
          );
        }

        return ok(
          { title, url: page.url, message: confirmation },
          { summary: `Submitted ${title ?? 'Greenhouse application'}` },
        );
      },
    }),

    complete_verification: defineTool({
      description: 'Complete Greenhouse email verification.',
      returns: 'job title, final URL and Greenhouse confirmation text',
      risk: 'irreversible',
      timeoutMs: 90_000,
      capabilities: ['read', 'interact'],
      params: {
        code: p.string('Eight-character emailed security code'),
      },
      handler: async (page, args) => {
        if (!/^[A-Za-z0-9]{8}$/.test(args.code)) {
          return err('invalid_input', 'Greenhouse security codes contain eight letters or digits.');
        }
        if (!(await page.exists('#security-input-0'))) {
          return err('not_found', 'No Greenhouse security-code form is open in this tab.', {
            hint: 'Run greenhouse_apply first and keep its connected Chrome tab open.',
            url: page.url,
          });
        }

        for (let index = 0; index < args.code.length; index += 1) {
          await page.fill(`#security-input-${index}`, args.code[index] ?? '');
        }

        const verificationSubmit = `${FORM} button[type="submit"]:not([disabled])`;
        try {
          await page.waitFor({ selector: verificationSubmit }, { timeoutMs: 10_000 });
        } catch {
          return err('failed', 'Greenhouse did not accept the complete security code.', {
            hint: 'Request a fresh code and call greenhouse_complete_verification again.',
            retryable: false,
            url: page.url,
          });
        }

        const title = await page.text('main h1');
        await page.click(verificationSubmit);
        try {
          await page.waitFor({ selectorGone: FORM }, { timeoutMs: 45_000 });
        } catch {
          const errors = await page.extract({
            fields: {
              messages: { selector: '[role="alert"], .error, .field-error', all: true },
            },
          });
          return err('failed', 'Greenhouse did not confirm the verified application.', {
            hint: `Review the verification form: ${JSON.stringify(errors.messages)}`,
            retryable: false,
            url: page.url,
          });
        }

        const confirmation = await page.text('main');
        if (
          !/thank|received|submitted|application.{0,30}(?:complete|success)/i.test(
            confirmation ?? '',
          )
        ) {
          return err(
            'selector_missing',
            'Greenhouse verified the code without recognizable confirmation.',
            {
              hint: 'Verify the application in the connected Chrome tab before retrying.',
              url: page.url,
            },
          );
        }

        return ok(
          { title, url: page.url, message: confirmation },
          { summary: `Submitted ${title ?? 'Greenhouse application'}` },
        );
      },
    }),
  },
});
