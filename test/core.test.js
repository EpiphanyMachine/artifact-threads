import test from "node:test";
import assert from "node:assert/strict";
import {
  settings,
  parseArtifact,
  sourceCheck,
  targetCheck,
  issueBody,
  parseAnnotation,
  fence,
  rawReviewURL,
} from "../extension/core.js";
import { GitHub } from "../extension/github.js";
const source = {
  repository: "your-org/artifacts",
  path: "docs/review.html",
  ref: "gh/proposal",
  commit: "a".repeat(40),
  blob: "b".repeat(40),
};
const annotation = {
  schema: "artifact-threads/v1",
  id: "test-thread-123",
  source,
  target: {
    kind: "text",
    selector: "#r1",
    id: "r1",
    tag: "P",
    quote: {
      exact: "A requirement — 你好",
      prefix: "Before ",
      suffix: " after",
    },
  },
};
test("normalizes a finite allowlist and rejects wildcard/URL/configuration surprises", () => {
  assert.deepEqual(
    settings({
      repositories: ["Your-Org/Artifacts", "your-org/artifacts", ""],
      clientId: "Iv1.publicid",
    }).repositories,
    ["your-org/artifacts"],
  );
  for (const name of [
    "*/*",
    "https://github.com/a/b",
    "../artifacts",
    "a/..",
    "a/repo/path",
  ])
    assert.throws(() => settings({ repositories: [name] }));
});
test("parses GitHub and Raw links without retaining query tokens; preserves slash refs and thread links", () => {
  const value = parseArtifact(
    "https://raw.githubusercontent.com/your-org/artifacts/gh/proposal/docs/review.html?token=secret#artifact-thread=12",
  );
  assert.equal(JSON.stringify(value).includes("secret"), false);
  assert.equal(value.thread, 12);
  assert.ok(
    value.candidates.some(
      (c) => c.ref === "gh/proposal" && c.path === "docs/review.html",
    ),
  );
  for (const url of [
    "https://evil.com/a/b/main/x.html",
    "http://github.com/a/b/blob/main/x.html",
    "https://github.com/a/b/tree/main",
    "https://github.com/a/b/blob/main/x.json",
    "https://user:pass@github.com/a/b/blob/main/x.html",
  ])
    assert.throws(() => parseArtifact(url));
});
test("rejects unsupported anchors and non-versioned sources", () => {
  assert.throws(() => sourceCheck({ ...source, commit: "main" }));
  assert.throws(() => sourceCheck({ ...source, path: "../x.html" }));
  assert.throws(() =>
    targetCheck({ ...annotation.target, quote: { exact: "" } }),
  );
  assert.throws(() => targetCheck({ kind: "script", selector: "#x" }));
});
test("round-trips structured Unicode metadata while keeping user mentions separate from selected quotes", () => {
  const body = issueBody(annotation, "@colleague please clarify", 42);
  assert.deepEqual(parseAnnotation(body), annotation);
  assert.ok(body.startsWith("@colleague"));
  assert.ok(body.includes("#artifact-thread=42"));
  assert.equal(parseAnnotation("<!-- artifact-threads:invalid -->"), null);
  assert.ok(fence("```\n@person").startsWith("````\n"));
});
test("GitHub client restricts requests, keeps credentials in headers and avoids duplicate thread creation", async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/issues?"))
      return new Response(
        JSON.stringify([
          {
            number: 12,
            title: "Existing",
            body: issueBody(annotation, "Prior"),
            state: "open",
            user: { login: "alice" },
          },
        ]),
      );
    throw new Error("Unexpected write");
  };
  const api = new GitHub("fixture-token", fetcher);
  const thread = await api.create(annotation, "New", "Comment");
  assert.equal(thread.number, 12);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].options.headers.Authorization,
    "Bearer fixture-token",
  );
  assert.equal(requests[0].url.includes("fixture-token"), false);
  await assert.rejects(
    () => api.request("https://elsewhere.example"),
    /Invalid/,
  );
});
test("resolves immutable source versions and supports the raw Contents response for larger artifacts", async () => {
  const seen = [];
  const api = new GitHub("fixture-token", async (url, options) => {
    seen.push({ url, options });
    if (url.includes("/commits/gh%2Fproposal"))
      return new Response(JSON.stringify({ sha: source.commit }));
    if (url.includes("/commits/")) return new Response("{}", { status: 404 });
    if (options.headers.Accept === "application/vnd.github.raw+json")
      return new Response("<!doctype html><p>Portable</p>");
    return new Response(
      JSON.stringify({
        type: "file",
        size: 1100000,
        sha: source.blob,
        encoding: "none",
      }),
    );
  });
  const file = await api.artifact(
    "https://github.com/your-org/artifacts/blob/gh/proposal/docs/review.html",
    ["your-org/artifacts"],
  );
  assert.equal(file.source.commit, source.commit);
  assert.equal(file.source.path, source.path);
  assert.ok(file.html.includes("Portable"));
  assert.ok(
    seen
      .filter((r) => r.url.includes("/contents/"))
      .every((r) => r.url.endsWith("?ref=" + source.commit)),
  );
  await assert.rejects(
    () =>
      api.artifact(
        "https://github.com/your-org/artifacts/blob/main/x.html",
        [],
      ),
    /Allow/,
  );
});

test("parses namespaced Raw branch and tag links without retaining tokens", () => {
  for (const namespace of ["heads", "tags"]) {
    const parsed = parseArtifact(
      `https://raw.githubusercontent.com/your-org/artifacts/refs/${namespace}/release/v1/docs/review.html?token=discard-me`,
    );
    assert.ok(
      parsed.candidates.some(
        (c) =>
          c.ref === `${namespace}/release/v1` && c.path === "docs/review.html",
      ),
    );
    assert.equal(JSON.stringify(parsed).includes("discard-me"), false);
    assert.equal(
      parsed.candidates.some((c) => c.ref.startsWith("refs/")),
      false,
    );
  }
});
test("mention suggestions paginate repository assignees and return only safe logins", async () => {
  const paths = [];
  const api = new GitHub("fixture", async (url, options) => {
    paths.push(url);
    assert.equal(options.method, "GET");
    return {
      ok: true,
      status: 200,
      json: async () =>
        paths.length === 1
          ? Array.from({ length: 100 }, (_, i) => ({ login: `person-${i}` }))
          : [{ login: "bob" }, { login: "person-1" }, { login: "<script>" }],
    };
  });
  const result = await api.mentionUsers(source);
  assert.equal(result.users.length, 101);
  assert.ok(result.users.includes("bob"));
  assert.equal(result.truncated, false);
  assert.ok(
    paths[1].endsWith(
      "/repos/your-org/artifacts/assignees?per_page=100&page=2",
    ),
  );
});

test("automatic review only handles allowlisted Raw HTML and strips secrets", () => {
  const viewer = "chrome-extension://test/viewer.html";
  const allowed = ["your-org/artifacts"];
  const result = rawReviewURL(
    "https://raw.githubusercontent.com/your-org/artifacts/refs/heads/main/report.html?token=discard-me#artifact-thread=2",
    allowed,
    viewer,
  );
  assert.equal(result.includes("discard-me"), false);
  assert.equal(
    new URL(result).searchParams.get("source"),
    "https://raw.githubusercontent.com/your-org/artifacts/refs/heads/main/report.html#artifact-thread=2",
  );
  assert.equal(
    rawReviewURL(
      "https://raw.githubusercontent.com/other/repo/main/report.html",
      allowed,
      viewer,
    ),
    null,
  );
  assert.equal(
    rawReviewURL(
      "https://github.com/your-org/artifacts/blob/main/report.html",
      allowed,
      viewer,
    ),
    null,
  );
  assert.throws(() =>
    rawReviewURL(
      "https://raw.githubusercontent.com/your-org/artifacts/main/data.json",
      allowed,
      viewer,
    ),
  );
});

test("script trust defaults off, is per repository, and cannot escape the allowlist", () => {
  assert.deepEqual(settings({ repositories: ["org/docs"] }).scriptRepositories, []);
  assert.deepEqual(settings({ repositories: ["org/docs", "org/other"], scriptRepositories: ["ORG/DOCS"] }).scriptRepositories, ["org/docs"]);
  for (const scriptRepositories of [["other/repo"], "org/docs", [null], ["*/*"]])
    assert.throws(() => settings({ repositories: ["org/docs"], scriptRepositories }));
});
