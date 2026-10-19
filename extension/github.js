import {
  MAX_HTML_BYTES,
  parseArtifact,
  sourceCheck,
  parseAnnotation,
  issueBody,
  annotationCheck,
  readableComment,
} from "./core.js";
export class GitHub {
  constructor(token, fetcher = (...args) => fetch(...args)) {
    this.token = token;
    this.fetcher = fetcher;
  }
  async request(
    path,
    {
      method = "GET",
      body,
      accept = "application/vnd.github+json",
      raw = false,
    } = {},
  ) {
    if (!path.startsWith("/") || path.includes("://"))
      throw new Error("Invalid GitHub API path.");
    const response = await this.fetcher("https://api.github.com" + path, {
      method,
      headers: {
        Accept: accept,
        Authorization: "Bearer " + this.token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
    });
    if (!response.ok) {
      const error = new Error(
        response.status === 401
          ? "Your GitHub connection expired. Reconnect in Settings."
          : response.status === 403
            ? "GitHub denied this action. Check repository installation, user permissions, and API rate limits."
            : response.status === 404
              ? "GitHub could not find this resource. Check the app installation and your repository access."
              : `GitHub request failed (${response.status}). Your draft is still here.`,
      );
      error.status = response.status;
      throw error;
    }
    return response.status === 204
      ? null
      : raw
        ? response.text()
        : response.json();
  }
  async artifact(input, allowed) {
    const parsed = parseArtifact(input);
    if (!allowed.includes(parsed.repository))
      throw new Error(
        "Allow " +
          parsed.repository +
          " in Settings before reviewing its files.",
      );
    const base = "/repos/" + parsed.repository;
    for (const candidate of parsed.candidates) {
      try {
        const commit = await this.request(
          base + "/commits/" + encodeURIComponent(candidate.ref),
        );
        const path = candidate.path
          .split("/")
          .map(encodeURIComponent)
          .join("/");
        const endpoint = base + "/contents/" + path + "?ref=" + commit.sha;
        const file = await this.request(endpoint, {
          accept: "application/vnd.github.object+json",
        });
        if (file.type !== "file") continue;
        if (file.size > MAX_HTML_BYTES)
          throw new Error("Use a self-contained HTML file smaller than 5 MiB.");
        let html;
        if (file.encoding === "base64" && file.content) {
          const bytes = Uint8Array.from(
            atob(file.content.replace(/\s/g, "")),
            (c) => c.charCodeAt(0),
          );
          html = new TextDecoder().decode(bytes);
        } else
          html = await this.request(endpoint, {
            accept: "application/vnd.github.raw+json",
            raw: true,
          });
        if (new TextEncoder().encode(html).length > MAX_HTML_BYTES)
          throw new Error("Use a self-contained HTML file smaller than 5 MiB.");
        return {
          html,
          source: sourceCheck({
            repository: parsed.repository,
            path: candidate.path,
            ref: candidate.ref,
            commit: commit.sha,
            blob: file.sha,
          }),
          thread: parsed.thread,
        };
      } catch (error) {
        if (error.status === 404 || error.status === 422) continue;
        throw error;
      }
    }
    throw new Error(
      "The HTML file or branch was not found. Check its GitHub link and repository access.",
    );
  }
  async threads(source) {
    const s = sourceCheck(source);
    const found = [];
    let truncated = false;
    for (let page = 1; page <= 10; page++) {
      const items = await this.request(
        `/repos/${s.repository}/issues?state=all&per_page=100&page=${page}`,
      );
      for (const issue of items) {
        if (issue.pull_request) continue;
        const annotation = parseAnnotation(issue.body || "");
        if (
          annotation &&
          annotation.source.repository === s.repository &&
          annotation.source.path === s.path
        )
          found.push({ ...this.thread(issue), annotation });
      }
      if (items.length < 100) break;
      if (page === 10) truncated = true;
    }
    return { threads: found.sort((a, b) => a.number - b.number), truncated };
  }
  thread(issue) {
    return {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      author: issue.user?.login || "unknown",
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      url: issue.html_url,
      body: readableComment(issue.body),
      comments: issue.comments || 0,
    };
  }
  async create(annotation, title, comment) {
    const a = annotationCheck(annotation);
    const heading = String(title).trim();
    if (!heading || heading.length > 150)
      throw new Error("Give the thread a title of up to 150 characters.");
    const previous = await this.threads(a.source);
    const existing = previous.threads.find((t) => t.annotation.id === a.id);
    if (existing) return existing;
    const issue = await this.request(`/repos/${a.source.repository}/issues`, {
      method: "POST",
      body: {
        title: "[Artifact Threads] " + heading,
        body: issueBody(a, comment),
      },
    });
    try {
      await this.request(
        `/repos/${a.source.repository}/issues/${issue.number}`,
        {
          method: "PATCH",
          body: { body: issueBody(a, comment, issue.number) },
        },
      );
    } catch {
      /* The issue already exists; do not retry its creation if the backlink update fails. */
    }
    return { ...this.thread(issue), annotation: a };
  }
  async comments(source, number) {
    const s = sourceCheck(source);
    const result = [];
    for (let page = 1; page <= 10; page++) {
      const items = await this.request(
        `/repos/${s.repository}/issues/${number}/comments?per_page=100&page=${page}`,
      );
      for (const c of items)
        result.push({
          id: c.id,
          body: c.body || "",
          author: c.user?.login || "unknown",
          createdAt: c.created_at,
          url: c.html_url,
        });
      if (items.length < 100) return result;
    }
    throw new Error(
      "This thread has more than 1,000 replies. Open it on GitHub for the full conversation.",
    );
  }
  reply(source, number, body) {
    const s = sourceCheck(source);
    const text = String(body).trim();
    if (!text || text.length > 10000)
      throw new Error("Write a reply of up to 10,000 characters.");
    return this.request(`/repos/${s.repository}/issues/${number}/comments`, {
      method: "POST",
      body: { body: text },
    });
  }
  state(source, number, closed) {
    const s = sourceCheck(source);
    return this.request(`/repos/${s.repository}/issues/${number}`, {
      method: "PATCH",
      body: {
        state: closed ? "closed" : "open",
        state_reason: closed ? "completed" : "reopened",
      },
    });
  }
}
