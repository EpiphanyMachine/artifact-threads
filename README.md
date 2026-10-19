# Artifact Threads

### Conversations belong next to the work.

Select a passage. Pin a comment to an image. Discuss a diagram. Artifact Threads gives self-contained HTML files shared conversations backed by GitHub issues.

**One pinned thread. One GitHub issue. Your own GitHub identity.**

Built with Codex. Independently developed by Greg Hilkert; MIT licensed.

## What it does

- Open a GitHub `blob` or `raw.githubusercontent.com` HTML link, including private files you are authorized to read.
- Review an immutable commit version in an isolated frame. Inline scripts and embedded assets work; external resources and network calls inside the artifact are blocked.
- Click **Add comment**, select text or click a node/image, and post a thread from the trusted sidebar.
- Read authors, timestamps, and replies; use `@username` or `@organization/team` in your comments. GitHub handles notifications according to its access and notification settings. Type `@` in a new comment or reply to suggest repository issue assignees; use arrow keys and Enter/Tab, or click a username. Suggestions use existing Issues access, cover up to 1,000 assignees, and are not a complete directory of everyone you can mention. Team mentions can be typed manually.
- Resolve/reopen threads by closing/reopening their GitHub issues. Each issue has independent participants and subscriptions.
- Show pins when targets can be matched. Missing or ambiguous targets remain in the sidebar, with a link to the original reviewed version. Earlier-version matches are labelled.

No database, application server, analytics, or third-party preview service. The extension talks directly to GitHub. It is separate from HTML Artifact Viewer and does not depend on that extension.

## Install and try it

1. Clone this repo into `~/code/artifact-threads`, or extract the extension ZIP.
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, and choose **Load unpacked** → `extension/`.
3. [Install Artifact Threads](https://github.com/apps/artifact-threads/installations/new) on the repositories you want to review. An organization owner may need to approve installation. The public client ID is already configured. See [GitHub App setup](docs/github-app-setup.md) for details. The app needs **Issues: read/write**, **Contents: read-only**, and automatic **Metadata: read-only** on selected repositories; it needs no code-write access, notifications permission, client secret, or private key.
4. Each reviewer clicks **Connect GitHub**, enters the displayed code on GitHub, and approves the connection using their own account. The app must also be installed on the relevant repositories. Organization installation does not replace personal authorization.
5. Add allowed repositories such as `your-org/artifacts`, one per line, and save.
6. Click **Raw** on a GitHub HTML file in an allowed repository. Artifact Threads automatically opens the review in the same tab, loads the artifact and comments, and shows a floating toolbar. No extension-button click is needed. You can still open a file manually from the extension popup.
7. Click **Add comment**, select a passage or click an image/node, and post. Click it again to restore the artifact’s controls, or use **Hide all comments** for a clean reading view.

Raw links using `refs/heads/<branch>` or `refs/tags/<tag>` are supported, including URLs with temporary `?token=…` parameters. Automatic activation applies only to top-level Raw HTML links in the local allowlist. Other repositories, file types, and embedded frames are left alone. Raw query tokens are stripped; you still connect GitHub and allow the repository.

This build uses the registered [Artifact Threads GitHub App](https://github.com/apps/artifact-threads). Colleagues do not need to register an app or enter a client ID. Advanced settings support a different app for independent deployments; no hosted service is necessary.

After code changes, reload the extension and reopen the Raw link. This update adds Raw-host access and the webNavigation permission; your browser may ask you to approve those permissions. Keep the installation folder in place.

## Review on the artifact

The artifact fills the viewport. A compact vertical toolbar on the right has **Add comment**, **Show comments** with the open-thread count, and **Hide all comments**. Settings are available from the extension popup. Open threads show text highlights or element borders and numbered pins. Hover a pin for the thread title and status; click it to open its discussion. The comments drawer opens automatically when an artifact has open threads, and can be closed without hiding its markers. **Hide all comments** hides the drawer, pins, highlights, and selection overlays and exits comment mode; **Show comments** restores the discussions without enabling new-comment selection. **Add comment** restores markers and enables selection. Unposted drafts are retained when hiding comments.

The drawer includes resolved threads when **Include resolved** is checked. Resolved markers are subdued, and **Reviewed version** opens the original commit in the same review interface in a new tab. Thread status is independent from target matching: missing or ambiguous targets stay in the drawer with their saved quote/node description and original version link. Escape exits Comment mode, then closes the drawer.

HTML Artifact Viewer can stay installed: its Raw response-header rules do not target the extension review URL, so no cross-extension messaging or redirect handshake is needed. Artifact Threads also works without it. The review fetches its own immutable copy through the GitHub API; it does not preserve interactive state from a previously rendered Raw page.

## How feedback survives the file

Each issue contains a readable comment, quoted target, reviewed-version link, and machine-readable annotation metadata in an HTML comment. It identifies the repository, path, commit and blob hashes, target type, selector/element ID, and text quote/context or node fingerprint and relative point.

Replies are ordinary issue comments. GitHub is the durable store: agents can retrieve these issues with existing GitHub tooling and propose artifact edits in a PR. This extension does not run an agent, interpret comments as authorization, or automatically change the repository.

The workspace fetches threads on load and when you click **Refresh**. It does not run a background notification service or require webhooks. Normal GitHub notifications link to the issue; the issue links to the reviewed artifact. Open that file through the extension to return to the pinned thread.

## Current boundaries

- **GitHub only**, on desktop Chromium 120+. Chromium is covered by the unpacked-extension test. Chrome, Edge, Brave, and Arc are expected targets but require individual live checks. Firefox and Safari are not supported yet.
- Self-contained `.html` and `.htm`, up to **5 MiB**. Embedded assets are supported; multi-file applications and remote fonts/scripts/images are not. External navigation from the artifact frame is restricted; use the trusted sidebar links to open GitHub.
- Comments on ordinary DOM text, images, SVG nodes, and elements. Canvas is treated as one element; its internal objects are not separate DOM nodes. Shadow-DOM contents are not traversed in this first version.
- Comment mode intercepts artifact clicks. Interactive state is not automatically replayed when reopening a thread; a target hidden by the artifact's UI may need to be revealed first.
- Text anchoring uses exact quotes with surrounding context and element selectors. Node anchoring uses element evidence and fingerprints. These are conservative heuristics, not a guarantee across arbitrary rewrites or duplicate images.
- The repository issue listing is paginated up to 1,000 issues; the workspace warns if more exist. A later version can add indexed discovery. No label is required to recognize threads.
- Draft text stays in the current workspace only. It is not an offline outbox and is lost if the page/browser is closed. Posts, replies, and refresh require GitHub access.
- User tokens are stored locally so reviewers do not reconnect every launch. They are not synced or sent to artifacts. See [PRIVACY.md](PRIVACY.md).

## Development

```sh
nvm use
npm ci
npm test
npm run check
npx playwright install chromium
npm run test:browser
npm run package
```

The browser test loads the actual unpacked extension in an isolated Chromium profile. A local HTTPS fixture stands in for GitHub's API and device authorization endpoints. It covers automatic Raw-link activation with a separate fixture renderer installed, same-tab navigation, signed-out setup, allowlist exclusions, selection highlights, image pins, posts/replies, resolve/reopen, stale targets, metadata, and the sandbox boundary without contacting GitHub or posting real issues.

**Live GitHub App installation and authorization have not been tested by the fixture suite.** That remains the next live-use check.

`npm run package` creates an extension-only ZIP in `dist/`. There are no runtime third-party dependencies.

## Browser and GitHub references

- [GitHub App device flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub issue API](https://docs.github.com/en/rest/issues/issues)
- [GitHub issue comments](https://docs.github.com/en/rest/issues/comments)
- [Chrome sandbox pages](https://developer.chrome.com/docs/extensions/how-to/security/sandboxing-eval)
- [Chrome extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Web Annotation selectors](https://www.w3.org/TR/annotation-model/#selectors)
