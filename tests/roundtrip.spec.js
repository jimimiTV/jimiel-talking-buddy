import { test, expect } from '@playwright/test';

function pageURL() {
  const base = process.env.BASE_URL || 'http://127.0.0.1:4173';
  return base.endsWith('/') ? base : `${base}/`;
}

async function installDoubles(page) {
  await page.addInitScript(() => {
    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.lang = '';
        this.voice = null;
        this.onend = null;
        this.onerror = null;
      }
    }

    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices() {
        return [{
          name: 'Samantha',
          lang: 'en-US',
          default: true,
          localService: true,
          voiceURI: 'Samantha',
        }];
      },
      addEventListener() {},
      removeEventListener() {},
      cancel() {},
      resume() {},
      pause() {},
      speak(utterance) {
        window.__spoken = window.__spoken || [];
        window.__spoken.push({
          text: utterance.text,
          rate: utterance.rate,
          pitch: utterance.pitch,
          volume: utterance.volume,
          lang: utterance.lang,
          voice: utterance.voice ? utterance.voice.name : null,
        });
        window.__pendingUtterance = utterance;
        synth.speaking = true;
      },
    };

    window.SpeechSynthesisUtterance = FakeUtterance;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      writable: true,
      value: synth,
    });
    window.__finishSpeaking = () => {
      const utterance = window.__pendingUtterance;
      synth.speaking = false;
      if (utterance && typeof utterance.onend === 'function') utterance.onend();
    };

    class FakeRecognition {
      constructor() {
        this.lang = '';
        this.continuous = false;
        this.interimResults = false;
        this.onresult = null;
        this.onend = null;
        this.onerror = null;
        this.onstart = null;
        this._started = false;
        window.__recognition = this;
      }

      start() {
        if (this._started) {
          throw new DOMException('already started', 'InvalidStateError');
        }
        this._started = true;
        if (this.onstart) this.onstart();
      }

      stop() { this._halt(); }
      abort() { this._halt(); }

      _halt() {
        if (!this._started) return;
        this._started = false;
        if (this.onend) this.onend();
      }
    }

    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
  });
}

async function openApp(page, { key = true, query = '' } = {}) {
  const url = `${pageURL()}${query}`;
  await page.goto(url);
  if (!key) return;
  await page.evaluate(() => {
    localStorage.setItem(window.__buddy.storageKey, 'test-key-not-real');
  });
  await page.goto(url);
}

async function mockGemini(page, posts) {
  await page.route('**/*generativelanguage.googleapis.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type, x-goog-api-key',
          'access-control-max-age': '600',
        },
      });
      return;
    }
    const body = request.postDataJSON();
    posts.push({ url: request.url(), headers: request.headers(), body });
    const said = body.contents?.[0]?.parts?.[0]?.text;
    const canned = {
      'I like blue': 'Blue is a nice color. What else do you like?',
      Trains: 'Trains are fun. They go fast. Do you like them?',
    };
    const reply = canned[said] || 'Okay. This second sentence should never be spoken.';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text: reply }] } }],
      }),
    });
  });
}

async function say(page, text, { final = true, confidence = 0.92 } = {}) {
  await page.evaluate(({ text, final, confidence }) => {
    const rec = window.__recognition;
    if (!rec || typeof rec.onresult !== 'function') {
      throw new Error('recognition is not listening');
    }
    const result = [{ transcript: text, confidence }];
    result.isFinal = final;
    rec.onresult({ resultIndex: 0, results: [result] });
  }, { text, final, confidence });
}

async function spokenLines(page) {
  return page.evaluate(() => (window.__spoken || [])
    .filter((item) => item.text && item.text.trim())
    .map((item) => item));
}

async function startSession(page) {
  await page.locator('#face').click();
  await page.waitForFunction(() => window.__recognition && window.__recognition._started);
}

function assertOneShortSentence(text, limits) {
  expect(text.length).toBeGreaterThan(0);
  expect(text.length).toBeLessThanOrEqual(limits.maxChars);
  expect(text).toMatch(/^[^.!?]+[.!?]$/);
  const words = text.replace(/[.!?]$/, '').split(/\s+/).filter(Boolean);
  expect(words.length).toBeLessThanOrEqual(limits.maxWords);
}

test.beforeEach(async ({ page }) => {
  await installDoubles(page);
});

test('manifest is linked, valid, and icons load', async ({ page }) => {
  await openApp(page, { key: false });

  const linked = await page.locator('link[rel="manifest"]').getAttribute('href');
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const style = await page.locator('link[rel="stylesheet"]').getAttribute('href');
  const script = await page.locator('script[src]').getAttribute('src');
  for (const href of [linked, apple, style, script]) {
    expect(href.startsWith('/')).toBe(false);
    expect(href.includes('://')).toBe(false);
  }

  const capable = await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content');
  const theme = await page.locator('meta[name="theme-color"]').getAttribute('content');
  expect(capable).toBe('yes');
  expect(theme).toBe('#f4efe4');

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    const response = await fetch(link.href);
    return { ok: response.ok, status: response.status, json: await response.json() };
  });
  expect(manifest.ok).toBe(true);
  expect(manifest.status).toBe(200);
  expect(manifest.json.name).toBe('Jimiel Talking Buddy');
  expect(manifest.json.display).toBe('standalone');
  expect(manifest.json.start_url).toBe('./');
  expect(manifest.json.background_color).toBe('#f4efe4');
  const sizes = manifest.json.icons.map((icon) => icon.sizes).sort();
  expect(sizes).toEqual(['192x192', '512x512']);

  const manifestURL = new URL(linked, page.url()).href;
  for (const icon of manifest.json.icons) {
    const iconURL = new URL(icon.src, manifestURL).href;
    const response = await page.request.get(iconURL);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type'] || '').toContain('image/png');
    const bytes = await response.body();
    expect(bytes.length).toBeGreaterThan(500);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }

  const appleURL = new URL(apple, page.url()).href;
  const appleResponse = await page.request.get(appleURL);
  expect(appleResponse.status()).toBe(200);
  expect((await appleResponse.body()).subarray(0, 4).toString('hex')).toBe('89504e47');

  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#face')).toBeVisible();
});

test('setup opens with no key, ?setup, or a corner long-press, and clear removes the key', async ({ page }) => {
  await openApp(page, { key: false });
  await expect(page.locator('#setup')).toBeVisible();
  await page.locator('#key').fill('test-key-not-real');
  await page.locator('#setup button[type="submit"]').click();
  await expect(page.locator('#setup')).toBeHidden();
  const saved = await page.evaluate(() => localStorage.getItem(window.__buddy.storageKey));
  expect(saved).toBe('test-key-not-real');

  await page.goto(`${pageURL()}?setup`);
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#setup-note')).toHaveText('A key is already saved on this iPad.');
  await page.locator('#clear').click();
  await expect(page.locator('#setup')).toBeVisible();
  const cleared = await page.evaluate(() => localStorage.getItem(window.__buddy.storageKey));
  expect(cleared).toBeNull();

  await page.evaluate(() => {
    localStorage.setItem(window.__buddy.storageKey, 'test-key-not-real');
  });
  await page.goto(pageURL());
  await expect(page.locator('#setup')).toBeHidden();

  const holdMs = await page.evaluate(() => window.__buddy.holdMs);
  const corner = page.locator('#corner');
  await corner.dispatchEvent('pointerdown', { pointerId: 1, bubbles: true });
  await page.waitForTimeout(400);
  await corner.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  await page.waitForTimeout(holdMs);
  await expect(page.locator('#setup')).toBeHidden();

  await corner.dispatchEvent('pointerdown', { pointerId: 1, bubbles: true });
  await page.waitForTimeout(holdMs + 250);
  await expect(page.locator('#setup')).toBeVisible();
});

test('a turn sends only the transcript and system prompt, then speaks one sentence', async ({ page }) => {
  const posts = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await mockGemini(page, posts);
  await openApp(page);

  const buddy = await page.evaluate(() => ({
    systemPrompt: window.__buddy.systemPrompt,
    model: window.__buddy.model,
    voiceName: window.__buddy.voiceName,
    rate: window.__buddy.rate,
    pitch: window.__buddy.pitch,
    maxWords: window.__buddy.maxWords,
    maxChars: window.__buddy.maxChars,
  }));
  expect(buddy.model).toBe('gemini-flash-lite-latest');
  expect(buddy.voiceName).toBe('Samantha');
  expect(buddy.rate).toBe(0.85);
  expect(buddy.pitch).toBe(1);
  expect(buddy.maxWords).toBeLessThanOrEqual(14);
  expect(buddy.maxChars).toBeLessThanOrEqual(120);
  expect(buddy.systemPrompt).toContain('exactly one short sentence');
  expect(buddy.systemPrompt).toContain('Never be sarcastic');
  expect(buddy.systemPrompt).not.toMatch(/Jimiel|Elijah|Lisa|Chaloux|autism/i);

  const trimmed = await page.evaluate(() => window.__buddy.oneSentence(
    'I like that you said a whole lot of words today and I want to keep talking about every single thing.'
  ));
  assertOneShortSentence(trimmed, buddy);
  expect(await page.evaluate(() => window.__buddy.oneSentence(''))).toBe("I'm here.");
  expect(await page.evaluate(() => window.__buddy.isIntelligible('uh um'))).toBe(false);
  expect(await page.evaluate(() => window.__buddy.isIntelligible('...'))).toBe(false);
  expect(await page.evaluate(() => window.__buddy.isIntelligible('I like blue'))).toBe(true);

  await startSession(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-state', 'listening');

  await say(page, 'uh uh');
  await say(page, '...');
  await say(page, 'I like', { final: false, confidence: 0.4 });
  await page.waitForTimeout(200);
  expect(posts).toHaveLength(0);

  await say(page, 'I like blue');
  await page.waitForFunction(() => (window.__spoken || []).some((item) => item.text === 'Blue is a nice color.'));
  await expect(page.locator('#stage')).toHaveAttribute('data-state', 'speaking');

  expect(posts).toHaveLength(1);
  expect(posts[0].url).toContain('/models/gemini-flash-lite-latest:generateContent');
  expect(posts[0].url).not.toContain('test-key-not-real');
  expect(posts[0].url).not.toContain('blue');
  expect(posts[0].headers['x-goog-api-key']).toBe('test-key-not-real');
  expect(posts[0].body).toEqual({
    systemInstruction: { parts: [{ text: buddy.systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: 'I like blue' }] }],
  });
  expect(JSON.stringify(posts[0].body)).not.toMatch(/inlineData|Jimiel|Elijah|audio/i);

  const firstSpoken = await spokenLines(page);
  expect(firstSpoken.map((item) => item.text)).toEqual(['Blue is a nice color.']);
  expect(firstSpoken[0].voice).toBe('Samantha');
  expect(firstSpoken[0].rate).toBe(0.85);
  expect(firstSpoken[0].pitch).toBe(1);
  expect(firstSpoken[0].lang).toBe('en-US');
  assertOneShortSentence(firstSpoken[0].text, buddy);

  await page.evaluate(() => window.__finishSpeaking());
  await expect(page.locator('#stage')).toHaveAttribute('data-state', 'listening');
  await page.waitForFunction(() => window.__recognition && window.__recognition._started);

  await say(page, 'Trains');
  await page.waitForFunction(() => (window.__spoken || []).some((item) => item.text === 'Trains are fun.'));
  expect(posts).toHaveLength(2);
  expect(posts[1].body).toEqual({
    systemInstruction: { parts: [{ text: buddy.systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: 'Trains' }] }],
  });
  expect(JSON.stringify(posts[1].body)).not.toContain('blue');
  expect(JSON.stringify(posts[1].body)).not.toContain('nice');
  expect(Object.keys(posts[1].body).sort()).toEqual(['contents', 'systemInstruction']);

  const lines = await spokenLines(page);
  expect(lines.map((item) => item.text)).toEqual(['Blue is a nice color.', 'Trains are fun.']);
  lines.forEach((item) => assertOneShortSentence(item.text, buddy));
  expect(errors).toEqual([]);
});

test('quiet prompts wait about nine seconds and then back off', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jimiel.geminiKey', 'test-key-not-real');
  });
  await page.clock.install();
  await page.goto(pageURL());
  const quietBase = await page.evaluate(() => window.__buddy.quietBaseMs);
  const prompts = await page.evaluate(() => window.__buddy.quietPrompts);
  expect(quietBase).toBeGreaterThanOrEqual(8000);
  expect(quietBase).toBeLessThanOrEqual(10000);

  await startSession(page);
  await page.clock.fastForward(quietBase - 1);
  expect(await spokenLines(page)).toEqual([]);

  await page.clock.fastForward(200);
  await page.waitForFunction((line) => (window.__spoken || []).some((item) => item.text === line), prompts[0]);
  expect((await spokenLines(page)).map((item) => item.text)).toEqual([prompts[0]]);
  assertOneShortSentence(prompts[0], { maxWords: 12, maxChars: 110 });

  await page.evaluate(() => window.__finishSpeaking());
  await page.clock.fastForward(quietBase);
  expect((await spokenLines(page)).map((item) => item.text)).toEqual([prompts[0]]);

  await page.clock.fastForward(quietBase + 200);
  await page.waitForFunction((line) => (window.__spoken || []).some((item) => item.text === line), prompts[1]);
  expect((await spokenLines(page)).map((item) => item.text)).toEqual([prompts[0], prompts[1]]);
});
