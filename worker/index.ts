/** Cloudflare Worker: optional periodic catch-up for release publication.
 * Do not use this for anonymous public access; Vercel validates the bearer secret.
 * Required environment variables: PUBLISH_ENDPOINT, CRON_SHARED_SECRET (as secret).
 */
export interface Env { PUBLISH_ENDPOINT: string; CRON_SHARED_SECRET: string }
export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!env.PUBLISH_ENDPOINT?.startsWith('https://') || !env.CRON_SHARED_SECRET || env.CRON_SHARED_SECRET.length < 32) {
      throw new Error('Cron environment is not configured');
    }
    ctx.waitUntil((async () => {
      const response = await fetch(env.PUBLISH_ENDPOINT, {
        method: 'GET',
        headers: { Authorization: `Bearer ${env.CRON_SHARED_SECRET}` },
        redirect: 'error',
      });
      if(!response.ok)throw new Error(`Publication cron failed (${response.status})`);
    })());
  },
};
