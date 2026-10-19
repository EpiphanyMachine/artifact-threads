# GitHub App setup

Artifact Threads uses GitHub App user access tokens obtained with device flow. Each reviewer authorizes their own account, so their GitHub identity is attached to the issues and replies they submit.

## Register once, as the app owner

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**. Register under your personal account or organization. Choose an available name, such as `Artifact Threads — your-name`.
2. Use this repository as the homepage. This extension has no OAuth callback server: leave the callback URL empty where GitHub allows it, and leave **Request user authorization (OAuth) during installation** off. The extension starts device authorization itself.
3. Enable **Device Flow**. Keep expiring user tokens enabled; the extension can refresh device-flow tokens without a client secret.
4. Disable the **Active** webhook checkbox. No webhook URL or server is needed.
5. Set repository permissions:
   - **Issues: Read and write** — threads, replies, close/reopen.
   - **Contents: Read-only** — fetch HTML and pin a source version.
   - **Metadata: Read-only** — supplied automatically by GitHub.
6. Leave all organization and account permissions unset. In particular, no notifications, email, member-directory, administration, or contents-write permission is needed. Ordinary typed @mentions do not require us to read your notifications.
7. To let other organizations install it, allow installation on **Any account**. The app registration's installability is independent from whether this source repository is private. Keep it restricted to your own account if you only need personal repositories initially.
8. Create the app and copy its **Client ID** (not its numeric App ID). This is public configuration. The extension never needs a client secret, private key, or downloaded `.pem` file.

## Install on selected repositories

From the app's **Install App** page, choose the owning account or organization and **Only select repositories**. Select only the repositories containing artifacts to review. An organization owner may need to approve the installation.

The extension's local allowlist further limits which repositories it will load. App access plus user access still govern every GitHub operation.

## Connect each reviewer

1. Open the extension workspace → Settings.
2. Enter the app's public client ID, add allowed `owner/repository` names, and save.
3. Click **Connect GitHub**. The workspace shows a short code and opens GitHub's verification page.
4. Enter that code and authorize the app in GitHub. Keep the workspace open until it confirms the connected username.
5. Open an artifact and submit a test thread deliberately. Confirm that GitHub attributes it to the reviewer, and that a second authorized user can read and reply.

For a packaged distribution, set `GITHUB_APP_CLIENT_ID` in `extension/app-config.js` before building the ZIP. Colleagues then receive the public client ID preconfigured and do not type it. The first development build leaves it editable to support your own registration without distributing a secret.

## Troubleshooting

- **Device flow disabled:** enable it in the GitHub App registration, then connect again.
- **Repository/file not found:** check the installation's selected repositories, the reviewer's own access, the allowlist, and the file/ref in the URL.
- **403 on a write:** check Issues read/write, the reviewer's permission to participate, organization policy, issue availability, and GitHub rate limits.
- **SAML organizations:** follow GitHub's SSO requirements and authorize with an active organization session if necessary.
- **Disconnect:** removes this extension's stored tokens. Revoke authorization in GitHub's application settings as well if you want to invalidate the grant itself.

No registration or installation is performed by the build or test scripts.
