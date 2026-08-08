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
const FIELD = `${FORM} .application-question`;
const SUBMIT = '[data-qa="btn-submit"]';

const answerParam = p.object({
  fieldName: p.string('Field name returned by inspect_application'),
  kind: p.enum(['text', 'textarea', 'select'] as const, 'Control type'),
  value: p.string('Text or select value'),
});

function safeFieldName(value: string): boolean {
  return /^[A-Za-z0-9_[\].:-]+$/.test(value);
}

function byName(name: string): string {
  return `[name=${JSON.stringify(name)}]`;
}

async function openForm(page: BrowserSession, url: string) {
  const applyUrl = url.endsWith('/apply') ? url : `${url.replace(/\/$/, '')}/apply`;
  await page.goto(applyUrl);
  try {
    await page.waitFor({ selector: FORM }, { timeoutMs: 15_000 });
  } catch {
    // The checks below distinguish closed jobs and selector changes.
  }

  if (/\/(?:login|auth)(?:\/|\?|$)/i.test(page.url)) {
    return err('not_authenticated', 'Lever redirected to an authentication page.', {
      url: page.url,
    });
  }
  if (await page.exists(FORM)) return null;

  const text = await page.text('main, body');
  if (
    /job (?:is )?(?:closed|not found|no longer available)|position has been filled/i.test(
      text ?? '',
    )
  ) {
    return err('not_found', 'This Lever job is no longer accepting applications.', {
      url: page.url,
    });
  }
  return err('selector_missing', 'Lever rendered without an application form.', {
    hint: 'Re-run live selector discovery for examples/lever.adapter.ts.',
    url: page.url,
  });
}

export default defineSiteAdapter({
  id: 'lever',
  name: 'Lever',
  version: '0.1.0',
  description: 'Inspect and submit public Lever job applications.',
  origins: ['https://jobs.lever.co', 'https://jobs.eu.lever.co'],
  capabilities: ['navigate', 'read', 'interact', 'upload'],
  uploads: {
    allowedExtensions: ['pdf', 'doc', 'docx'],
    maxBytes: 10 * 1024 * 1024,
  },

  tools: {
    inspect_application: defineTool({
      description: 'Inspect a Lever application form.',
      returns: 'job title and fields with names, labels and controls',
      params: {
        url: p.url('Public Lever job URL'),
        limit: p.integer('Maximum fields to return').default(50).min(1).max(100),
      },
      capabilities: ['navigate', 'read'],
      handler: async (page, args) => {
        const unavailable = await openForm(page, args.url);
        if (unavailable) return unavailable;

        const title = await page.text('main h2, h2');
        const rawFields = await page.extract({
          each: FIELD,
          limit: args.limit,
          fields: {
            fieldName: {
              selector: 'input:not([type="hidden"]), textarea, select',
              attr: 'name',
            },
            label: { selector: 'label', fallback: null },
            inputType: { selector: 'input', attr: 'type', fallback: null },
            hasTextarea: { selector: 'textarea', exists: true },
            hasSelect: { selector: 'select', exists: true },
            hasFile: { selector: 'input[type="file"]', exists: true },
            required: {
              selector: 'input[required], textarea[required], select[required]',
              exists: true,
            },
          },
        });
        const fields: ExtractedRecord[] = rawFields.filter(
          (field) => typeof field.fieldName === 'string' && safeFieldName(field.fieldName),
        );
        if (fields.length === 0) {
          return err('selector_missing', 'Lever rendered without parseable application fields.', {
            hint: 'Re-run live selector discovery for examples/lever.adapter.ts.',
            url: page.url,
          });
        }
        return ok(
          { title, url: page.url, fields },
          { summary: `${fields.length} fields for ${title ?? 'Lever application'}` },
        );
      },
    }),

    apply: defineTool({
      description: 'Fill and submit a Lever application.',
      returns: 'job title, final URL and Lever confirmation text',
      risk: 'irreversible',
      timeoutMs: 180_000,
      capabilities: ['navigate', 'read', 'interact', 'upload'],
      params: {
        url: p.url('Public Lever job URL'),
        fullName: p.string('Applicant full name'),
        email: p.string('Applicant email'),
        phone: p.string('Applicant phone').optional(),
        location: p.string('Applicant location').optional(),
        currentCompany: p.string('Current company').optional(),
        linkedinUrl: p.string('LinkedIn URL').optional(),
        githubUrl: p.string('GitHub URL').optional(),
        portfolioUrl: p.string('Portfolio URL').optional(),
        resume: p.file('Resume to attach'),
        answers: p.array(answerParam, 'Additional answers from inspect_application').default([]),
      },
      handler: async (page, args) => {
        const unavailable = await openForm(page, args.url);
        if (unavailable) return unavailable;

        const required = [
          '[data-qa="name-input"]',
          '[data-qa="email-input"]',
          '[data-qa="input-resume"]',
          SUBMIT,
        ];
        for (const selector of required) {
          if (!(await page.exists(selector))) {
            return err('selector_missing', `Lever field ${selector} is missing.`, {
              hint: 'Re-run live selector discovery for examples/lever.adapter.ts.',
              url: page.url,
            });
          }
        }

        await page.upload('[data-qa="input-resume"]', args.resume);
        await page.fill('[data-qa="name-input"]', args.fullName);
        await page.fill('[data-qa="email-input"]', args.email);
        if (args.phone && (await page.exists('[data-qa="phone-input"]'))) {
          await page.fill('[data-qa="phone-input"]', args.phone);
        }
        if (args.location && (await page.exists('[data-qa="location-input"]'))) {
          await page.fill('[data-qa="location-input"]', args.location);
        }
        if (args.currentCompany && (await page.exists('[data-qa="org-input"]'))) {
          await page.fill('[data-qa="org-input"]', args.currentCompany);
        }
        if (args.linkedinUrl && (await page.exists(byName('urls[LinkedIn]')))) {
          await page.fill(byName('urls[LinkedIn]'), args.linkedinUrl);
        }
        if (args.githubUrl && (await page.exists(byName('urls[GitHub]')))) {
          await page.fill(byName('urls[GitHub]'), args.githubUrl);
        }
        if (args.portfolioUrl && (await page.exists(byName('urls[Portfolio]')))) {
          await page.fill(byName('urls[Portfolio]'), args.portfolioUrl);
        }
        for (const answer of args.answers) {
          if (!safeFieldName(answer.fieldName)) {
            return err('invalid_input', `Invalid Lever field name: ${answer.fieldName}`);
          }
          const selector = byName(answer.fieldName);
          if (!(await page.exists(selector))) {
            return err('selector_missing', `Lever field ${answer.fieldName} is missing.`, {
              hint: 'Call lever_inspect_application again for current field names.',
              url: page.url,
            });
          }
          if (answer.kind === 'select') await page.select(selector, answer.value);
          else await page.fill(selector, answer.value);
        }

        const title = await page.text('main h2, h2');
        await page.click(SUBMIT);
        try {
          await page.waitFor({ selectorGone: FORM }, { timeoutMs: 60_000 });
        } catch {
          const errors = await page.extract({
            fields: {
              messages: {
                selector: '.error, .application-error, [role="alert"]',
                all: true,
              },
            },
          });
          const errorText = JSON.stringify(errors.messages);
          if (/captcha|challenge|verify.{0,20}human/i.test(errorText)) {
            return err('challenge_required', 'Lever requires interactive verification.', {
              hint: 'Complete the challenge in the connected Chrome tab, then submit again.',
              retryable: false,
              url: page.url,
            });
          }
          return err('failed', 'Lever did not confirm the application submission.', {
            hint: `Inspect the live form for validation errors: ${errorText}`,
            retryable: false,
            url: page.url,
          });
        }

        const confirmation = await page.text('main, body');
        if (
          !/\/thanks(?:[/?#]|$)/i.test(page.url) &&
          !/thank|received|submitted|application.{0,30}(?:complete|success)/i.test(
            confirmation ?? '',
          )
        ) {
          return err(
            'selector_missing',
            'Lever closed the form without recognizable confirmation.',
            {
              hint: 'Verify the application in the connected Chrome tab before retrying.',
              url: page.url,
            },
          );
        }
        return ok(
          { title, url: page.url, message: confirmation },
          { summary: `Submitted ${title ?? 'Lever application'}` },
        );
      },
    }),
  },
});
