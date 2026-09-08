import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, rm } from 'node:fs/promises';

// Install an isolated UI fixture for this check, then remove it from the app.
// All browser API calls are intercepted below; no real contacts are read or changed.
const fixturePath = new URL('../app/verify-clients-internal/', import.meta.url);
await mkdir(fixturePath);
await copyFile(new URL('./fixtures/dashboard-preview.tsx', import.meta.url), new URL('page.tsx', fixturePath));

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'darwin' ? { channel: 'chrome' } : {}), headless: true,
}).catch(async error => { await rm(fixturePath, { recursive: true }); throw error; });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const messages = [];
let callStatus = 'active';
let savedProfile;
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  let response = {};
  if (path === '/api/dashboard/salon') response = { name: 'Test Salon', agent_name: 'Sophia', approval_mode: false };
  if (path === '/api/dashboard/session/transcript') response = { status: callStatus, channel: 'voice', messages, hasDraft: false };
  if (path === '/api/dashboard/clients') {
    savedProfile = route.request().postDataJSON();
    response = { client: { id: savedProfile.id, phone: '+447700900123' } };
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
});
try {
  await page.goto('http://localhost:3001/verify-clients-internal');
  await page.getByRole('heading', { name: 'Clients', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Alexandra Smith Jones', exact: true }).count(), 1);
  await page.screenshot({ path: '/private/tmp/resevia-clients-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Add client', exact: true }).click();
  await page.getByLabel('First name', { exact: true }).fill('Jordan');
  await page.getByLabel('Last name', { exact: true }).fill('Taylor');
  await page.getByLabel('Email', { exact: true }).fill('jordan@example.org');
  await page.getByLabel('Phone number', { exact: true }).fill('07700 900456');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/resevia-clients-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Client directory overflows mobile viewport');
  await page.goto('http://localhost:3001/verify-clients-internal?view=profile');
  await page.getByRole('heading', { name: 'Alexandra Smith Jones' }).waitFor();
  await page.getByLabel('First name', { exact: true }).fill('Alex');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('status').getByText('Saved', { exact: true }).waitFor();
  assert.equal(savedProfile.first_name, 'Alex');
  assert.equal(savedProfile.id, '33333333-3333-4333-8333-333333333333');
  assert.equal(savedProfile.booking_history, undefined);
  assert.ok(await page.getByLabel('Phone number').getAttribute('readonly') !== null);
  await page.screenshot({ path: '/private/tmp/resevia-profile-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Client profile overflows mobile viewport');
  await page.goto('http://localhost:3001/verify-clients-internal?view=call');
  await page.getByText('Live call', { exact: true }).waitFor();
  assert.equal(await page.locator('textarea').count(), 0);
  messages.push({ id: '44444444-4444-4444-8444-444444444444', role: 'user', channel: 'voice', content: 'Could I book a haircut for Thursday?', created_at: new Date().toISOString() });
  await page.getByText('Could I book a haircut for Thursday?', { exact: true }).waitFor({ timeout: 10000 });
  messages.push({ id: '55555555-5555-4555-8555-555555555555', role: 'assistant', channel: 'voice', content: 'Of course, Alex. What time works for you?', created_at: new Date().toISOString() });
  await page.getByText('Of course, Alex. What time works for you?', { exact: true }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: '/private/tmp/resevia-call-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '/private/tmp/resevia-call-desktop.png', fullPage: true });
  callStatus = 'completed';
  await page.getByText('Call ended', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('textarea').count(), 0);
  assert.equal(await page.getByText('Could I book a haircut for Thursday?', { exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: client directory, profile editing, mobile layout, live polling, duplicate prevention, and read-only hangup state.');
} finally { await browser.close(); await rm(fixturePath, { recursive: true }); }
