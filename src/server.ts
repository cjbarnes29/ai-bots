import Fastify from "fastify";

// Phase 0: a minimal server. No bots, no AI model calls, no integrations.
const app = Fastify({ logger: true });

app.get("/", async () => {
  return { message: "Hello from the AI Workforce Platform", phase: 0 };
});

app.get("/health", async () => {
  return { status: "ok" };
});

const port = Number(process.env.PORT ?? 3000);

// 127.0.0.1 = reachable from this PC only (not from your network).
await app.listen({ port, host: "127.0.0.1" });
