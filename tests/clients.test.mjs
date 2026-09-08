import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
async function loadTs(path, overrides = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, require: name => overrides[name] ?? require(name) });
  return module.exports;
}

test('phone matching handles SMS, WhatsApp, UK local and international formats without merging withheld callers', async () => {
  const { normalizeClientPhone } = await loadTs('../lib/client-profile.ts');
  for (const phone of ['+44 7700 900123', 'whatsapp:+447700900123', '07700 900123', '00447700900123']) {
    assert.equal(normalizeClientPhone(phone), '+447700900123');
  }
  assert.equal(normalizeClientPhone('+1 (202) 555-0123'), '+12025550123');
  for (const phone of ['anonymous', 'unknown', '0700000000', '1234', '+44oops7700900123']) assert.equal(normalizeClientPhone(phone), null);
});

test('recognition includes contact details and relevant bookings, without treating history as current intent', async () => {
  const { buildClientContext } = await loadTs('../lib/client-profile.ts');
  const result = buildClientContext({ first_name: 'Alex', last_name: 'Smith', email: 'alex@example.org', phone: '+447700900123', metadata: {}, booking_history: [
    { service: 'Colour', start_time: '2099-10-01T09:00:00Z', status: 'confirmed' },
    { service: 'Cut', start_time: '2020-01-01T09:00:00Z', status: 'confirmed' },
    { service: 'Abandoned hold', start_time: '2020-01-01T09:00:00Z', status: 'expired' },
  ] });
  assert.match(result, /Alex Smith/);
  assert.match(result, /alex@example.org/);
  assert.match(result, /Colour/);
  assert.match(result, /Cut/);
  assert.doesNotMatch(result, /Abandoned hold/);
  assert.match(result, /confirm the name before disclosing appointment details/);
  assert.match(result, /not a new booking request/);
});

test('client migration backfills, links channels, enforces tenant boundaries and keeps JSON history current', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table business_profiles(id uuid primary key);
      create table workers(id uuid primary key, salon_id uuid, name text);
      create table sessions(id uuid primary key default gen_random_uuid(), salon_id uuid, client_identifier text, channel text,
        metadata jsonb default '{}', created_at timestamptz default now());
      create table bookings(id uuid primary key default gen_random_uuid(), salon_id uuid, customer_phone text, client_name text,
        client_email text, service_name text, duration_minutes int, start_time timestamptz, end_time timestamptz,
        worker_id uuid, status text, cal_booking_uid text, responses jsonb, created_at timestamptz default now());
      insert into business_profiles values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
      insert into workers values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Sam');
      insert into sessions(salon_id, client_identifier, channel) values ('11111111-1111-4111-8111-111111111111', '07700 900123', 'sms');
      insert into bookings(salon_id, customer_phone, client_name, client_email, service_name, start_time, end_time, status, worker_id, responses)
      values ('11111111-1111-4111-8111-111111111111', '+447700900123', 'Alex Smith Jones', 'ALEX@EXAMPLE.ORG', 'Cut',
        '2026-09-10T09:00:00Z', '2026-09-10T10:00:00Z', 'confirmed', '33333333-3333-4333-8333-333333333333', '{"notes":"Short fringe"}');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20260908140000_clients.sql', import.meta.url), 'utf8'));
    const one = async sql => (await db.query(sql)).rows[0];
    let client = await one('select * from clients');
    assert.equal(client.first_name, 'Alex'); assert.equal(client.last_name, 'Smith Jones'); assert.equal(client.email, 'alex@example.org');
    assert.equal(client.booking_history.length, 1); assert.equal(client.booking_history[0].worker_name, 'Sam');
    assert.equal(client.booking_history[0].details.notes, 'Short fringe');
    assert.equal((await one('select client_id from sessions')).client_id, client.id);
    for (const channel of ['whatsapp', 'voice']) await db.query('insert into sessions(salon_id, client_identifier, channel) values ($1, $2, $3)', [client.salon_id, 'whatsapp:+44 7700 900123', channel]);
    assert.equal((await one('select count(*)::int as n from clients')).n, 1);
    assert.equal((await one('select count(distinct client_id)::int as n from sessions')).n, 1);
    await db.exec(`insert into sessions(salon_id, client_identifier, channel, metadata) values
      ('11111111-1111-4111-8111-111111111111', '+447700900888', 'sms', '{"source":"sophia-sandbox"}'),
      ('11111111-1111-4111-8111-111111111111', 'anonymous', 'voice', '{}'),
      ('22222222-2222-4222-8222-222222222222', '+447700900123', 'sms', '{}');`);
    assert.equal((await one('select count(*)::int as n from clients')).n, 2);
    await assert.rejects(db.exec(`update sessions set client_id = '${client.id}' where salon_id = '22222222-2222-4222-8222-222222222222'`), /foreign key/);
    await db.exec(`update clients set first_name = 'Alexandra', email = 'new@example.org' where id = '${client.id}';
      update bookings set start_time = '2026-09-12T10:00:00Z', end_time = '2026-09-12T11:00:00Z';
      update bookings set status = 'cancelled';`);
    client = await one(`select * from clients where id = '${client.id}'`);
    assert.equal(client.first_name, 'Alexandra'); assert.equal(client.email, 'new@example.org');
    assert.equal(client.booking_history.length, 1); assert.equal(client.booking_history[0].status, 'cancelled');
    assert.equal(Date.parse(client.booking_history[0].start_time), Date.parse('2026-09-12T10:00:00Z'));
    await db.exec(`insert into bookings(salon_id, customer_phone, client_name, client_email, service_name, start_time, status)
      values ('11111111-1111-4111-8111-111111111111', '+447700900123', 'Client', 'client@example.com', 'Colour', '2026-10-01', 'held');`);
    assert.equal((await one(`select * from clients where id = '${client.id}'`)).booking_history.length, 2);
    await db.exec(`update bookings set status = 'expired' where status = 'held';`);
    assert.equal((await one(`select * from clients where id = '${client.id}'`)).booking_history.find(b => b.service === 'Colour').status, 'expired');
    await db.exec(`delete from bookings where service_name = 'Colour';`);
    assert.equal((await one(`select * from clients where id = '${client.id}'`)).booking_history.length, 1);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from clients'), /permission denied/);
      await assert.rejects(db.query("select ensure_client('11111111-1111-4111-8111-111111111111', '+447700900999')"), /permission denied/);
      await db.exec('reset role');
    }
    const js = await loadTs('../lib/client-profile.ts');
    for (const phone of ['whatsapp:+44 7700 900123', '07700 900123', '00447700900123', 'anonymous', '+1 (202) 555-0123']) {
      const sql = (await db.query('select normalize_client_phone($1) as phone', [phone])).rows[0].phone;
      assert.equal(sql, js.normalizeClientPhone(phone));
    }
  } finally { await db.close(); }
});

test('phone transcripts render read-only while SMS keeps its composer', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { default: Chat } = await loadTs('../app/(dashboard)/dashboard/sessions/[id]/ChatInterface.tsx', {
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/lib/client-events': { trackClientEvent() {} },
    '@/lib/agent-name': { getAgentName: () => 'Sophia', getAgentPossessiveName: () => "Sophia's" },
  });
  const props = { sessionId: 'call', initialTranscript: [{ id: '1', role: 'user', content: 'A haircut please', created_at: '2026-09-08T12:00:00Z', channel: 'voice' }], clientPhone: '+447700900123', sessionStatus: 'active' };
  const voice = renderToStaticMarkup(React.createElement(Chat, { ...props, sessionChannel: 'voice' }));
  assert.match(voice, /Live call/); assert.match(voice, /Read-only/); assert.match(voice, /A haircut please/); assert.doesNotMatch(voice, /<textarea/);
  const ended = renderToStaticMarkup(React.createElement(Chat, { ...props, sessionChannel: 'voice', sessionStatus: 'completed' }));
  assert.match(ended, /Call ended/); assert.doesNotMatch(ended, /<textarea/);
  const sms = renderToStaticMarkup(React.createElement(Chat, { ...props, sessionChannel: 'sms' }));
  assert.match(sms, /<textarea/);
});

test('dashboard rejects cross-tenant transcript reads and all voice editing commands', async () => {
  const { NextRequest, NextResponse } = require('next/server');
  const tenant = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  let privateReads = 0;
  let writes = 0;
  const db = { from(table) {
    const filters = {};
    const result = () => ({ data: filters.salon_id === tenant && filters.id === sessionId ? { id: sessionId, salon_id: tenant, channel: 'voice', status: 'active', metadata: {} } : null });
    if (table !== 'sessions') privateReads++;
    return {
      select() { return this; }, eq(key, value) { filters[key] = value; return this; },
      single: async () => result(), maybeSingle: async () => result(),
      update() { writes++; throw new Error('Unexpected write'); },
    };
  } };
  const overrides = {
    '@/lib/supabase': { supabase: db, isTestUiSession: () => false },
    '@/lib/dashboard-auth': { requireDashboardSessionFromRequest(req) {
      const tenantId = req.headers.get('x-test-tenant');
      return tenantId ? { session: { tenantId } } : { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
    } },
    '@/lib/deferred-notifications': { cancelDeferredNotification: async () => {} },
    '@/lib/logger': { safeLog() {}, log() {} },
    '@/lib/twilio': { sendOnChannel: () => { writes++; throw new Error('Unexpected message'); } },
    '@/lib/sms-messages': {},
  };
  const { GET } = await loadTs('../app/api/dashboard/session/transcript/route.ts', overrides);
  assert.equal((await GET(new NextRequest(`http://localhost/api/dashboard/session/transcript?sessionId=${sessionId}`))).status, 401);
  assert.equal((await GET(new NextRequest(`http://localhost/api/dashboard/session/transcript?sessionId=${sessionId}`, { headers: { 'x-test-tenant': 'other-tenant' } }))).status, 404);
  assert.equal(privateReads, 0);
  for (const path of ['approve', 'session/mode', 'session/complete']) {
    const { POST } = await loadTs(`../app/api/dashboard/${path}/route.ts`, overrides);
    const request = new NextRequest(`http://localhost/api/dashboard/${path}`, {
      method: 'POST', headers: { 'x-test-tenant': tenant, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content: 'Do not send', override: 'manual' }),
    });
    assert.equal((await POST(request)).status, 409, path);
  }
  assert.equal(writes, 0);
});
