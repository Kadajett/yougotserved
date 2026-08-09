import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import { handle } from '@yougotserved/registry';

/**
 * The page where a person approves an agent's device code.
 *
 * Not under `/api`, so the catch-all there does not reach it, and a 404 here
 * means `ygs account login` prints a URL that goes nowhere.
 */
const mount = ({ request }: { request: Request }) => handle(request, env as never);

export const Route = createFileRoute('/auth/device')({
  server: { handlers: { GET: mount, POST: mount } },
});
