// Serves the Android app from the hub, so phones at home can install it from
// a QR code on the Devices page. scripts/publish-apk.sh puts the signed
// release APK and its metadata in data/app/.

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type http from "node:http";
import { DATA_DIR } from "./config.ts";
import { homeAddress, qrSvg } from "./pairing.ts";

const APP_DIR = join(DATA_DIR, "app");
const APK = join(APP_DIR, "ownsee.apk");
const META = join(APP_DIR, "ownsee.json");

interface AppMeta { versionName: string; versionCode: number; size: number; sha256: string; published: string }

function meta(): AppMeta | null {
  if (!existsSync(APK) || !existsSync(META)) return null;
  try {
    return JSON.parse(readFileSync(META, "utf8")) as AppMeta;
  } catch {
    return null;
  }
}

/** Returns true if it handled the request. `secure` = paired device over HTTPS. */
export function handleAppDist(req: http.IncomingMessage, res: http.ServerResponse, path: string, secure: boolean): boolean {
  // GET /app/ownsee.apk: the installable app (also over HTTPS, for in-app updates later).
  if (path === "/app/ownsee.apk" && req.method === "GET") {
    const m = meta();
    if (!m) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("No app published yet. Run scripts/publish-apk.sh on the hub.");
      return true;
    }
    res.writeHead(200, {
      "content-type": "application/vnd.android.package-archive",
      "content-length": String(statSync(APK).size),
      "content-disposition": `attachment; filename="OwnSee-${m.versionName}.apk"`,
      "cache-control": "no-store",
    });
    createReadStream(APK).pipe(res);
    return true;
  }

  // GET /api/app?lan=<origin>: version info, plus a download QR on the home network.
  if (path === "/api/app" && req.method === "GET") {
    const m = meta();
    const body: Record<string, unknown> = { available: !!m, ...(m ?? {}) };
    if (m && !secure) {
      const lan = homeAddress(new URL(req.url!, "http://x").searchParams.get("lan"));
      if (lan) {
        body.url = `${lan}/app/ownsee.apk`;
        body.qrSvg = qrSvg(body.url as string);
      }
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
    return true;
  }
  return false;
}
