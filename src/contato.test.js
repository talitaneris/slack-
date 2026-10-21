'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { ExpressReceiver } = require('@slack/bolt');
const { CONTATO_WHATSAPP_URL, registerContatoRedirect } = require('./contato');

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  setLevel() {},
  getLevel() { return 'error'; },
  setName() {},
};

function hit(server, method, urlPath) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method },
      (res) => {
        res.resume();
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            location: res.headers.location || '',
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function createReceiver() {
  const receiver = new ExpressReceiver({
    signingSecret: 'test-secret',
    endpoints: '/slack/events',
    logger: silentLogger,
  });
  receiver.router.get('/curadoria', (req, res) => {
    res.status(200).type('html').send('<p>curadoria</p>');
  });
  receiver.router.get('/', (req, res) => {
    res.status(200).type('text').send('online');
  });
  registerContatoRedirect(receiver);
  return receiver;
}

test('GET and HEAD /contato and /contato/ redirect to WhatsApp', async () => {
  const receiver = createReceiver();
  const server = await new Promise((resolve) => {
    const listening = receiver.app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  try {
    for (const method of ['GET', 'HEAD']) {
      for (const urlPath of ['/contato', '/contato/', '/contato?utm=bio']) {
        const res = await hit(server, method, urlPath);
        assert.equal(res.status, 302, `${method} ${urlPath}`);
        assert.equal(res.location, CONTATO_WHATSAPP_URL, `${method} ${urlPath}`);
      }
    }
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('contato redirect leaves the Slack bot and /curadoria routes alone', async () => {
  const receiver = createReceiver();
  const server = await new Promise((resolve) => {
    const listening = receiver.app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  try {
    const curadoria = await hit(server, 'GET', '/curadoria');
    assert.equal(curadoria.status, 200);
    assert.equal(curadoria.location, '');

    const health = await hit(server, 'GET', '/');
    assert.equal(health.status, 200);
    assert.equal(health.location, '');

    const nested = await hit(server, 'GET', '/contato/extra');
    assert.equal(nested.status, 404);

    const slack = await hit(server, 'POST', '/slack/events');
    assert.notEqual(slack.status, 302);
    assert.equal(slack.location, '');
    assert.equal(slack.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('index.js registers the contato redirect on the Bolt receiver', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(source, /registerContatoRedirect\(receiver\)/);
});
