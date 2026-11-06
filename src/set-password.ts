// Sets the hub's admin password from stdin. Use scripts/set-password.sh,
// which asks for it without showing it on screen.
import { setPassword } from "./auth.ts";

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const pw = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
try {
  setPassword(pw);
  console.log("Password set. Every browser has been logged out.");
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
