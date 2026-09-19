import { setMaxListeners } from "node:events";
import app from "./app";
import { logger } from "./lib/logger";
import { cleanupExpiredSources, resumeInterruptedJobs } from "./lib/yappingProcessor";

// App Storage bridges Google Cloud PassThrough streams to Web Streams and can
// legitimately attach more than Node's default ten listeners during a request.
// These streams are short-lived; allow the bridge to manage its own listeners
// without emitting false memory-leak warnings in production logs.
setMaxListeners(0);

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void resumeInterruptedJobs();
  void cleanupExpiredSources();
  setInterval(() => void cleanupExpiredSources(), 6 * 60 * 60 * 1000);
});
