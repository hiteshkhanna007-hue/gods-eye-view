/**
 * Vercel adapter: serves every `/api/*` route from one serverless function by
 * running the same provider plugins the Vite dev/preview server installs.
 *
 * Vercel's edge is a trusted reverse proxy. The providers' gates were written
 * for a direct connection (socket peer = client, TLS on the socket, no
 * forwarding headers), so each request is normalized into that shape before it
 * reaches them: the client address comes from Vercel's own `x-forwarded-for`,
 * HTTPS from `x-forwarded-proto`, and the forwarding headers are removed. The
 * client address is then never loopback, so the loopback-only surfaces (the
 * key-setup panel, Codex OAuth) stay refused; the key-setup and MCP plugins
 * are not installed at all.
 */

import { localProviderPlugins } from '../providers/local.js';
import { PROXY_SIGNALS } from '../../src/localRequestGate.mjs';
import { apiNotFoundPlugin } from '../standalone/api-not-found.js';
import { standaloneVoiceTools } from '../standalone/voiceTools.js';

/** Plugins that only make sense on the operator's own machine. */
const LOCAL_ONLY_PLUGINS = new Set(['gev-key-setup', 'local-receivers-proxy']);

/** Collect plugin middleware into a Connect-style stack. */
function buildStack() {
  const layers = [];
  const middlewares = {
    use(route, handler) {
      if (typeof route === 'function')
        layers.push({ route: '', handler: route });
      else layers.push({ route: String(route).replace(/\/+$/, ''), handler });
      return middlewares;
    },
  };
  const server = { middlewares, httpServer: null, config: {} };
  const plugins = [
    ...localProviderPlugins({ realtime: { tools: standaloneVoiceTools() } }),
    apiNotFoundPlugin(),
  ].filter((plugin) => plugin && !LOCAL_ONLY_PLUGINS.has(plugin.name));
  for (const plugin of plugins) {
    const hook = plugin.configurePreviewServer ?? plugin.configureServer;
    const fn = typeof hook === 'function' ? hook : hook?.handler;
    const post = fn?.call(plugin, server);
    if (typeof post === 'function') post();
  }
  return layers;
}

let stack;

/** Rewrite Vercel's forwarding headers into the direct-connection shape. */
function normalizeProxiedRequest(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const https =
    String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase() === 'https';
  const host = String(req.headers['x-forwarded-host'] || '').trim();
  if (host) req.headers.host = host;
  for (const name of PROXY_SIGNALS) delete req.headers[name];
  const socket = req.socket;
  if (socket) {
    Object.defineProperty(socket, 'remoteAddress', {
      value: forwardedFor || 'unknown',
      configurable: true,
    });
    if (https) {
      Object.defineProperty(socket, 'encrypted', {
        value: true,
        configurable: true,
      });
    }
  }
}

/** Whether `pathname` falls under a Connect mount `route`. */
function matches(route, pathname) {
  if (!route) return true;
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** Run the stack the way Connect does: prefix match, strip, call, next(). */
function dispatch(req, res) {
  return new Promise((resolve) => {
    const originalUrl = req.url || '/';
    req.originalUrl = originalUrl;
    let index = 0;
    res.once('finish', resolve);
    res.once('close', resolve);

    const next = (error) => {
      req.url = originalUrl;
      if (error) return fail(error);
      const pathname = originalUrl.split('?')[0];
      while (index < stack.length) {
        const layer = stack[index++];
        if (!matches(layer.route, pathname)) continue;
        req.url = originalUrl.slice(layer.route.length) || '/';
        if (!req.url.startsWith('/')) req.url = `/${req.url}`;
        try {
          const result = layer.handler(req, res, next);
          if (result && typeof result.catch === 'function') result.catch(fail);
        } catch (thrown) {
          fail(thrown);
        }
        return undefined;
      }
      if (!res.headersSent) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(JSON.stringify({ error: 'Unknown API route' }));
      return undefined;
    };

    const fail = (error) => {
      console.error('[gev-api]', originalUrl.split('?')[0], error);
      if (res.writableEnded) return;
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
      }
      res.end(JSON.stringify({ error: 'Internal error' }));
    };

    next();
  });
}

export default async function handler(req, res) {
  stack ??= buildStack();
  normalizeProxiedRequest(req);
  await dispatch(req, res);
}
