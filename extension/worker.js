import {
  settings,
  sourceCheck,
  annotationCheck,
  parseAnnotation,
  rawReviewURL,
} from "./core.js";
import { GitHub } from "./github.js";
import { GITHUB_APP_CLIENT_ID } from "./app-config.js";
const defaults = {
  clientId: GITHUB_APP_CLIENT_ID,
  repositories: [],
  scriptRepositories: [],
};
let authGeneration = 0;
let authQueue = Promise.resolve();
let refreshing = null;
function authState(action) {
  const result = authQueue.then(action);
  authQueue = result.catch(() => {});
  return result;
}
function currentAuth(generation) {
  if (generation !== authGeneration)
    throw new Error("GitHub connection changed. Connect again if needed.");
}
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
  const snapshot = await authState(async () => ({
    stored: (await chrome.storage.local.get("auth")).auth,
    cfg: await config(),
    generation: authGeneration,
  }));
  const { stored, cfg, generation } = snapshot;
  currentAuth(generation);
  if (!stored?.access_token)
    throw new Error("Connect GitHub in Settings to load artifacts and comments.");
  if (!stored.expires_at || stored.expires_at >= Date.now() + 60000)
    return stored.access_token;
  if (!stored.refresh_token)
    throw new Error("Your GitHub connection expired. Reconnect in Settings.");
  if (refreshing?.generation === generation) return refreshing.promise;
  const promise = (async () => {
    const result = await oauth("/login/oauth/access_token", {
      client_id: cfg.clientId,
      grant_type: "refresh_token",
      refresh_token: stored.refresh_token,
    });
    return authState(async () => {
      currentAuth(generation);
      if (!result.access_token) {
        await chrome.storage.local.remove(["auth", "user"]);
        throw new Error("Your connection expired. Reconnect GitHub.");
      }
      await saveAuth(result);
      return result.access_token;
    });
  })();
  refreshing = { generation, promise };
  try {
    return await promise;
  } finally {
    if (refreshing?.promise === promise) refreshing = null;
  }
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
    return authState(async () => {
      const old = await config();
      if (cfg.clientId !== old.clientId) {
        authGeneration++;
        await chrome.storage.local.remove(["auth", "user"]);
        await chrome.storage.session.remove("pending");
      }
      await chrome.storage.local.set({ settings: cfg });
      return cfg;
    });
  }
  if (message.type === "auth.disconnect") {
    return authState(async () => {
      authGeneration++;
      await chrome.storage.local.remove(["auth", "user"]);
      await chrome.storage.session.remove("pending");
      return true;
    });
  }
  if (message.type === "auth.start") {
    const { cfg, generation } = await authState(async () => {
      authGeneration++;
      await chrome.storage.session.remove("pending");
      return { cfg: await config(), generation: authGeneration };
    });
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
    await authState(async () => {
      currentAuth(generation);
      await chrome.storage.session.set({
        pending: {
          device_code: result.device_code,
          expires: Date.now() + result.expires_in * 1000,
          interval: result.interval || 5,
          next: Date.now() + (result.interval || 5) * 1000,
        },
      });
    });
    return {
      code: result.user_code,
      url: result.verification_uri,
      interval: result.interval || 5,
    };
  }
  if (message.type === "auth.poll") {
    const { pending, cfg, generation } = await authState(async () => ({
      pending: (await chrome.storage.session.get("pending")).pending,
      cfg: await config(),
      generation: authGeneration,
    }));
    if (!pending || Date.now() > pending.expires)
      throw new Error(
        "Authorization expired. Click Connect GitHub to try again.",
      );
    if (Date.now() < pending.next)
      return { pending: true, interval: pending.interval };
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
      await authState(async () => {
        currentAuth(generation);
        await chrome.storage.session.set({ pending });
      });
      return { pending: true, interval: pending.interval };
    }
    if (!result.access_token) {
      await authState(async () => {
        currentAuth(generation);
        await chrome.storage.session.remove("pending");
      });
      throw new Error(
        "GitHub authorization was denied or expired. You can connect again.",
      );
    }
    currentAuth(generation);
    const user = await new GitHub(result.access_token).request("/user");
    const profile = { login: user.login, name: user.name || user.login };
    await authState(async () => {
      currentAuth(generation);
      await saveAuth(result);
      await chrome.storage.local.set({ user: profile });
      await chrome.storage.session.remove("pending");
    });
    return { user: profile };
  }
  const api = new GitHub(await auth());
  if (message.type === "artifact.open") {
    const cfg = await config();
    const artifact = await api.artifact(message.url, cfg.repositories);
    return {
      ...artifact,
      scriptsEnabled: cfg.scriptRepositories.includes(artifact.source.repository),
    };
  }
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

// Take over top-level Raw HTML navigation only for explicitly allowed repos.
// No content script or cross-extension messaging is required. The Raw renderer
// can keep its header rules; our destination is outside those rules' host.
const navigating = new Set();
async function autoReview(details) {
  if (
    details.frameId !== 0 ||
    details.tabId < 0 ||
    navigating.has(details.tabId)
  )
    return;
  navigating.add(details.tabId);
  try {
    const destination = rawReviewURL(
      details.url,
      (await config()).repositories,
      chrome.runtime.getURL("viewer.html"),
    );
    if (!destination) return;
    const tab = await chrome.tabs.get(details.tabId);
    // Do not take over a newer navigation after asynchronous settings reads.
    if ((tab.pendingUrl || tab.url) !== details.url) return;
    await chrome.tabs.update(details.tabId, { url: destination });
  } catch {
    // A closed tab, unsupported file, or interrupted navigation needs no action.
  } finally {
    navigating.delete(details.tabId);
  }
}
const rawNavigation = {
  url: [{ schemes: ["https"], hostEquals: "raw.githubusercontent.com" }],
};
chrome.webNavigation.onBeforeNavigate.addListener(autoReview, rawNavigation);
chrome.webNavigation.onCommitted.addListener(autoReview, rawNavigation);
