const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { MobileAccount } = require('./mobile-account.cjs');
const config = require('./mobile-account-config.json');

test('Desktop sign-in binds PKCE to a one-time loopback callback and encrypts saved tokens', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monqey-auth-test-'));
  const filePath = path.join(directory, 'account');
  let opened;
  let exchanges = 0;
  const options = { filePath, protect: value => Buffer.from(value).toString('base64'), unprotect: value => Buffer.from(value, 'base64').toString(), openExternal: async value => { opened = new URL(value); }, fetch: async (url, init) => {
    if (url.endsWith('/user')) return Response.json({ id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.test' });
    if (url.endsWith('/logout?scope=local')) return new Response(null, { status: 204 });
    const body = JSON.parse(init.body);
    if (url.endsWith('grant_type=pkce')) {
      exchanges++;
      assert.equal(body.auth_code, 'one-time-code');
      assert.equal(crypto.createHash('sha256').update(body.code_verifier).digest('base64url'), opened.searchParams.get('code_challenge'));
    } else assert.equal(body.refresh_token, 'private-refresh');
    return Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600 });
  } };
  const account = new MobileAccount(options);
  t.after(() => { account.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await assert.rejects(account.token(), /Sign in/);
  await account.signIn('google');
  assert.equal(opened.origin, config.url);
  assert.equal(opened.searchParams.get('provider'), 'google');
  const callback = new URL(opened.searchParams.get('redirect_to'));
  const forged = new URL(callback); forged.searchParams.set('flow', 'wrong'); forged.searchParams.set('code', 'one-time-code');
  assert.equal((await fetch(forged)).status, 400);
  assert.equal(exchanges, 0);
  callback.searchParams.set('code', 'one-time-code');
  assert.equal((await fetch(callback)).status, 200);
  assert.equal(exchanges, 1);
  assert.equal(account.snapshot().user.email, 'fixture@example.test');
  assert.ok(!JSON.stringify(account.snapshot()).includes('private-'));
  assert.ok(!fs.readFileSync(filePath, 'utf8').includes('private-'));
  account.session.expires_at = 0;
  assert.deepEqual(await Promise.all([account.token(), account.token()]), ['private-access', 'private-access']);
  await account.signOut();
  assert.equal(account.snapshot().user, null);
});
