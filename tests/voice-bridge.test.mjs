import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { WebSocket, WebSocketServer } from 'ws';

test('live voice events retry with a stable ID and preserve transcript order before hangup', { timeout: 15000 }, async () => {
  const received = [];
  let firstAttempt = true;
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const app = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/voice/config')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ type: 'Settings' }));
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    received.push(body);
    if (firstAttempt) { firstAttempt = false; res.writeHead(503); res.end(); return; }
    res.end('{}');
    if (body.event === 'call_ended') finish();
  });
  const deepgram = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  let caller;
  let bridge;
  try {
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    if (!deepgram.address()) await once(deepgram, 'listening');
    const dgPort = deepgram.address().port;
    // Reserve a free port before starting the actual bridge process.
    const reservation = http.createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const bridgePort = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    bridge = spawn(process.execPath, ['bridge/server.js'], {
      env: { ...process.env, PORT: String(bridgePort), APP_BASE_URL: `http://127.0.0.1:${app.address().port}`,
        VOICE_TURN_SECRET: 'local-test-secret', DEEPGRAM_API_KEY: 'local-test-key', DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${dgPort}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    await new Promise((resolve, reject) => {
      bridge.stdout.on('data', chunk => { output += chunk; if (output.includes('"event":"listening"')) resolve(); });
      bridge.on('error', reject);
      bridge.on('exit', code => reject(new Error(`Bridge exited with ${code}`)));
    });
    deepgram.on('connection', socket => {
      socket.once('message', () => {
        socket.send(JSON.stringify({ type: 'SettingsApplied' }));
        socket.send(JSON.stringify({ type: 'ConversationText', role: 'user', content: 'A haircut please.' }));
        socket.send(JSON.stringify({ type: 'ConversationText', role: 'assistant', content: 'What day works for you?' }));
        setTimeout(() => caller.send(JSON.stringify({ event: 'stop' })), 100);
      });
    });
    caller = new WebSocket(`ws://127.0.0.1:${bridgePort}`);
    await once(caller, 'open');
    caller.send(JSON.stringify({ event: 'start', start: { streamSid: 'stream-test', callSid: 'call-test', customParameters: {
      salonId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222', from: '+447700900123',
    } } }));
    await finished;
    assert.equal(received.length, 4);
    assert.equal(received[0].eventId, received[1].eventId);
    assert.equal(received[0].occurredAt, received[1].occurredAt);
    assert.equal(received[1].content, 'A haircut please.');
    assert.equal(received[2].content, 'What day works for you?');
    assert.equal(received[3].event, 'call_ended');
    assert.notEqual(received[1].eventId, received[2].eventId);
    assert.ok(Date.parse(received[1].occurredAt) < Date.parse(received[2].occurredAt));
  } finally {
    caller?.terminate();
    if (bridge && bridge.exitCode === null) { bridge.kill(); await once(bridge, 'exit'); }
    for (const socket of deepgram.clients) socket.terminate();
    await new Promise(resolve => deepgram.close(resolve));
    app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
  }
});

test('voice agent ends the call only after Deepgram finishes the goodbye', { timeout: 15000 }, async () => {
  const received = [];
  const bridgeToDeepgram = [];
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const app = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/voice/config')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ type: 'Settings' }));
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    received.push({ url: req.url, body });
    res.end('{}');
    if (body.event === 'call_ended') finish();
  });
  const deepgram = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  let caller;
  let bridge;
  try {
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    if (!deepgram.address()) await once(deepgram, 'listening');
    const dgPort = deepgram.address().port;
    const reservation = http.createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const bridgePort = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    bridge = spawn(process.execPath, ['bridge/server.js'], {
      env: {
        ...process.env,
        PORT: String(bridgePort),
        APP_BASE_URL: `http://127.0.0.1:${app.address().port}`,
        VOICE_TURN_SECRET: 'local-test-secret',
        DEEPGRAM_API_KEY: 'local-test-key',
        DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${dgPort}`,
        END_CALL_SAFETY_TIMEOUT_MS: '2000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    await new Promise((resolve, reject) => {
      bridge.stdout.on('data', chunk => { output += chunk; if (output.includes('"event":"listening"')) resolve(); });
      bridge.on('error', reject);
      bridge.on('exit', code => reject(new Error(`Bridge exited with ${code}`)));
    });
    deepgram.on('connection', socket => {
      socket.on('message', data => {
        const text = data.toString();
        bridgeToDeepgram.push(JSON.parse(text));
        if (bridgeToDeepgram.length === 1) {
          socket.send(JSON.stringify({ type: 'SettingsApplied' }));
          socket.send(JSON.stringify({
            type: 'FunctionCallRequest',
            functions: [{
              id: 'end-1',
              name: 'end_call',
              arguments: JSON.stringify({ outcome: 'declined', closingMessage: 'No problem. Thanks for calling.' }),
            }],
          }));
        }
        const message = bridgeToDeepgram.at(-1);
        if (message.type === 'InjectAgentMessage' && message.message === 'No problem. Thanks for calling.') {
          setTimeout(() => {
            assert.equal(received.some(item => item.body.event === 'call_ended'), false);
            socket.send(JSON.stringify({ type: 'AgentAudioDone' }));
          }, 30);
        }
      });
    });
    caller = new WebSocket(`ws://127.0.0.1:${bridgePort}`);
    await once(caller, 'open');
    caller.send(JSON.stringify({ event: 'start', start: { streamSid: 'stream-end', callSid: 'call-end', customParameters: {
      salonId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222', from: '+447700900123',
    } } }));
    await finished;
    assert.equal(received.length, 2);
    assert.equal(received[0].body.event, 'transcript');
    assert.equal(received[0].body.role, 'assistant');
    assert.equal(received[0].body.content, 'No problem. Thanks for calling.');
    assert.equal(received[1].body.event, 'call_ended');
    assert.equal(received[1].body.reason, 'agent_ended_call:declined');
    assert.ok(bridgeToDeepgram.some(message => message.type === 'InjectAgentMessage' && message.message === 'No problem. Thanks for calling.' && message.behavior === 'queue'));
    assert.ok(bridgeToDeepgram.some(message => message.type === 'FunctionCallResponse' && message.name === 'end_call'));
    assert.equal(received.some(item => item.url.startsWith('/api/voice/turn')), false);
  } finally {
    caller?.terminate();
    if (bridge && bridge.exitCode === null) { bridge.kill(); await once(bridge, 'exit'); }
    for (const socket of deepgram.clients) socket.terminate();
    await new Promise(resolve => deepgram.close(resolve));
    app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
  }
});
