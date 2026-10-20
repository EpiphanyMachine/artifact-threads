import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as core from "../extension/core.js";
import { GitHub } from "../extension/github.js";
const source = (await readFile(new URL("../extension/worker.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from "[^\"]+";\n/gm, "");
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function harness(fetcher) {
  const local = { auth: { access_token: "synthetic-old", refresh_token: "synthetic-refresh", expires_at: 1 } };
  const session = {};
  const storage = (data) => ({
    setAccessLevel: async () => {},
    get: async (key) => structuredClone({ [key]: data[key] }),
    set: async (value) => Object.assign(data, structuredClone(value)),
    remove: async (keys) => { for (const key of [].concat(keys)) delete data[key]; },
  });
  const event = { addListener() {} };
  const context = vm.createContext({
    ...core, GitHub: class extends GitHub { constructor(token) { super(token, fetcher); } },
    GITHUB_APP_CLIENT_ID: "Iv1.synthetic", fetch: fetcher, URL, Date, console,
    chrome: { storage: { local: storage(local), session: storage(session) },
      runtime: { onInstalled: event, onStartup: event, onMessage: event },
      webNavigation: { onBeforeNavigate: event, onCommitted: event } },
  });
  vm.runInContext(source, context);
  return { local, session, run: (code) => vm.runInContext(code, context) };
}
const response = (body) => ({ ok: true, status: 200, json: async () => body });
const token = { access_token: "synthetic-new", refresh_token: "synthetic-next", expires_in: 3600 };
for (const change of [
  'handle({type:"auth.disconnect"})',
  'handle({type:"settings.save", settings:{clientId:"Iv1.changed",repositories:[]}})',
]) {
  test("pending refresh cannot restore credentials after " + change, async () => {
    const started = deferred(), result = deferred();
    const h = harness(() => { started.resolve(); return result.promise; });
    const pending = h.run("auth()");
    const rejected = assert.rejects(pending, /connection changed/);
    await started.promise;
    await h.run(change);
    result.resolve(response(token));
    await rejected;
    assert.equal(h.local.auth, undefined);
    assert.equal(h.local.user, undefined);
  });
}
test("simultaneous expired-token requests share one refresh", async () => {
  const started = deferred(), result = deferred();
  let calls = 0;
  const h = harness(() => { calls++; started.resolve(); return result.promise; });
  const pending = [h.run("auth()"), h.run("auth()"), h.run("auth()")];
  await started.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  result.resolve(response(token));
  assert.deepEqual(await Promise.all(pending), Array(3).fill(token.access_token));
  assert.equal(h.local.auth.refresh_token, token.refresh_token);
});
for (const stage of ["oauth", "profile"]) {
  test("disconnect during device authorization " + stage + " cannot restore credentials", async () => {
    const started = deferred(), result = deferred();
    const h = harness(async (url) => {
      const atProfile = url.endsWith("/user");
      if ((stage === "profile") === atProfile) {
        started.resolve();
        return result.promise;
      }
      return response(token);
    });
    h.session.pending = { device_code: "synthetic-device", expires: Date.now() + 60000, next: 0, interval: 5 };
    const pending = h.run('handle({type:"auth.poll"})');
    const rejected = assert.rejects(pending, /connection changed/);
    await started.promise;
    await h.run('handle({type:"auth.disconnect"})');
    result.resolve(response(stage === "profile" ? { login: "alice" } : token));
    await rejected;
    assert.equal(h.local.auth, undefined);
    assert.equal(h.local.user, undefined);
    assert.equal(h.session.pending, undefined);
  });
}
test("disconnect cancels device-code request before it creates pending state", async () => {
  const started = deferred(), result = deferred();
  const h = harness(() => { started.resolve(); return result.promise; });
  const pending = h.run('handle({type:"auth.start"})');
  const rejected = assert.rejects(pending, /connection changed/);
  await started.promise;
  await h.run('handle({type:"auth.disconnect"})');
  result.resolve(response({ device_code: "synthetic-device", expires_in: 600 }));
  await rejected;
  assert.equal(h.session.pending, undefined);
});
test("a late failure cannot clear a newer connection", async () => {
  const started = deferred(), result = deferred();
  const h = harness(() => { started.resolve(); return result.promise; });
  const pending = h.run("auth()");
  const rejected = assert.rejects(pending, /connection changed/);
  await started.promise;
  await h.run('handle({type:"auth.disconnect"})');
  h.local.auth = { access_token: "synthetic-other-session" };
  result.resolve(response({ error: "bad_refresh_token" }));
  await rejected;
  assert.equal(h.local.auth.access_token, "synthetic-other-session");
});
