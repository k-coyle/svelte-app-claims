import type { RequestHandler } from './$types';
import { ping } from '$lib/server/db';

export const GET: RequestHandler = async () => {
  try {
    await ping();
    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response(`db error: ${(e as Error).message}`, { status: 500 });
  }
};
