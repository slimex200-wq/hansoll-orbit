import { spawn } from "node:child_process";
import electron from "electron";
import { createServer } from "vite";

const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
});

await server.listen();
const url = server.resolvedUrls?.local[0];

if (!url) {
  await server.close();
  throw new Error("Vite dev server did not provide a local URL.");
}

const child = spawn(electron, ["."], {
  env: {
    ...process.env,
    OPENCRAB_DESKTOP_DEV_URL: url,
  },
  stdio: "inherit",
});

const close = async (exitCode = 0) => {
  await server.close();
  process.exit(exitCode);
};

child.once("exit", (code) => {
  void close(code ?? 0);
});

process.once("SIGINT", () => child.kill());
process.once("SIGTERM", () => child.kill());
