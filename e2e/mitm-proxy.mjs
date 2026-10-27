/**
 * mitm-proxy.mjs — a tiny HTTPS interceptor for the Obsidian E2E.
 *
 * Obsidian's `requestUrl` goes through Electron's net stack in the main process,
 * which Playwright's page-level routing cannot see. Launching the app with
 * `--proxy-server` + `--ignore-certificate-errors` puts every request on this
 * proxy instead, so the Google engine can be answered deterministically while
 * the plugin still uses the real requestUrl path.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, "..", ".cache");
const HOST = "translate.googleapis.com";

function ensureCert() {
  fs.mkdirSync(CACHE, { recursive: true });
  const key = path.join(CACHE, "mitm-key.pem");
  const cert = path.join(CACHE, "mitm-cert.pem");
  if (fs.existsSync(key) && fs.existsSync(cert)) return { key, cert };
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "2",
      "-subj",
      `/CN=${HOST}`,
      "-addext",
      `subjectAltName=DNS:${HOST}`,
    ],
    { stdio: "ignore" }
  );
  return { key, cert };
}

/** Answer any decrypted HTTP request with a gtx-shaped translation. */
function answer(socket, raw) {
  const first = raw.split("\r\n")[0] || "";
  const url = first.split(" ")[1] || "/";
  const query = new URL(url, `https://${HOST}`).searchParams.get("q") || "";
  const body = JSON.stringify([[["译文", query, null, null, 10]], null, "en"]);
  const response =
    "HTTP/1.1 200 OK\r\n" +
    "content-type: application/json\r\n" +
    `content-length: ${Buffer.byteLength(body)}\r\n` +
    "connection: close\r\n\r\n" +
    body;
  socket.end(response);
}

export async function startMitmProxy() {
  const { key, cert } = ensureCert();
  const secureContext = tls.createSecureContext({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) });
  const seen = [];

  const server = http.createServer((req, res) => {
    // Plain HTTP never happens for Google; keep the proxy honest.
    res.writeHead(501).end("CONNECT only");
  });

  server.on("connect", (req, clientSocket, head) => {
    seen.push(req.url);
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const secure = new tls.TLSSocket(clientSocket, { isServer: true, secureContext });
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      secure.removeListener("data", onData);
      answer(secure, buffer.toString("utf8"));
    };
    secure.on("data", onData);
    secure.on("error", () => clientSocket.destroy());
    if (head && head.length) secure.write(head);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

export const GOOGLE_HOST = HOST;
export { net };
