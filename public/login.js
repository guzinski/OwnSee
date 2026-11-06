// Login for the home-network page. The hub sets an HttpOnly session cookie;
// this page never sees or stores the password beyond sending it once.
import { t } from "/i18n.js";

const form = document.getElementById("login-form");
const input = document.getElementById("password");
const msg = document.getElementById("login-msg");
const btn = form.querySelector("button");

const auth = await fetch("/api/auth").then((r) => r.json()).catch(() => null);
if (auth?.loggedIn) location.replace("/");
else if (auth && !auth.passwordSet) {
  msg.textContent = t("noPassword");
  input.disabled = btn.disabled = true;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  btn.disabled = true;
  msg.textContent = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: input.value }),
    });
    if (res.ok) return location.replace("/");
    const body = await res.json().catch(() => ({}));
    msg.textContent =
      body.error === "too-many" ? t("tooManyTries", { seconds: body.retryIn })
      : body.error === "no-password" ? t("noPassword")
      : t("wrongPassword");
    input.select();
  } catch {
    msg.textContent = t("cantReachHub");
  } finally {
    btn.disabled = false;
  }
});
