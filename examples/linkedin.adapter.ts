import { defineSiteAdapter, defineTool, err, ok, p } from '@yougotserved/adapter-sdk';

const BASE = 'https://www.linkedin.com';

// Verified on the live people search page on 2026-08-08. LinkedIn exposed no
// data-view-name or data-urn hook for result rows in the current UI.
const PEOPLE_ROW = 'main [role="list"] [role="listitem"]';
const PERSON_NAME = 'p > a[href*="/in/"]';
const PERSON_CONNECTION = 'p:has(> a[href*="/in/"])';
const PERSON_HEADLINE = 'p:has(> a[href*="/in/"]) + div p';
const PERSON_LOCATION = 'p:has(> a[href*="/in/"]) + div + div p';

// Verified against two live profiles with different top-card shapes.
const PROFILE_CARD =
  'main section[aria-label="Primary content"] > div > div > ' +
  '[componentkey^="com.linkedin.sdui.profile.card."]:first-child';
const PROFILE_NAME = `${PROFILE_CARD} h2`;
const PROFILE_HEADLINE = `${PROFILE_CARD} div:has(> div > p > a[href="#"]) > p:first-of-type`;
const PROFILE_LOCATION = `${PROFILE_CARD} div:has(> p > a[href="#"]) > p:first-child`;

function authenticationError(url: string) {
  if (!url.includes('/authwall') && !url.includes('/login')) return null;

  return err('not_authenticated', 'LinkedIn redirected to an authentication page.', {
    hint: 'Sign in to LinkedIn in the connected Chrome profile, then run this again.',
    url,
  });
}

function resolveProfileUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  const slug = value.replace(/^\/?(?:in\/)?/, '').replace(/^\/+|\/+$/g, '');
  return `${BASE}/in/${slug}/`;
}

export default defineSiteAdapter({
  id: 'linkedin',
  name: 'LinkedIn',
  version: '0.2.1',
  description: 'Search people and read profiles using the connected LinkedIn session.',
  origins: ['https://www.linkedin.com'],
  signInUrl: `${BASE}/login`,

  tools: {
    search_people: defineTool({
      description: 'Search LinkedIn people.',
      returns: 'name, connection degree, headline, location and profile URL',
      params: {
        query: p.string('People-search keywords'),
        limit: p.integer('Maximum results to return').default(10).min(1).max(50),
        page: p.integer('1-based results page').default(1).min(1),
      },
      handler: async (page, args) => {
        const url = new URL('/search/results/people/', BASE);
        url.searchParams.set('keywords', args.query);
        if (args.page > 1) url.searchParams.set('page', String(args.page));

        await page.goto(url.toString());
        await page.waitFor({ networkIdle: true, forMs: 1_000 });

        const authError = authenticationError(page.url);
        if (authError) return authError;

        if (!(await page.exists(PEOPLE_ROW))) {
          return err(
            'selector_missing',
            'The people results page rendered without parseable rows.',
            {
              hint: 'Re-run live selector discovery for examples/linkedin.adapter.ts.',
              url: page.url,
            },
          );
        }

        const results = await page.extract({
          each: PEOPLE_ROW,
          limit: args.limit,
          fields: {
            name: PERSON_NAME,
            connectionDegree: {
              selector: PERSON_CONNECTION,
              regex: '[•·]\\s*(1st|2nd|3rd\\+)',
              regexGroup: 1,
              fallback: null,
            },
            headline: PERSON_HEADLINE,
            location: PERSON_LOCATION,
            profileUrl: { selector: PERSON_NAME, prop: 'href' },
          },
        });

        const people = results.filter(
          (person) =>
            typeof person.name === 'string' &&
            typeof person.profileUrl === 'string' &&
            person.profileUrl.includes('/in/'),
        );

        if (people.length === 0) {
          return err('selector_missing', 'Result rows rendered, but their fields did not parse.', {
            hint: 'Re-run live selector discovery for examples/linkedin.adapter.ts.',
            url: page.url,
          });
        }

        return ok(people, {
          summary: `${people.length} people for "${args.query}"${
            args.page > 1 ? `, page ${args.page}` : ''
          }`,
          truncated: people.length >= args.limit,
          nextCursor: people.length >= args.limit ? String(args.page + 1) : undefined,
        });
      },
    }),

    get_profile: defineTool({
      description: 'Read a LinkedIn profile.',
      returns: 'name, headline, location and canonical profile URL',
      params: {
        profile: p.string('Full LinkedIn profile URL, /in/slug, or slug'),
      },
      handler: async (page, args) => {
        const target = resolveProfileUrl(args.profile);
        await page.goto(target);

        const authError = authenticationError(page.url);
        if (authError) return authError;

        if (!(await page.exists(PROFILE_CARD))) {
          return err(
            'selector_missing',
            'The profile page rendered without a parseable top card.',
            {
              hint: 'Re-run live selector discovery for examples/linkedin.adapter.ts.',
              url: page.url,
            },
          );
        }

        const profile = await page.extract({
          fields: {
            name: PROFILE_NAME,
            headline: PROFILE_HEADLINE,
            location: PROFILE_LOCATION,
          },
        });

        if (!profile.name) {
          return err(
            'selector_missing',
            'The profile top card rendered, but its fields did not parse.',
            {
              hint: 'Re-run live selector discovery for examples/linkedin.adapter.ts.',
              url: page.url,
            },
          );
        }

        return ok(
          { ...profile, profileUrl: page.url },
          { summary: `Profile: ${String(profile.name)}` },
        );
      },
    }),
  },
});
