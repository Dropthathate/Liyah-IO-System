import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/ellis-didit-session.js';

const WORKFLOW = '66666666-7777-8888-9999-000000000000';
const BOOKING = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SESSION = 'cccccccc-dddd-4eee-8fff-000000000000';
const CALLER_TOKEN = 'ellis-test-caller-token-with-at-least-thirty-two-bytes';
const ENV_NAMES = [
  'DIDIT_API_KEY', 'DIDIT_ELLIS_WORKFLOW_ID', 'ELLIS_DIDIT_REQUEST_TOKEN',
  'DIDIT_ELLIS_ENVIRONMENT', 'DIDIT_ELLIS_CALLBACK_URL', 'DIDIT_ELLIS_CUSTOM_DOMAIN',
];

function fakeResponse() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

function request() {
  return {
    method: 'POST',
    headers: {
      authorization: `Bearer ${CALLER_TOKEN}`,
      'content-type': 'application/json',
    },
    body: { bookingReference: BOOKING },
  };
}

function setEnvironment(t, values) {
  const previousEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  t.after(() => {
    ENV_NAMES.forEach((name) => {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    });
    globalThis.fetch = previousFetch;
  });
  ENV_NAMES.forEach((name) => delete process.env[name]);
  Object.assign(process.env, values);
}

function validDiditSession(overrides = {}) {
  return {
    session_id: SESSION,
    url: 'https://verify.didit.me/en/session/opaque-test-token',
    workflow_id: WORKFLOW,
    vendor_data: `ellis-restorative-therapies:${BOOKING}`,
    session_token: 'must-not-be-returned',
    ...overrides,
  };
}

test('requires an explicit sandbox/live assertion before calling Didit', async (t) => {
  setEnvironment(t, {
    DIDIT_API_KEY: 'test-api-key',
    DIDIT_ELLIS_WORKFLOW_ID: WORKFLOW,
    ELLIS_DIDIT_REQUEST_TOKEN: CALLER_TOKEN,
  });
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error('unexpected provider call'); };

  const res = fakeResponse();
  await handler(request(), res);

  assert.equal(res.statusCode, 503);
  assert.equal(providerCalls, 0);
});

test('returns only the hosted URL and session id after Didit echoes workflow and opaque reference', async (t) => {
  setEnvironment(t, {
    DIDIT_API_KEY: 'test-api-key',
    DIDIT_ELLIS_WORKFLOW_ID: WORKFLOW,
    ELLIS_DIDIT_REQUEST_TOKEN: CALLER_TOKEN,
    DIDIT_ELLIS_ENVIRONMENT: 'sandbox',
    DIDIT_ELLIS_CALLBACK_URL: 'https://leah.somasyncai.com/verification-return.html',
  });
  let providerRequest;
  globalThis.fetch = async (url, options) => {
    providerRequest = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify(validDiditSession()), { status: 201 });
  };

  const res = fakeResponse();
  await handler(request(), res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.payload, {
    sessionId: SESSION,
    verificationUrl: 'https://verify.didit.me/en/session/opaque-test-token',
  });
  assert.equal(providerRequest.body.workflow_id, WORKFLOW);
  assert.equal(providerRequest.body.vendor_data, `ellis-restorative-therapies:${BOOKING}`);
  assert.deepEqual(providerRequest.body.metadata, { practice: 'ellis-restorative-therapies' });
  assert.equal(providerRequest.body.callback, 'https://leah.somasyncai.com/verification-return.html');
  assert.equal('session_token' in res.payload, false);
  assert.equal('decision' in res.payload, false);
});

test('rejects a Didit response that does not echo the expected workflow or booking association', async (t) => {
  setEnvironment(t, {
    DIDIT_API_KEY: 'test-api-key',
    DIDIT_ELLIS_WORKFLOW_ID: WORKFLOW,
    ELLIS_DIDIT_REQUEST_TOKEN: CALLER_TOKEN,
    DIDIT_ELLIS_ENVIRONMENT: 'sandbox',
  });
  globalThis.fetch = async () => new Response(JSON.stringify(validDiditSession({
    workflow_id: '11111111-2222-3333-4444-555555555555',
  })), { status: 201 });

  const res = fakeResponse();
  await handler(request(), res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.sessionId, undefined);
  assert.equal(res.payload.verificationUrl, undefined);
});
