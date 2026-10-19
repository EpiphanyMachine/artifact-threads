import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import https from "node:https";
import http from "node:http";
import net from "node:net";
const root = fileURLToPath(new URL("../", import.meta.url));
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
const close = (server) => new Promise((resolve) => server.close(resolve));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A portable report</title><style>body{font:18px/1.7 system-ui;padding:30px;max-width:700px}img{display:block;margin-top:30px}</style></head><body><h1>Portable report</h1><p id="r1">A requirement with stable surrounding context.</p><img id="chart" width="160" height="90" alt="Embedded comparison chart" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90'%3E%3Crect x='10' y='50' width='30' height='30' fill='%2317634e'/%3E%3Crect x='60' y='20' width='30' height='60' fill='%2317634e'/%3E%3C/svg%3E"><button id="counter">Count: 0</button><p>Repeating text</p><p>Repeating text</p><script>let count=0;document.querySelector('#counter').onclick=()=>document.querySelector('#counter').textContent='Count: '+(++count);</script></body></html>`;
test(
  "unpacked extension: OAuth fixture, isolated interactive artifact, node/text threads, replies, attribution, resolve and stale targets",
  { timeout: 120000 },
  async () => {
    const temp = await mkdtemp(join(tmpdir(), "artifact-threads-"));
    const key = join(temp, "key.pem"),
      cert = join(temp, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=api.github.com",
      ],
      { stdio: "ignore" },
    );
    const issues = [],
      comments = new Map(),
      requests = [];
    let changed = false,
      nextIssue = 1,
      denyWrites = false;
    const server = https.createServer(
      { key: await readFile(key), cert: await readFile(cert) },
      async (req, res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : null;
        requests.push({
          path: req.url,
          method: req.method,
          body,
          authorization: req.headers.authorization,
        });
        const respond = (value, status = 200) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(value));
        };
        if (req.headers.host === "raw.githubusercontent.com") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(html);
          return;
        }
        if (req.url === "/fixture-raw-link") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            '<a href="https://raw.githubusercontent.com/your-org/artifacts/refs/heads/gh/proposal/docs/report.html?token=do-not-store">Raw</a>',
          );
          return;
        }
        if (req.url === "/login/device/code")
          return respond({
            device_code: "fixture-device",
            user_code: "TEST-CODE",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 1,
          });
        if (req.url === "/login/oauth/access_token")
          return respond({
            access_token: "fixture-access-token",
            refresh_token: "fixture-refresh-token",
            expires_in: 28800,
          });
        if (req.url === "/login/device") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>Synthetic GitHub authorization</h1>");
          return;
        }
        if (req.url === "/user")
          return respond({ login: "alice", name: "Alice Reviewer" });
        if (!req.url.startsWith("/repos/your-org/artifacts/"))
          return respond({}, 404);
        if (req.url.includes("/assignees?"))
          return respond([{ login: "bob" }, { login: "alice" }]);
        if (req.url.includes("/commits/heads%2Fgh%2Fproposal"))
          return respond({ sha: changed ? "e".repeat(40) : "a".repeat(40) });
        if (req.url.endsWith("/commits/" + "a".repeat(40)))
          return respond({ sha: "a".repeat(40) });
        if (req.url.includes("/commits/")) return respond({}, 404);
        if (req.url.includes("/contents/docs/report.html")) {
          const contentChanged =
            changed && !req.url.includes("ref=" + "a".repeat(40));
          return respond({
            type: "file",
            size: html.length,
            sha: contentChanged ? "f".repeat(40) : "b".repeat(40),
            encoding: "base64",
            content: Buffer.from(
              contentChanged
                ? html.replace(
                    "A requirement with stable surrounding context.",
                    "The requirement was deliberately replaced.",
                  )
                : html,
            ).toString("base64"),
          });
        }
        if (denyWrites && req.method === "POST")
          return respond({ message: "Forbidden" }, 403);
        if (req.url.includes("/issues?")) return respond(issues);
        if (req.url.endsWith("/issues") && req.method === "POST") {
          const issue = {
            number: nextIssue++,
            title: body.title,
            body: body.body,
            state: "open",
            user: { login: "alice" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            comments: 0,
            html_url:
              "https://github.com/your-org/artifacts/issues/" + (nextIssue - 1),
          };
          issues.push(issue);
          return respond(issue, 201);
        }
        const match = req.url.match(/\/issues\/(\d+)(\/comments)?/);
        if (match) {
          const number = Number(match[1]),
            issue = issues.find((i) => i.number === number);
          if (!issue) return respond({}, 404);
          if (match[2]) {
            if (req.method === "POST") {
              const list = comments.get(number) || [];
              const comment = {
                id: list.length + 1,
                body: body.body,
                user: { login: "alice" },
                created_at: new Date().toISOString(),
                html_url: issue.html_url + "#issuecomment-" + (list.length + 1),
              };
              list.push(comment);
              comments.set(number, list);
              issue.comments = list.length;
              return respond(comment, 201);
            }
            return respond(comments.get(number) || []);
          }
          if (req.method === "PATCH") Object.assign(issue, body);
          return respond(issue);
        }
        return respond({}, 404);
      },
    );
    server.on("clientError", (_error, socket) => socket.destroy());
    server.on("connection", (socket) =>
      socket.on("error", (error) => {
        if (!["ECONNRESET", "EPIPE"].includes(error.code)) throw error;
      }),
    );
    server.on("secureConnection", (socket) =>
      socket.on("error", (error) => {
        if (!["ECONNRESET", "EPIPE"].includes(error.code)) throw error;
      }),
    );
    server.on("tlsClientError", () => {});
    const port = await listen(server);
    const sockets = new Set();
    const proxy = http.createServer((_req, res) => {
      res.writeHead(403);
      res.end();
    });
    proxy.on("clientError", (_error, socket) => socket.destroy());
    proxy.on("connection", (socket) =>
      socket.on("error", (error) => {
        if (!["ECONNRESET", "EPIPE"].includes(error.code)) throw error;
      }),
    );
    proxy.on("connect", (req, client, head) => {
      if (
        ![
          "api.github.com:443",
          "github.com:443",
          "raw.githubusercontent.com:443",
        ].includes(req.url)
      ) {
        client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      const upstream = net.connect(port, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      for (const socket of [client, upstream]) {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {
          client.destroy();
          upstream.destroy();
        });
      }
    });
    const proxyPort = await listen(proxy);
    let context;
    try {
      const extension = join(root, "extension");
      // A separate header-only renderer models HTML Artifact Viewer coexistence.
      const renderer = join(temp, "raw-renderer");
      await mkdir(renderer);
      await writeFile(
        join(renderer, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "Fixture Raw renderer",
          version: "1.0",
          permissions: ["declarativeNetRequestWithHostAccess"],
          host_permissions: ["https://raw.githubusercontent.com/*"],
          declarative_net_request: {
            rule_resources: [
              { id: "renderer", enabled: true, path: "rules.json" },
            ],
          },
        }),
      );
      await writeFile(
        join(renderer, "rules.json"),
        JSON.stringify([
          {
            id: 1,
            priority: 1,
            action: {
              type: "modifyHeaders",
              responseHeaders: [
                {
                  header: "content-type",
                  operation: "set",
                  value: "text/html; charset=utf-8",
                },
              ],
            },
            condition: {
              urlFilter: "||raw.githubusercontent.com/",
              resourceTypes: ["main_frame"],
            },
          },
        ]),
      );
      context = await chromium.launchPersistentContext(join(temp, "profile"), {
        channel: "chromium",
        headless: true,
        viewport: { width: 1440, height: 1000 },
        args: [
          `--disable-extensions-except=${extension},${renderer}`,
          `--load-extension=${extension},${renderer}`,
          `--proxy-server=http://127.0.0.1:${proxyPort}`,
          "--ignore-certificate-errors",
          "--disable-background-networking",
        ],
        ignoreHTTPSErrors: true,
      });
      const worker =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent("serviceworker"));
      const id = new URL(worker.url()).host;
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      // Upgrade an early installation whose saved settings have no client ID.
      await worker.evaluate(() =>
        chrome.storage.local.set({
          settings: { clientId: "", repositories: ["your-org/artifacts"] },
        }),
      );
      await page.goto(`chrome-extension://${id}/viewer.html`);
      assert.equal(
        await page.locator("#client-id").inputValue(),
        "Iv23lifyC4DeQ32gff3f",
      );
      assert.equal(
        await page.locator("#repositories").inputValue(),
        "your-org/artifacts",
      );
      await page
        .getByText("Advanced: use a different GitHub App", { exact: true })
        .click();
      await page.locator("#client-id").fill("Iv1.fixture");
      await page.locator("#repositories").fill("your-org/artifacts");
      await page
        .getByRole("button", { name: "Save settings", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Connect GitHub", exact: true })
        .click();
      await page
        .getByText("Connected as alice", { exact: true })
        .waitFor({ timeout: 10000 })
        .catch(async (error) => {
          throw new Error(
            error.message +
              " Notice: " +
              (await page.locator("#notice").textContent()) +
              "; Connection: " +
              (await page.locator("#connection").textContent()) +
              "; Requests: " +
              JSON.stringify(
                requests.map((r) => ({ path: r.path, method: r.method })),
              ),
          );
        });
      const tabCount = context.pages().length;
      await page.goto("https://github.com/fixture-raw-link");
      await page.getByRole("link", { name: "Raw", exact: true }).click();
      await page.waitForURL(
        (url) =>
          url.protocol === "chrome-extension:" &&
          url.pathname === "/viewer.html",
      );
      assert.equal(context.pages().length, tabCount);
      assert.equal(page.url().includes("do-not-store"), false);
      const frame = page.frameLocator("#artifact");
      await frame.getByRole("heading", { name: "Portable report" }).waitFor();
      assert.equal(await page.locator("#comments-drawer").isVisible(), false);
      assert.equal(
        await page
          .locator("#artifact")
          .evaluate((el) => el.getBoundingClientRect().width),
        1440,
      );
      await frame.getByRole("button", { name: "Count: 0" }).click();
      await frame.getByRole("button", { name: "Count: 1" }).waitFor();
      assert.equal(
        await frame
          .locator("#chart")
          .evaluate((img) => img.complete && img.naturalWidth > 0),
        true,
      );
      const isolation = await frame.locator("body").evaluate(() => ({
        runtime: typeof chrome === "undefined" || !chrome.runtime,
        storage: (() => {
          try {
            localStorage.getItem("x");
            return false;
          } catch {
            return true;
          }
        })(),
        token: document.documentElement.innerHTML.includes(
          "fixture-access-token",
        ),
      }));
      assert.deepEqual(isolation, {
        runtime: true,
        storage: true,
        token: false,
      });
      await page
        .getByRole("button", { name: "Comment mode", exact: true })
        .click();
      await frame.locator("#r1").evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await page
        .getByRole("heading", { name: "New conversation", exact: true })
        .waitFor();
      await page.locator("#thread-title").fill("Clarify the requirement");
      await page.locator("#thread-body").fill("@b");
      await page.getByRole("option", { name: "@bob", exact: true }).waitFor();
      await page.locator("#thread-body").press("Enter");
      assert.equal(await page.locator("#thread-body").inputValue(), "@bob ");
      await page
        .locator("#thread-body")
        .pressSequentially("please clarify this example.");
      await page
        .getByRole("button", { name: "Post thread", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Clarify the requirement", exact: true })
        .waitFor();
      assert.equal(issues.length, 1);
      assert.ok(issues[0].body.includes("@bob"));
      assert.ok(issues[0].body.includes("#artifact-thread=1"));
      await frame
        .getByRole("button", { name: "Open annotation thread 1", exact: true })
        .waitFor();
      assert.ok(
        (await frame.locator("#artifact-threads-overlay .annotation").count()) >
          0,
      );
      await page
        .getByRole("button", { name: "Close comments", exact: true })
        .click();
      assert.equal(await page.locator("#comments-drawer").isVisible(), false);
      await frame
        .getByRole("button", { name: "Open annotation thread 1", exact: true })
        .click();
      await page.locator("#comments-drawer").waitFor();
      await page.locator("#reply-body").fill("<img src=x onerror=alert(1)> @b");
      await page.getByRole("option", { name: "@bob", exact: true }).click();
      assert.equal(
        await page.locator("#reply-body").inputValue(),
        "<img src=x onerror=alert(1)> @bob ",
      );
      await page
        .locator("#reply-body")
        .pressSequentially("A plain-text reply.");
      assert.equal(
        requests.filter((r) => r.path.includes("/assignees?")).length,
        1,
      );
      await page
        .getByRole("button", { name: "Post reply", exact: true })
        .click();
      await page
        .getByText("<img src=x onerror=alert(1)> @bob A plain-text reply.", {
          exact: true,
        })
        .waitFor()
        .catch(async (error) => {
          throw new Error(
            error.message +
              " Notice: " +
              (await page.locator("#notice").textContent()) +
              "; Requests: " +
              JSON.stringify(
                requests
                  .slice(-8)
                  .map((r) => ({ path: r.path, method: r.method })),
              ) +
              "; Comments: " +
              JSON.stringify([...comments]),
          );
        });
      assert.equal(await page.locator("#comments img").count(), 0);
      await page
        .getByRole("button", { name: "Resolve thread", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Reopen thread", exact: true })
        .waitFor();
      assert.equal(issues[0].state, "closed");
      await page.locator("#show-closed").check();
      await frame
        .locator("#artifact-threads-overlay button.resolved")
        .waitFor();
      assert.ok(
        (await frame
          .locator("#artifact-threads-overlay .annotation.resolved")
          .count()) > 0,
      );
      await page.locator("#show-closed").uncheck();
      assert.equal(
        await frame
          .locator("#artifact-threads-overlay button.resolved")
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "Reopen thread", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Resolve thread", exact: true })
        .waitFor();
      assert.equal(issues[0].state, "open");
      await frame.locator("#chart").evaluate((element) => {
        getSelection().removeAllRanges();
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: rect.left + 20,
            clientY: rect.top + 30,
          }),
        );
      });
      await page
        .getByRole("heading", { name: "New conversation", exact: true })
        .waitFor();
      await page.locator("#thread-title").fill("Image annotation");
      await page.locator("#thread-body").fill("Discuss this chart.");
      await page
        .getByRole("button", { name: "Post thread", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Image annotation", exact: true })
        .waitFor();
      assert.equal(issues.length, 2);
      const writes = requests.filter(
        (r) => r.method === "POST" && r.path.includes("/issues"),
      ).length;
      await frame.locator("body").evaluate(() =>
        parent.postMessage(
          {
            type: "thread.create",
            source: { repository: "evil/repo" },
            body: "forged",
          },
          "*",
        ),
      );
      await page.waitForTimeout(100);
      assert.equal(
        requests.filter(
          (r) => r.method === "POST" && r.path.includes("/issues"),
        ).length,
        writes,
      );
      changed = true;
      await page.goto("https://github.com/fixture-raw-link");
      await page.getByRole("link", { name: "Raw", exact: true }).click();
      await page.waitForURL((url) => url.protocol === "chrome-extension:");
      await frame
        .getByText("The requirement was deliberately replaced.", {
          exact: true,
        })
        .waitFor();
      await page
        .getByText("Target changed or missing — inspect original", {
          exact: true,
        })
        .waitFor();
      await page
        .locator("#threads .thread")
        .filter({ hasText: "Clarify the requirement" })
        .click();
      assert.equal(
        await page.locator("#conversation-target").textContent(),
        "A requirement with stable surrounding context.",
      );
      const [originalPage] = await Promise.all([
        context.waitForEvent("page"),
        page
          .getByRole("link", { name: "Reviewed version ↗", exact: true })
          .click(),
      ]);
      await originalPage
        .frameLocator("#artifact")
        .getByText("A requirement with stable surrounding context.", {
          exact: true,
        })
        .waitFor();
      await originalPage
        .getByRole("heading", { name: "Clarify the requirement", exact: true })
        .waitFor();
      await originalPage.close();
      await page.screenshot({ path: join(temp, "workspace.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({ path: join(temp, "mobile.png") });
      const storage = await worker.evaluate(() => chrome.storage.local.get());
      assert.equal(JSON.stringify(storage).includes("do-not-store"), false);
      assert.equal(
        JSON.stringify(storage).includes("raw.githubusercontent.com"),
        false,
      );
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await page.getByText("Not connected", { exact: true }).waitFor();
      // Allowed Raw links still activate when signed out, exposing setup.
      await page.goto("https://github.com/fixture-raw-link");
      await page.getByRole("link", { name: "Raw", exact: true }).click();
      await page.waitForURL((url) => url.protocol === "chrome-extension:");
      await page
        .getByRole("button", { name: "Connect GitHub", exact: true })
        .waitFor();
      // Repositories outside the allowlist keep rendering on their Raw URL.
      await page.goto(
        "https://raw.githubusercontent.com/other/repo/main/report.html",
      );
      await page.getByRole("heading", { name: "Portable report" }).waitFor();
      assert.ok(
        page.url().startsWith("https://raw.githubusercontent.com/other/repo/"),
      );
      await page.goto(
        "https://raw.githubusercontent.com/your-org/artifacts/main/data.json",
      );
      assert.ok(page.url().endsWith("data.json"));
      assert.equal(
        (await worker.evaluate(() => chrome.storage.local.get("auth"))).auth,
        undefined,
      );
      assert.deepEqual(errors, []);
      console.log(
        "Verified real unpacked Chromium extension with synthetic GitHub/OAuth only.",
      );
      if (process.env.ARTIFACT_THREADS_QA_DIR) {
        const { mkdir, copyFile } = await import("node:fs/promises");
        await mkdir(process.env.ARTIFACT_THREADS_QA_DIR, { recursive: true });
        await copyFile(
          join(temp, "workspace.png"),
          join(process.env.ARTIFACT_THREADS_QA_DIR, "workspace.png"),
        );
        await copyFile(
          join(temp, "mobile.png"),
          join(process.env.ARTIFACT_THREADS_QA_DIR, "mobile.png"),
        );
      }
    } finally {
      if (context) await context.close();
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      proxy.closeAllConnections();
      await Promise.all([close(server), close(proxy)]);
      await rm(temp, { recursive: true, force: true });
    }
  },
);
