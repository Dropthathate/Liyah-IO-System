import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/lead.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('accepts tool-selection requests and forwards the selected plan to the lead system', async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ success: true }) };
  };

  try {
    const res = createResponse();
    await handler({
      method: 'POST',
      body: {
        fname: 'Taylor',
        email: 'taylor@example.com',
        package: 'Growth — suggested',
        source: 'aaliyah-tool-selection',
        notes: 'Priority: reduce admin\nSelected tools: Intake + reminders'
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true });
    assert.equal(forwarded.source, 'aaliyah-tool-selection');
    assert.equal(forwarded.email, 'taylor@example.com');
    assert.equal(forwarded.package, 'Growth — suggested');
    assert.match(forwarded.notes, /Intake \+ reminders/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('accepts landing-studio sample requests and forwards the mockup brief', async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ success: true }) };
  };
  try {
    const res = createResponse();
    await handler({
      method: 'POST',
      body: {
        fname: 'Morgan',
        email: 'morgan@example.com',
        package: 'Free landing-page sample request',
        source: 'aaliyah-landing-studio',
        notes: 'Color direction: Sage + linen\nFont: editorial\nExample URL: https://example.org'
      }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true });
    assert.equal(forwarded.source, 'aaliyah-landing-studio');
    assert.equal(forwarded.email, 'morgan@example.com');
    assert.match(forwarded.notes, /Sage \+ linen/);
    assert.match(forwarded.notes, /https:\/\/example\.org/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects unknown lead sources without contacting the external lead system', async () => {
  const originalFetch = globalThis.fetch;
  let contacted = false;
  globalThis.fetch = async () => { contacted = true; throw new Error('should not call'); };

  try {
    const res = createResponse();
    await handler({
      method: 'POST',
      body: { fname: 'Taylor', email: 'taylor@example.com', source: 'unknown-source' }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(contacted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
