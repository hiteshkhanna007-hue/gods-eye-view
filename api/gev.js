/**
 * Vercel entry for every `/api/*` route (see the rewrite in vercel.json).
 *
 * Provider disk caches resolve `process.cwd()` when their modules load, and
 * only /tmp is writable on Vercel, so move there before importing them.
 */
try {
  process.chdir('/tmp');
} catch {}

const { default: handler } = await import('../server/vercel/handler.js');

export default handler;
