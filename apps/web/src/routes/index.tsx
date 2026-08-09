import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import { handle } from '@yougotserved/registry';
// Read at build time from the file the standalone site already served, so the
// merge does not fork the marketing copy into a second place that drifts.
import siteHtml from '../../../site/public/index.html?raw';

/** The only hostname that gets the marketing page. */
const SITE_HOST = 'yougotserved.dev';

/**
 * One deploy, two front doors.
 *
 * `registry.yougotserved.dev/` lists adapters. `yougotserved.dev/` sells the
 * project. They were separate Workers, and merging them means `/` has to answer
 * differently depending on which name was asked for.
 *
 * The split is on hostname rather than a path prefix, because both pages are
 * already linked as bare domains from published installs, from npm, and from
 * the store listing. Anything that changed those URLs would break links that
 * are already in the wild.
 */
export const Route = createFileRoute('/')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const host = new URL(request.url).hostname;
        // Marketing is the special case, not the default. Everything else is a
        // registry hostname, including the workers.dev name that published
        // installs still resolve through, which reached the adapter list before
        // this merge and has to keep doing so.
        if (host !== SITE_HOST && host !== `www.${SITE_HOST}`) {
          return handle(request, env as never);
        }

        return new Response(siteHtml, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            // Same reason as the registry page: a response with no directive is
            // one the browser caches on a guess, and a briefly wrong page then
            // outlives the fix.
            'cache-control': 'no-store, must-revalidate',
          },
        });
      },
    },
  },
});
