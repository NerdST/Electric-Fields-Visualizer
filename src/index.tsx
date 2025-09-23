/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

// Cloudflare Worker that serves the built static assets (Vite output) if available,
// otherwise responds with a simple text message.

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// If bound static assets exist (configured via wrangler "assets"), delegate to them
		if ((env as any)?.ASSETS?.fetch) {
			// @ts-ignore - optional binding depending on wrangler config
			return (env as any).ASSETS.fetch(request);
		}
		return new Response('Fields Visualizer worker is running.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
	},
} satisfies ExportedHandler<Env>;
