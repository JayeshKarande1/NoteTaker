// Real-model acceptance check. Uses a separate browser profile and a supplied WAV as the microphone.
// Run against `npm run preview -- --port 4173` after building.
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const language = process.argv[2] || 'en';
const file = resolve(process.argv[3] || `.local/${language === 'hi' ? 'hindi' : 'english'}.wav`);
await mkdir('.local', { recursive: true });
const context = await chromium.launchPersistentContext(resolve('.local/speech-profile'), {
  channel: 'chrome', headless: true, viewport: { width: 1440, height: 1000 },
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`],
  permissions: ['microphone'],
});
const page = context.pages()[0];
const pageErrors = [], network = [];
page.on('pageerror', (error) => { pageErrors.push(error.message); console.log('PAGE ERROR', error.message); });
page.on('console', (msg) => { if (msg.type() === 'error') console.log('CONSOLE', msg.text().slice(0, 300)); });
page.on('requestfailed', (request) => console.log('REQUEST FAILED', request.url().slice(0, 180), request.failure()?.errorText));
page.on('request', (request) => network.push(request.url()));
try {
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('button', { name: /Offline setup|Offline ready/ }).click();
  const ready = page.getByText('Offline transcription is ready', { exact: true });
  if (!await ready.isVisible()) {
    const setup = page.getByRole('button', { name: /Set up offline transcription|Retry offline setup/ });
    await Promise.race([ready.waitFor({ timeout: 60000 }), setup.waitFor({ timeout: 60000 })]);
    if (await setup.isVisible()) await setup.click();
  }
  const progressTimer = setInterval(async () => { try { console.log('SETUP', (await page.locator('.download-progress').textContent({ timeout: 1000 }))?.trim()); } catch {} }, 15000);
  try { await expect(ready).toBeVisible({ timeout: 300000 }); } finally { clearInterval(progressTimer); }
  console.log('MODEL READY');
  await page.getByRole('button', { name: 'Back to your thoughts' }).click();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  network.length = 0;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Offline ready', exact: true })).toBeVisible({ timeout: 120000 });
  console.log('OFFLINE RELOAD READY');
  await page.getByRole('combobox', { name: 'Recording language' }).selectOption(language);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish note', exact: true })).toBeVisible({ timeout: 30000 });
  // Capture the complete fixture plus a short pause. This is intentional recording time.
  await page.waitForTimeout(language === 'hi' ? 14000 : 10500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish note', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note transcript' })).toBeEditable({ timeout: 180000 });
  const transcript = await page.getByRole('textbox', { name: 'Note transcript' }).inputValue();
  if (language === 'en') expect(transcript.toLowerCase()).toMatch(/bread.*milk/);
  else expect(transcript).toMatch(/[\u0900-\u097f]{3}/);
  expect(transcript.length).toBeGreaterThan(20);
  await page.getByRole('textbox', { name: 'Note title' }).fill(language === 'hi' ? 'हिन्दी · ऑफ़लाइन परीक्षण' : 'Morning reminders · offline test');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Listen to recording/ }).click();
  await expect(page.locator('audio')).toBeVisible();
  await page.locator('audio').evaluate((audio) => audio.play());
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .1);
  await page.locator('audio').evaluate((audio) => audio.pause());
  await page.screenshot({ path: `.local/verified-${language}.png`, fullPage: true });
  const external = network.filter((url) => /^https?:/.test(url) && !url.startsWith('http://127.0.0.1:4173/'));
  expect(external).toEqual([]); expect(pageErrors).toEqual([]);
  await writeFile(`.local/speech-result-${language}.json`, JSON.stringify({ language, transcript, offline: true, externalRequests: external, pageErrors, checkedAt: new Date().toISOString() }, null, 2));
  console.log('PASS', JSON.stringify({ language, transcript, offline: true, externalRequests: external }));
} catch (error) {
  await page.screenshot({ path: '.local/speech-failure.png', fullPage: true }).catch(() => {});
  console.log((await page.locator('body').innerText()).slice(-4500));
  throw error;
} finally { await context.close(); }
