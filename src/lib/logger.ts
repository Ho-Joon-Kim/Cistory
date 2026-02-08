import { Logtail } from "@logtail/node";

const token = process.env.BETTER_STACK_SOURCE_TOKEN;

const logtail = token ? new Logtail(token) : null;

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
