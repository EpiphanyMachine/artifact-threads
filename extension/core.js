export const SCHEMA = "artifact-threads/v1";
export const MARKER = "artifact-threads:";
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export function repository(input) {
  const text = String(input).trim().toLowerCase();
  if (
    !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\/[a-z\d_.-]{1,100}$/.test(text) ||
    [".", ".."].includes(text.split("/")[1])
  )
    throw new Error("Use owner/repository, without a URL or wildcard.");
  return text;
}
export function settings(input) {
  const repositories = [
    ...new Set(
      input.repositories.filter((value) => value.trim()).map(repository),
    ),
  ];
  if (repositories.length > 100)
    throw new Error("Add at most 100 repositories.");
  const clientId = String(input.clientId || "").trim();
  if (clientId && !/^[a-zA-Z\d_.-]{5,100}$/.test(clientId))
    throw new Error("Enter the public GitHub App client ID, not a secret.");
  return { repositories, clientId };
}
export function parseArtifact(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Use a normal HTTPS GitHub file link.");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (url.hostname === "github.com") {
    if (parts[2] !== "blob")
      throw new Error(
        "Open a specific HTML file, not a repository or directory.",
      );
    parts.splice(2, 1);
  } else if (url.hostname !== "raw.githubusercontent.com")
    throw new Error("This version supports GitHub and GitHub raw file links.");
  const repo = repository(parts.slice(0, 2).join("/"));
  const tail = parts.slice(2);
  // Raw links may explicitly name the refs namespace; the commit API takes
  // heads/<branch> or tags/<tag>, preserving branch/tag name collisions.
  const namespaced =
    url.hostname === "raw.githubusercontent.com" &&
    tail[0] === "refs" &&
    ["heads", "tags"].includes(tail[1]);
  if (namespaced) tail.shift();
  if (
    tail.length < 2 ||
    tail.length > 24 ||
    !/\.html?$/i.test(tail.at(-1)) ||
    tail.some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Choose a standalone .html or .htm file.");
  const candidates = [];
  for (let n = namespaced ? 2 : 1; n < tail.length; n++)
    candidates.push({
      ref: tail.slice(0, n).join("/"),
      path: tail.slice(n).join("/"),
    });
  const match = url.hash.match(/^#artifact-thread=(\d+)$/);
  return {
    repository: repo,
    candidates,
    thread: match ? Number(match[1]) : null,
  };
}
export function sourceCheck(value) {
  if (
    !value ||
    !/^[a-f\d]{40}$/i.test(value.commit) ||
    !/^[a-f\d]{40}$/i.test(value.blob) ||
    typeof value.path !== "string" ||
    !/\.html?$/i.test(value.path) ||
    value.path.split("/").some((x) => !x || x === "." || x === "..") ||
    value.path.length > 1000
  )
    throw new Error("Invalid reviewed source version.");
  return {
    repository: repository(value.repository),
    path: value.path,
    ref: String(value.ref || value.commit).slice(0, 500),
    commit: value.commit.toLowerCase(),
    blob: value.blob.toLowerCase(),
  };
}
export function sourceURL(source, thread) {
  const s = sourceCheck(source);
  return (
    `https://github.com/${s.repository}/blob/${s.commit}/${s.path.split("/").map(encodeURIComponent).join("/")}` +
    (thread ? `#artifact-thread=${Number(thread)}` : "")
  );
}
export function targetCheck(value) {
  if (
    !value ||
    !["text", "element"].includes(value.kind) ||
    typeof value.selector !== "string" ||
    value.selector.length > 1500
  )
    throw new Error("Select text or a node in the artifact.");
  const target = {
    kind: value.kind,
    selector: value.selector,
    id: String(value.id || "").slice(0, 300),
    tag: String(value.tag || "").slice(0, 30),
  };
  if (value.kind === "text") {
    if (
      !value.quote ||
      typeof value.quote.exact !== "string" ||
      !value.quote.exact.trim() ||
      value.quote.exact.length > 2000
    )
      throw new Error("Select between 1 and 2,000 characters.");
    target.quote = {
      exact: value.quote.exact,
      prefix: String(value.quote.prefix || "").slice(-80),
      suffix: String(value.quote.suffix || "").slice(0, 80),
    };
  } else {
    target.fingerprint = String(value.fingerprint || "").slice(0, 100);
    target.preview = String(value.preview || "").slice(0, 300);
    target.point = {
      x: Math.min(1, Math.max(0, Number(value.point?.x) || 0)),
      y: Math.min(1, Math.max(0, Number(value.point?.y) || 0)),
    };
  }
  return target;
}
export function annotationCheck(value) {
  if (!value || value.schema !== SCHEMA || !/^[\w-]{8,80}$/.test(value.id))
    throw new Error("Invalid annotation metadata.");
  return {
    schema: SCHEMA,
    id: value.id,
    source: sourceCheck(value.source),
    target: targetCheck(value.target),
  };
}
export function fence(text) {
  const matches = text.match(/`+/g) || [];
  const delimiter = "`".repeat(
    Math.max(3, ...matches.map((x) => x.length + 1)),
  );
  return `${delimiter}\n${text}\n${delimiter}`;
}
export function issueBody(annotation, comment, issueNumber) {
  const a = annotationCheck(annotation);
  const text = String(comment).trim();
  if (!text || text.length > 10000)
    throw new Error("Write a comment of up to 10,000 characters.");
  const quoted =
    a.target.kind === "text"
      ? a.target.quote.exact
      : a.target.preview || a.target.tag;
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(a))));
  return `${text}\n\n---\n[Open reviewed artifact](${sourceURL(a.source, issueNumber)}) · ${a.source.path}\n\nSelected ${a.target.kind}:\n${fence(quoted)}\n\n<!-- ${MARKER}${encoded} -->`;
}
export function parseAnnotation(body) {
  try {
    const value = body.match(/<!-- artifact-threads:([A-Za-z\d+/=]+) -->/);
    if (!value || value[1].length > 20000) return null;
    return annotationCheck(
      JSON.parse(decodeURIComponent(escape(atob(value[1])))),
    );
  } catch {
    return null;
  }
}
export function readableComment(body) {
  return String(body || "")
    .split("\n\n---\n[Open reviewed artifact](")[0]
    .replace(/<!-- artifact-threads:[\s\S]*?-->/g, "")
    .trim();
}
