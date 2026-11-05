// The HTTPS listener used for remote access (reached through the VPS).
//
// Only clients holding a certificate from the hub's CA get through the TLS
// handshake; only paired, non-revoked devices are kept after it; and revoking
// a device closes its open connections immediately.

import https from "node:https";
import type http from "node:http";
import type net from "node:net";
import type tls from "node:tls";
import { isActiveDevice, onRevoke, tlsMaterial } from "./pki.ts";

export function createTlsServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  upgrade: (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => void,
): https.Server {
  const server = https.createServer(
    { ...tlsMaterial(), requestCert: true, rejectUnauthorized: true, minVersion: "TLSv1.2" },
    handler,
  );

  // Open connections per device, so revoking one cuts its live streams now.
  const open = new Map<string, Set<tls.TLSSocket>>();
  server.on("secureConnection", (sock: tls.TLSSocket) => {
    const fp = sock.getPeerX509Certificate()?.fingerprint256;
    if (!fp || !isActiveDevice(fp)) {
      console.warn("[hub] rejected TLS client: certificate is not a paired device (revoked?)");
      sock.destroy();
      return;
    }
    let set = open.get(fp);
    if (!set) open.set(fp, (set = new Set()));
    set.add(sock);
    sock.on("close", () => {
      set.delete(sock);
      if (!set.size) open.delete(fp);
    });
  });
  onRevoke((fp) => {
    for (const sock of open.get(fp) ?? []) sock.destroy();
  });

  // Handshake failures (scanners, unpaired clients) are expected; stay quiet.
  server.on("tlsClientError", () => {});
  server.on("upgrade", upgrade);
  return server;
}

/** For requests on the TLS listener: is the client still a paired device?
 *  Checked per request, because keep-alive connections outlive the handshake. */
export function isPairedRequest(req: http.IncomingMessage): boolean {
  const fp = (req.socket as tls.TLSSocket).getPeerX509Certificate?.()?.fingerprint256;
  return !!fp && isActiveDevice(fp);
}
