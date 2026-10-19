import {
  settings,
  sourceCheck,
  annotationCheck,
  parseAnnotation,
} from "./core.js";
import { GitHub } from "./github.js";
import { GITHUB_APP_CLIENT_ID } from "./app-config.js";
const defaults = { clientId: GITHUB_APP_CLIENT_ID, repositories: [] };
const trusted = () =>
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
chrome.runtime.onInstalled.addListener(trusted);
chrome.runtime.onStartup.addListener(trusted);
async function config() {
  const stored = (await chrome.storage.local.get("settings")).settings;
  return {
    ...defaults,
    ...stored,
    clientId: stored?.clientId || GITHUB_APP_CLIENT_ID,
  };
}
async function oauth(path, body) {
  const response = await fetch("https://github.com" + path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error("GitHub authorization is unavailable. Try again.");
  return response.json();
}
async function auth() {
  const stored = (await chrome.storage.local.get("auth")).auth;
  if (!stored?.access_token)
    throw new Error(
      "Connect GitHub in Settings to load artifacts and comments.",
    );
  if (stored.expires_at && stored.expires_at < Date.now() + 60000) {
    if (!stored.refresh_token)
      throw new Error("Your GitHub connection expired. Reconnect in Settings.");
    const cfg = await config();
    const result = await oauth("/login/oauth/access_token", {
      client_id: cfg.clientId,
      grant_type: "refresh_token",
      refresh_token: stored.refresh_token,
    });
    if (!result.access_token) {
      await chrome.storage.local.remove("auth");
      throw new Error("Your connection expired. Reconnect GitHub.");
    }
    await saveAuth(result);
    return result.access_token;
  }
  return stored.access_token;
}
async function saveAuth(result) {
  await trusted();
  await chrome.storage.local.set({
    auth: {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: result.expires_in
        ? Date.now() + result.expires_in * 1000
        : null,
    },
  });
}
async function allowedSource(source) {
  const s = sourceCheck(source);
  if (!(await config()).repositories.includes(s.repository))
    throw new Error("This repository is not allowed in Settings.");
  return s;
}
function issueNumber(number) {
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error("Invalid thread number.");
  return number;
}
async function threadAccess(api, source, number) {
  const s = await allowedSource(source);
  const issue = await api.request(
    `/repos/${s.repository}/issues/${issueNumber(number)}`,
  );
  const annotation = parseAnnotation(issue.body || "");
  if (
    !annotation ||
    annotation.source.repository !== s.repository ||
    annotation.source.path !== s.path
  )
    throw new Error("This issue is not a thread on this artifact.");
  return s;
}
async function handle(message) {
  await trusted();
  if (message.type === "settings.get") {
    const cfg = await config();
    return {
      settings: cfg,
      user: (await chrome.storage.local.get("user")).user || null,
      connected: Boolean(
        (await chrome.storage.local.get("auth")).auth?.access_token,
      ),
    };
  }
  if (message.type === "settings.save") {
    const cfg = settings(message.settings);
    const old = await config();
    if (cfg.clientId !== old.clientId)
      await chrome.storage.local.remove(["auth", "user"]);
    await chrome.storage.local.set({ settings: cfg });
    return cfg;
  }
  if (message.type === "auth.disconnect") {
    await chrome.storage.local.remove(["auth", "user"]);
    await chrome.storage.session.remove("pending");
    return true;
  }
  if (message.type === "auth.start") {
    const cfg = await config();
    if (!cfg.clientId)
      throw new Error(
        "The app owner must configure a GitHub App client ID first. See README → GitHub App setup.",
      );
    const result = await oauth("/login/device/code", {
      client_id: cfg.clientId,
    });
    if (result.error)
      throw new Error(
        "GitHub rejected this app configuration. Enable device flow and check the client ID.",
      );
    await chrome.storage.session.set({
      pending: {
        device_code: result.device_code,
        expires: Date.now() + result.expires_in * 1000,
        interval: result.interval || 5,
        next: Date.now() + (result.interval || 5) * 1000,
      },
    });
    return {
      code: result.user_code,
      url: result.verification_uri,
      interval: result.interval || 5,
    };
  }
  if (message.type === "auth.poll") {
    const pending = (await chrome.storage.session.get("pending")).pending;
    if (!pending || Date.now() > pending.expires)
      throw new Error(
        "Authorization expired. Click Connect GitHub to try again.",
      );
    if (Date.now() < pending.next)
      return { pending: true, interval: pending.interval };
    const cfg = await config();
    const result = await oauth("/login/oauth/access_token", {
      client_id: cfg.clientId,
      device_code: pending.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (
      result.error === "authorization_pending" ||
      result.error === "slow_down"
    ) {
      if (result.error === "slow_down") pending.interval += 5;
      pending.next = Date.now() + pending.interval * 1000;
      await chrome.storage.session.set({ pending });
      return { pending: true, interval: pending.interval };
    }
    if (!result.access_token) {
      await chrome.storage.session.remove("pending");
      throw new Error(
        "GitHub authorization was denied or expired. You can connect again.",
      );
    }
    await saveAuth(result);
    const user = await new GitHub(result.access_token).request("/user");
    const profile = { login: user.login, name: user.name || user.login };
    await chrome.storage.local.set({ user: profile });
    await chrome.storage.session.remove("pending");
    return { user: profile };
  }
  const api = new GitHub(await auth());
  if (message.type === "artifact.open")
    return api.artifact(message.url, (await config()).repositories);
  if (message.type === "mentions.list")
    return api.mentionUsers(await allowedSource(message.source));
  if (message.type === "threads.list")
    return api.threads(await allowedSource(message.source));
  if (message.type === "thread.create") {
    const annotation = annotationCheck(message.annotation);
    await allowedSource(annotation.source);
    return api.create(annotation, message.title, message.body);
  }
  if (
    ["thread.comments", "thread.reply", "thread.state"].includes(message.type)
  ) {
    const s = await threadAccess(api, message.source, message.number);
    if (message.type === "thread.comments")
      return api.comments(s, message.number);
    if (message.type === "thread.reply")
      return api.reply(s, message.number, message.body);
    return api.state(s, message.number, Boolean(message.closed));
  }
  throw new Error("Unsupported review action.");
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  let url;
  try {
    url = new URL(sender.url);
  } catch {
    return false;
  }
  if (
    sender.id !== chrome.runtime.id ||
    url.protocol !== "chrome-extension:" ||
    url.hostname !== chrome.runtime.id ||
    !["/viewer.html", "/popup.html"].includes(url.pathname)
  )
    return false;
  handle(message)
    .then((value) => reply({ ok: true, value }))
    .catch((error) => reply({ ok: false, error: error.message }));
  return true;
});
