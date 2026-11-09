import { Logtail } from "@logtail/node";

/**
 * The ingesting host @logtail/core 0.5.x used when no `endpoint` was given
 * (`defaultOptions.endpoint` in @logtail/core@0.5.8 dist/cjs/base.js). 0.6.0 removed that default
 * and made `endpoint` required, so we pin the old value to keep working without new config.
 */
export const DEFAULT_BETTER_STACK_INGESTING_HOST = "https://in.logs.betterstack.com";

/**
 * Resolves the ingesting host: `BETTER_STACK_INGESTING_HOST` if set (a bare host as Better Stack
 * shows it, or a full URL — @logtail/core 0.6 prefixes `https://` when the scheme is missing),
 * otherwise the 0.5.x default.
 */
export function resolveBetterStackEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.BETTER_STACK_INGESTING_HOST?.trim();
  return override ? override : DEFAULT_BETTER_STACK_INGESTING_HOST;
}

const token = process.env.BETTER_STACK_SOURCE_TOKEN;

const logtail = token ? new Logtail(token, { endpoint: resolveBetterStackEndpoint() }) : null;

type Meta = Record<string, unknown>;

export const logger = {
  info(message: string, meta?: Meta) {
    console.log(message, meta ?? "");
    logtail?.info(message, meta);
  },

  warn(message: string, meta?: Meta) {
    console.warn(message, meta ?? "");
    logtail?.warn(message, meta);
  },

  error(message: string, meta?: Meta) {
    console.error(message, meta ?? "");
    logtail?.error(message, meta);
  },

  async flush() {
    await logtail?.flush();
  },
};
