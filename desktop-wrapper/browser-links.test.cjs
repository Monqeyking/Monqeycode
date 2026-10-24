const test=require('node:test'),assert=require('node:assert/strict');
const {installBrowserLinks}=require('./browser-links.cjs');
test('only the two browser extension store links open in the system browser',async()=>{
  let handler;const opened=[],errors=[];installBrowserLinks({webContents:{setWindowOpenHandler:value=>{handler=value;}}},async url=>{opened.push(url);},error=>errors.push(error));
  const chrome='https://chromewebstore.google.com/detail/hhcmgoofomhgciiibhipgmgkgnoenaoi';
  assert.equal(handler({url:chrome}).action,'deny');assert.equal(handler({url:chrome+'?untrusted=1'}).action,'allow');assert.equal(handler({url:'https://example.com'}).action,'allow');
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(opened,[chrome]);assert.equal(errors.length,0);
});
