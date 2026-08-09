import { createFileRoute } from '@tanstack/react-router';

/**
 * The shape every registry route has to keep.
 *
 * The bridge calls `response.json()` and nothing else, so a route that returns
 * a component, a redirect to a shell, or HTML on an error is a break the type
 * system will not catch. This one exists to prove the shape survives the move,
 * before 22 real routes depend on it.
 */
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ ok: true, from: 'tanstack-start' }), {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
    },
  },
});
