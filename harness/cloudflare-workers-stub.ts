// Minimal stand-in for the `cloudflare:workers` module so upstream worker code
// can be imported and executed under plain Node (vitest). Only the symbols the
// upstream code actually touches are provided.

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props?: unknown;
}

export interface WorkerEntrypoint<Env = unknown> {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

export const env = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive || prop === "toString") return () => "";
      return undefined;
    },
  },
);

export default {};
