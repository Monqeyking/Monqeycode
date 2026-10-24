const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const config = require('./mobile-account-config.json');

class MobileAccount {
  constructor({ filePath, protect, unprotect, openExternal, changed = () => {}, fetch: request = fetch }) {
    Object.assign(this, { filePath, protect, unprotect, openExternal, changed, request });
    if (fs.existsSync(filePath)) this.session = JSON.parse(unprotect(fs.readFileSync(filePath, 'utf8')));
  }
  snapshot() { return { user: this.session?.user ? { id: this.session.user.id, email: this.session.user.email } : null, signingIn: Boolean(this.pending), error: this.error || null }; }
  save(session) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = this.filePath + '.tmp';
    fs.writeFileSync(temp, this.protect(JSON.stringify(session)), { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
    this.session = session;
    this.changed();
  }
  async api(route, body, token) {
    const response = await this.request(config.url + '/auth/v1/' + route, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { apikey: config.publishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw Error('Account verification failed. Sign in again.');
    return response.status === 204 ? null : response.json();
  }
  async accept(data, active = () => true) {
    if (!data?.access_token || !data?.refresh_token || !Number.isFinite(data.expires_in)) throw Error('Invalid account session.');
    const user = await this.api('user', null, data.access_token);
    if (!user?.id || !user.email || !active()) throw Error('A verified account with an email address is required.');
    this.save({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000, user: { id: user.id, email: user.email } });
    this.error = null;
    this.changed();
    return data.access_token;
  }
  token() {
    if (!this.session) return Promise.reject(Error('Sign in with Google or GitHub before enabling Mobile Access.'));
    if (this.session.expires_at > Date.now() + 60000) return Promise.resolve(this.session.access_token);
    return this.refreshing ??= this.api('token?grant_type=refresh_token', { refresh_token: this.session.refresh_token })
      .then(data => this.accept(data)).catch(error => { this.error = error.message; this.changed(); throw error; }).finally(() => { this.refreshing = null; });
  }
  async signIn(provider) {
    if (!['google', 'github'].includes(provider)) throw Error('Unsupported sign-in provider.');
    if (this.pending) throw Error('Finish or cancel the current sign-in first.');
    if (this.session) throw Error('Sign out before changing accounts.');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const flow = crypto.randomBytes(32).toString('base64url');
    const callback = new URL(config.desktopCallback);
    callback.searchParams.set('flow', flow);
    const pending = { verifier, flow, server: null, timer: null, exchanging: false };
    this.pending = pending; this.error = null;
    try {
      pending.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, config.desktopCallback);
        const valid = req.method === 'GET' && url.pathname === '/auth/callback' && url.searchParams.getAll('flow').length === 1 && url.searchParams.get('flow') === flow && this.pending === pending && !pending.exchanging;
        if (!valid) { res.writeHead(400); res.end('Invalid sign-in callback.'); return; }
        pending.exchanging = true;
        let ok = false;
        try {
          if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1) throw Error('Sign-in was cancelled or refused.');
          await this.accept(await this.api('token?grant_type=pkce', { auth_code: url.searchParams.get('code'), code_verifier: verifier }), () => this.pending === pending);
          ok = true;
        } catch { this.error = 'Sign-in could not be completed. Please try again.'; }
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        res.end(ok ? 'Signed in to Monqey Agent. You can close this window and return to the app.' : 'Sign-in failed. Return to Monqey Agent and try again.');
        this.cancel();
      });
      await new Promise((resolve, reject) => { pending.server.once('error', reject); pending.server.listen(Number(callback.port), '127.0.0.1', resolve); });
      pending.server.on('error', () => { this.error = 'The sign-in callback could not be opened.'; this.cancel(); });
      pending.timer = setTimeout(() => { this.error = 'Sign-in expired. Please try again.'; this.cancel(); }, 5 * 60000);
      pending.timer.unref();
      const url = new URL(config.url + '/auth/v1/authorize');
      url.search = new URLSearchParams({ provider, redirect_to: callback.href, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 's256' }).toString();
      await this.openExternal(url.href);
      this.changed();
    } catch { this.error = 'The sign-in window could not be opened. Check that another Monqey sign-in is not already running.'; this.cancel(); throw Error(this.error); }
    return this.snapshot();
  }
  cancel() {
    const pending = this.pending; this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.server?.close(); pending.server?.closeIdleConnections(); pending.verifier = ''; }
    this.changed();
  }
  async signOut() {
    this.cancel();
    if (!this.session) return;
    // Keep the encrypted session until revocation succeeds so signing out can be retried.
    await this.api('logout?scope=local', {}, await this.token());
    this.save(null);
  }
  close() { this.cancel(); }
}
module.exports = { MobileAccount };
