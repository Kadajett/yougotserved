import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import { handle } from '@yougotserved/registry';

/**
 * The whole registry, mounted behind one catch-all.
 *
 * Restating 22 routes as 22 files would have been 22 chances to change a status
 * code or a header by accident, and the thing depending on them is not a
 * browser: published bridges call `response.json()` on these and nothing else.
 * `handle` is the same function the standalone Worker runs, so there is one
 * implementation, and the 29 tests still cover it.
 *
 * Bindings come from `cloudflare:workers` rather than a handler argument, which
 * is the one seam this port needed and the one thing worth checking on a real
 * deploy rather than in local dev.
 */
const mount = ({ request }: { request: Request }) => handle(request, env as never);

export const Route = createFileRoute('/api/$')({
  server: { handlers: { GET: mount, POST: mount, OPTIONS: mount } },
});
