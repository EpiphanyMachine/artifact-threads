# Privacy and access

Artifact Threads has no backend, database, analytics, advertising, or telemetry. Its only remote service is GitHub.

## What stays local

The browser extension fetches the selected HTML from GitHub's Contents API, pins it to an exact commit, and renders it locally in a sandbox. The full artifact is not uploaded to a preview service or copied into issues. Repository settings and the GitHub connection remain in the browser profile.

The extension stores the public client ID, allowed repository names, the connected user's display name/login, and access/refresh tokens in `chrome.storage.local`, restricted to trusted extension contexts. They are not synced. This is browser-profile storage, not an independently encrypted credential vault; software with access to the profile may be able to inspect it.

Artifact bodies, unposted comments, and selection drafts are held only in the open workspace. They are not saved as a browsing-history database. Raw-file query parameters, including temporary GitHub raw tokens, are discarded when opening a review and are never used as API credentials.

## What goes to GitHub

- Device authorization and token refresh requests, and your authorized API requests.
- File, commit, issue, and comment reads needed for the artifact you open.
- When you explicitly post: the title, comment, selected quote or node description, target/anchor metadata, and immutable source identity. The selected context becomes part of the GitHub issue and is visible to people who can access it.
- When you explicitly reply or resolve/reopen: that comment or state change.

GitHub's own storage, access control, request handling, notifications, and retention apply. A reviewer cannot gain repository access through the extension beyond the intersection of their GitHub access and the app's installation/permissions.

There is no automatic posting, agent execution, screenshot upload, external link preview, or third-party mention service. Typed @mentions are submitted to GitHub as part of the comment and can notify people under GitHub's rules.

## Why browser permissions are requested

- **storage:** local configuration and the GitHub connection.
- **activeTab:** read the current file URL when you click the toolbar action. The extension does not scan your tabs in the background.
- **api.github.com:** read selected files, commits, issues, and comments; submit explicitly requested issue/comment/state changes.
- **github.com:** GitHub device authorization and token refresh.

There are no content scripts, cookie-reading permission, arbitrary-host permission, externally callable message handlers, or runtime dependencies.

## Artifact isolation

The artifact runs in an opaque-origin sandbox without extension APIs or access to the trusted sidebar's credentials. It supports inline JavaScript/CSS, embedded data/blob assets, and user-initiated downloads. External resources, fetch/XHR, frames, form submissions, normal storage, and top navigation are blocked by the sandbox and policy.

The annotation runtime reads DOM selections and node evidence inside that sandbox and sends bounded target metadata to the trusted sidebar. Messages from the artifact cannot create issues or invoke GitHub API writes. Only explicit controls in the extension workspace do that.

The artifact itself can manipulate its own DOM and try to mislead a reviewer. This is intended for trusted, self-contained documents, not malware analysis. A DOM selector or fingerprint is annotation evidence, not a security identity.

## Disconnect and removal

Disconnect removes stored access/refresh tokens and cached user information. It does not delete issues, replies, or already posted context, and does not itself revoke the GitHub authorization. Revoke that grant in GitHub to invalidate it. Removing the extension removes its local storage; GitHub feedback remains in the repository.
