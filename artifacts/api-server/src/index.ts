import http from "http";
import app from "./app";
import { initSocketServer } from "./socket";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
initSocketServer(server);

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
