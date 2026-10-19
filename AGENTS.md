# Artifact Threads

A personally developed, general-purpose Chromium extension. No company-specific code, examples, ticket metadata, or dependencies. Keep it independent from HTML Artifact Viewer.

Use Node 22. Run npm test, npm run check, and npm run test:browser for changes to annotation, messaging, authorization, or rendering. Use synthetic fixtures for GitHub writes; never create test issues in a real repository without the user's explicit instruction. Do not merge pull requests, publish a store listing, change repository visibility, or register/install an OAuth or GitHub App without the user's instruction.

GitHub is the only remote service. Do not embed secrets or credentials in artifacts, messages to sandboxed pages, source files, URLs, or logs. GitHub App client IDs are public configuration; private keys and client secrets do not belong in this extension. User tokens stay in trusted extension storage and go only to GitHub. All GitHub writes require explicit actions in the trusted review UI. Artifact messages can propose a selection or select a displayed pin; they cannot trigger writes.

A thread is one GitHub issue. Preserve author identity, @mentions, exact source versions, and annotation context. Reanchor only with sufficient evidence; show ambiguous and missing targets rather than silently placing comments elsewhere. Render GitHub/user text using textContent. Keep README and PRIVACY accurate about permissions, storage, polling, and limitations. Do not claim live GitHub authorization, write behavior, or individual browser compatibility was tested when only fixtures were used.
