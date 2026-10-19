import { attachMentions } from "./mentions.js";
import { SCHEMA, sourceURL, targetCheck } from "./core.js";
const $ = (id) => document.getElementById(id);
let frame = $("artifact");
const channel = crypto.randomUUID();
let artifact = null,
  threads = [],
  selected = null,
  draft = null,
  commentMode = false,
  locations = new Map(),
  booted = false,
  poll = null,
  authenticating = false,
  opening = false;
let noticeTimer;
async function rpc(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok)
    throw new Error(
      response?.error ||
        "The extension worker is unavailable. Reload this workspace.",
    );
  return response.value;
}
function notice(text, error = false) {
  clearTimeout(noticeTimer);
  $("notice").textContent = text;
  if (!error && document.body.dataset.loaded === "true")
    noticeTimer = setTimeout(() => {
      $("notice").textContent = "";
    }, 4500);
  $("notice").dataset.error = String(error);
}
function frameMessage(type, data = {}) {
  frame.contentWindow.postMessage(
    { schema: "artifact-threads/host", channel, type, ...data },
    "*",
  );
}
function toggleSettings(show) {
  document.body.classList.toggle("settings-open", show);
  $("settings").hidden = !show;
  $("settings-toggle").setAttribute("aria-expanded", String(show));
}
function showDrawer(show) {
  $("comments-drawer").hidden = !show;
  $("threads-toggle").setAttribute("aria-expanded", String(show));
}
$("threads-toggle").onclick = () => showDrawer($("comments-drawer").hidden);
$("drawer-close").onclick = () => {
  showDrawer(false);
  $("threads-toggle").focus();
};
async function loadSettings() {
  const state = await rpc("settings.get");
  $("client-id").value = state.settings.clientId;
  $("repositories").value = state.settings.repositories.join("\n");
  $("connection").textContent = state.connected
    ? "Connected as " + (state.user?.login || "GitHub user")
    : "Not connected";
  $("connect").hidden = state.connected;
  $("disconnect").hidden = !state.connected;
  if (!state.connected || !state.settings.repositories.length)
    toggleSettings(true);
  return state;
}
function cleanHTML(html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("base,meta[http-equiv]").forEach((el) => {
    if (
      el.tagName === "BASE" ||
      /^(content-security-policy|refresh)$/i.test(el.getAttribute("http-equiv"))
    )
      el.remove();
  });
  return "<!doctype html>\n" + parsed.documentElement.outerHTML;
}
function renderArtifact() {
  if (!artifact || !booted) return;
  frame.contentWindow.postMessage(
    {
      schema: "artifact-threads/bootstrap",
      channel,
      html: cleanHTML(artifact.html),
    },
    "*",
  );
  booted = false;
}
addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow) return;
  const data = event.data;
  if (data?.schema === "artifact-threads/boot") {
    booted = true;
    renderArtifact();
    return;
  }
  if (data?.schema !== "artifact-threads/frame" || data.channel !== channel)
    return;
  if (data.type === "ready") {
    frameMessage("mode", { enabled: commentMode });
    sendPins();
    notice(
      "Artifact loaded at an exact commit. Turn on Comment mode to select text or a node.",
    );
  }
  if (data.type === "target" && commentMode) {
    try {
      draft = { id: crypto.randomUUID(), target: targetCheck(data.target) };
      $("selected-target").textContent = targetText(draft.target);
      showDrawer(true);
      $("composer").hidden = false;
      $("conversation").hidden = true;
      $("thread-title").focus();
      notice(
        "Selection ready. Posting creates one GitHub issue as your connected user.",
      );
    } catch (error) {
      notice(error.message, true);
    }
  }
  if (data.type === "thread.select" && Number.isSafeInteger(data.number)) {
    const thread = threads.find((t) => t.number === data.number);
    if (thread) openThread(thread);
  }
  if (data.type === "locations" && Array.isArray(data.locations)) {
    locations = new Map(
      data.locations
        .filter(
          (x) =>
            Number.isSafeInteger(x.number) &&
            ["attached", "missing", "ambiguous"].includes(x.state),
        )
        .map((x) => [x.number, x.state]),
    );
    renderThreads();
  }
  if (data.type === "escape") {
    if (commentMode) $("comment-mode").click();
    else showDrawer(false);
  }
  if (data.type === "selection.error")
    notice(String(data.message || "").slice(0, 300), true);
});
function targetText(target) {
  return target.kind === "text"
    ? target.quote.exact
    : `${target.tag} · ${target.preview || "Selected node"}`;
}
function sendPins() {
  if (!artifact) return;
  frameMessage("threads", {
    threads: threads
      .filter((t) => $("show-closed").checked || t.state === "open")
      .map((t) => ({
        number: t.number,
        target: t.annotation.target,
        state: t.state,
        title: t.title.replace(/^\[Artifact Threads\] /, ""),
      })),
  });
}
function renderThreads() {
  $("threads-toggle").textContent =
    `Comments · ${threads.filter((t) => t.state === "open").length} open`;
  const list = $("threads");
  list.replaceChildren();
  const visible = threads.filter(
    (t) => $("show-closed").checked || t.state === "open",
  );
  if (!visible.length) {
    const p = document.createElement("p");
    p.className = "placeholder";
    p.textContent =
      "No " +
      ($("show-closed").checked ? "" : "open ") +
      "threads on this artifact yet.";
    list.append(p);
  }
  for (const thread of visible) {
    const button = document.createElement("button");
    button.className = "thread";
    button.dataset.selected = String(selected?.number === thread.number);
    const title = document.createElement("strong");
    title.textContent = thread.title.replace(/^\[Artifact Threads\] /, "");
    const author = document.createElement("span");
    author.textContent = `#${thread.number} · @${thread.author} · ${thread.state === "closed" ? "Resolved" : "Open"}`;
    button.append(title, author);
    const state = locations.get(thread.number);
    if (state && state !== "attached") {
      const warning = document.createElement("span");
      warning.className = "location-warning";
      warning.textContent =
        state === "ambiguous"
          ? "Ambiguous target — inspect original"
          : "Target changed or missing — inspect original";
      button.append(warning);
    } else if (
      artifact &&
      thread.annotation.source.commit !== artifact.source.commit
    ) {
      const older = document.createElement("span");
      older.textContent =
        "Originally reviewed at " + thread.annotation.source.commit.slice(0, 7);
      button.append(older);
    }
    button.onclick = () => openThread(thread);
    list.append(button);
  }
}
async function refresh() {
  if (!artifact) return;
  const result = await rpc("threads.list", { source: artifact.source });
  threads = result.threads;
  renderThreads();
  sendPins();
  if (result.truncated)
    notice(
      "Loaded the first 1,000 repository issues. Older annotation threads may be omitted; use GitHub to inspect the full history.",
      true,
    );
  return result;
}
function commentElement(author, body, date, url) {
  const article = document.createElement("article");
  article.className = "comment";
  const meta = document.createElement("div");
  const user = document.createElement("a");
  user.textContent = "@" + author;
  user.href = "https://github.com/" + encodeURIComponent(author);
  user.target = "_blank";
  user.rel = "noreferrer";
  const time = document.createElement("time");
  time.dateTime = date || "";
  time.textContent = date ? new Date(date).toLocaleString() : "";
  meta.append(user, time);
  const text = document.createElement("p");
  text.textContent = body;
  article.append(meta, text);
  if (url) {
    const link = document.createElement("a");
    link.textContent = "Open comment on GitHub ↗";
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.className = "small";
    article.append(link);
  }
  return article;
}
async function openThread(thread) {
  showDrawer(true);
  frameMessage("active", { number: thread.number });
  selected = thread;
  draft = null;
  $("composer").hidden = true;
  $("conversation").hidden = false;
  $("conversation-title").textContent = thread.title.replace(
    /^\[Artifact Threads\] /,
    "",
  );
  $("conversation-meta").textContent =
    `#${thread.number} · ${thread.state === "closed" ? "Resolved" : "Open"} · reviewed ${thread.annotation.source.commit.slice(0, 7)}`;
  $("conversation-target").textContent = targetText(thread.annotation.target);
  const original = new URL(chrome.runtime.getURL("viewer.html"));
  original.searchParams.set(
    "source",
    sourceURL(thread.annotation.source, thread.number),
  );
  $("original").href = original.href;
  $("github").href = thread.url;
  $("resolve").textContent =
    thread.state === "closed" ? "Reopen thread" : "Resolve thread";
  $("comments").replaceChildren(
    commentElement(thread.author, thread.body, thread.createdAt, thread.url),
  );
  renderThreads();
  try {
    const comments = await rpc("thread.comments", {
      source: artifact.source,
      number: thread.number,
    });
    if (selected?.number !== thread.number) return;
    for (const c of comments)
      $("comments").append(
        commentElement(c.author, c.body, c.createdAt, c.url),
      );
  } catch (error) {
    notice(error.message, true);
  }
}
$("settings-toggle").onclick = () => toggleSettings($("settings").hidden);
$("settings-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    await rpc("settings.save", {
      settings: {
        clientId: $("client-id").value,
        repositories: $("repositories").value.split("\n"),
      },
    });
    mentionCache.clear();
    await loadSettings();
    notice("Settings saved. Only configured repositories can be reviewed.");
  } catch (error) {
    notice(error.message, true);
  }
};
$("connect").onclick = async () => {
  if (authenticating) return;
  const connectSource = $("source-url").value.trim();
  try {
    await rpc("settings.save", {
      settings: {
        clientId: $("client-id").value,
        repositories: $("repositories").value.split("\n"),
      },
    });
    const device = await rpc("auth.start");
    $("device").hidden = false;
    $("device-code").textContent = device.code;
    $("verify").href = device.url;
    await chrome.tabs.create({ url: device.url });
    authenticating = true;
    $("connect").disabled = true;
    const check = async () => {
      try {
        const result = await rpc("auth.poll");
        if (result.pending) {
          poll = setTimeout(check, result.interval * 1000);
          return;
        }
        authenticating = false;
        $("connect").disabled = false;
        $("device").hidden = true;
        await loadSettings();
        notice(
          "Connected. GitHub writes will be attributed to @" +
            result.user.login +
            ".",
        );
        if (connectSource) {
          $("source-url").value = connectSource;
          await openArtifact();
        }
      } catch (error) {
        authenticating = false;
        $("connect").disabled = false;
        $("device").hidden = true;
        notice(error.message, true);
      }
    };
    poll = setTimeout(check, device.interval * 1000);
  } catch (error) {
    notice(error.message, true);
  }
};
$("disconnect").onclick = async () => {
  clearTimeout(poll);
  mentionCache.clear();
  await rpc("auth.disconnect");
  await loadSettings();
  notice("Disconnected. Local GitHub credentials were removed.");
};
async function openArtifact() {
  if (opening) return;
  if (draft && ($("thread-title").value || $("thread-body").value)) {
    if (
      !confirm("Discard the unposted thread draft and open another artifact?")
    )
      return;
  }
  opening = true;
  $("open").disabled = true;
  try {
    notice("Loading the exact GitHub file version…");
    const entered = new URL($("source-url").value);
    entered.search = "";
    $("source-url").value = entered.href;
    artifact = await rpc("artifact.open", { url: $("source-url").value });
    selected = null;
    draft = null;
    locations.clear();
    $("composer").hidden = true;
    $("conversation").hidden = true;
    $("thread-title").value = "";
    $("thread-body").value = "";
    $("empty").hidden = true;
    frame.hidden = false;
    $("comment-mode").disabled = false;
    $("refresh").disabled = false;
    $("file-name").textContent =
      artifact.source.repository + " / " + artifact.source.path;
    $("version").textContent =
      `${artifact.source.ref} → ${artifact.source.commit.slice(0, 7)} · immutable reviewed version · embedded assets only`;
    const clean = sourceURL(artifact.source, artifact.thread);
    history.replaceState(
      null,
      "",
      "viewer.html?source=" + encodeURIComponent(clean),
    );
    toggleSettings(false);
    document.body.dataset.loaded = "true";
    document.title =
      artifact.source.path.split("/").at(-1) + " · Artifact Threads";
    // Use a fresh isolated document for each reviewed version.
    const nextFrame = frame.cloneNode(false);
    nextFrame.hidden = false;
    nextFrame.src = "sandbox.html?load=" + crypto.randomUUID();
    booted = false;
    frame.replaceWith(nextFrame);
    frame = nextFrame;
    await refresh();
    showDrawer(threads.some((t) => t.state === "open"));
    if (artifact.thread) {
      const requested = threads.find((t) => t.number === artifact.thread);
      if (requested) await openThread(requested);
    }
  } catch (error) {
    notice(error.message, true);
  } finally {
    opening = false;
    $("open").disabled = false;
  }
}
$("open-form").onsubmit = (event) => {
  event.preventDefault();
  openArtifact();
};
$("comment-mode").onclick = () => {
  commentMode = !commentMode;
  $("comment-mode").setAttribute("aria-pressed", String(commentMode));
  $("comment-mode").textContent = commentMode
    ? "Comment mode: on"
    : "Comment mode";
  frameMessage("mode", { enabled: commentMode });
  notice(
    commentMode
      ? "Select a passage, or click a node/image. Interactive controls are paused while selecting."
      : "Artifact interactions restored.",
  );
};
$("refresh").onclick = async () => {
  try {
    $("refresh").disabled = true;
    await refresh();
    if (selected) {
      const current = threads.find((t) => t.number === selected.number);
      if (current) await openThread(current);
    }
    notice("Threads refreshed from GitHub.");
  } catch (error) {
    notice(error.message, true);
  } finally {
    $("refresh").disabled = false;
  }
};
$("show-closed").onchange = () => {
  renderThreads();
  sendPins();
};
$("cancel").onclick = () => {
  draft = null;
  $("composer").hidden = true;
  $("thread-title").value = "";
  $("thread-body").value = "";
};
$("post").onclick = async () => {
  if (!artifact || !draft) return;
  const pending = draft;
  $("post").disabled = true;
  try {
    const thread = await rpc("thread.create", {
      annotation: {
        schema: SCHEMA,
        id: pending.id,
        source: artifact.source,
        target: pending.target,
      },
      title: $("thread-title").value,
      body: $("thread-body").value,
    });
    draft = null;
    $("thread-title").value = "";
    $("thread-body").value = "";
    await refresh();
    await openThread(threads.find((t) => t.number === thread.number) || thread);
    notice(
      "Thread #" +
        thread.number +
        " posted to GitHub. @mentions use GitHub notifications.",
    );
  } catch (error) {
    notice(error.message, true);
  } finally {
    $("post").disabled = false;
  }
};
$("conversation-close").onclick = () => {
  frameMessage("active", { number: null });
  selected = null;
  $("conversation").hidden = true;
  renderThreads();
};
$("jump").onclick = () => {
  if (selected) frameMessage("jump", { number: selected.number });
};
$("reply").onclick = async () => {
  if (!selected) return;
  const number = selected.number;
  $("reply").disabled = true;
  try {
    await rpc("thread.reply", {
      source: artifact.source,
      number,
      body: $("reply-body").value,
    });
    $("reply-body").value = "";
    if (selected?.number === number) await openThread(selected);
    notice("Reply posted as your GitHub user.");
  } catch (error) {
    notice(error.message, true);
  } finally {
    $("reply").disabled = false;
  }
};
$("resolve").onclick = async () => {
  if (!selected) return;
  const number = selected.number,
    closed = selected.state !== "closed";
  $("resolve").disabled = true;
  try {
    await rpc("thread.state", { source: artifact.source, number, closed });
    await refresh();
    const updated = threads.find((t) => t.number === number);
    if (updated) await openThread(updated);
    notice(
      closed
        ? "Thread resolved. Its GitHub issue is closed."
        : "Thread reopened on GitHub.",
    );
  } catch (error) {
    notice(error.message, true);
  } finally {
    $("resolve").disabled = false;
  }
};
addEventListener("beforeunload", (event) => {
  if (
    (draft && ($("thread-title").value || $("thread-body").value)) ||
    $("reply-body").value.trim()
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});
const mentionCache = new Map();
for (const id of ["thread-body", "reply-body"])
  attachMentions(
    $(id),
    () => artifact?.source.repository,
    async () => {
      if (!artifact) return { users: [] };
      const repo = artifact.source.repository;
      if (!mentionCache.has(repo)) {
        const pending = rpc("mentions.list", { source: artifact.source });
        mentionCache.set(repo, pending);
        pending.catch(() => {
          if (mentionCache.get(repo) === pending) mentionCache.delete(repo);
        });
      }
      return mentionCache.get(repo);
    },
  );
addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (commentMode) $("comment-mode").click();
  else if (!$("settings").hidden) toggleSettings(false);
  else showDrawer(false);
});
const initial = new URL(location.href).searchParams.get("source");
if (initial) $("source-url").value = initial;
loadSettings()
  .then((state) => {
    if (location.hash === "#settings") toggleSettings(true);
    if (initial && state.connected) openArtifact();
  })
  .catch((error) => notice(error.message, true));
