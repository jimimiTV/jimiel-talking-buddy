(function () {
  'use strict';

  // Lite is the faster flash line, so a short reply comes back while he is still with us.
  const MODEL = 'gemini-flash-lite-latest';
  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';
  const STORAGE_KEY = 'jimiel.geminiKey';
  const VOICE_NAME = 'Samantha';
  const RATE = 0.85;
  const PITCH = 1;
  const HOLD_MS = 3000;
  const QUIET_BASE_MS = 9000;
  const QUIET_MAX_MS = 36000;
  const MAX_WORDS = 12;
  const MAX_CHARS = 110;
  const SYSTEM_PROMPT = [
    'You are a calm talking buddy for a young child who uses few words.',
    'Reply with exactly one short sentence and one idea.',
    'Use simple, concrete words. Be warm, gentle, and predictable.',
    'Never be sarcastic, teasing, or scary.',
    'Do not give a list. Do not ask more than one question, and only if that question is the whole reply.',
    'Do not mention computers, helpers, or that you are following instructions.',
  ].join(' ');
  const QUIET_PROMPTS = [
    "I'm here.",
    'What color do you like?',
    'I like being with you.',
    'What do you see?',
  ];
  const FILLERS = { uh: 1, um: 1, hmm: 1, hm: 1, ah: 1, er: 1, eh: 1, mhm: 1 };

  const stage = document.getElementById('stage');
  const face = document.getElementById('face');
  const corner = document.getElementById('corner');
  const setup = document.getElementById('setup');
  const setupForm = document.getElementById('setup-form');
  const setupNote = document.getElementById('setup-note');
  const keyInput = document.getElementById('key');
  const clearButton = document.getElementById('clear');

  let sessionOn = false;
  let setupOpen = false;
  let state = 'idle';
  let listenWanted = false;
  let recognition = null;
  let quietTimer = null;
  let restartTimer = null;
  let quietSteps = 0;
  let speakGen = 0;
  let requestGen = 0;
  let failedStarts = 0;
  let audioCtx = null;

  function setState(next) {
    state = next;
    stage.dataset.state = next;
  }

  function readKey() {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function writeKey(value) {
    localStorage.setItem(STORAGE_KEY, value);
  }

  function forgetKey() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function oneSentence(raw) {
    let text = String(raw || '').replace(/\s+/g, ' ').trim();
    text = text.replace(/^buddy\s*:\s*/i, '');
    text = text.replace(/^["'“”]+|["'“”]+$/g, '').trim();
    text = text.replace(/https?:\/\/\S+/gi, '').trim();
    try {
      text = text.replace(/\p{Extended_Pictographic}/gu, '').trim();
    } catch (error) {
      text = text.replace(/[\u{1F000}-\u{1FAFF}]/gu, '').trim();
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return "I'm here.";

    const match = text.match(/^(.+?[.!?])(?=\s|$)/);
    if (match) text = match[1];
    else {
      text = text.split(/[;\n]/)[0].trim();
      if (!/[.!?]$/.test(text)) text += '.';
    }

    const words = text.replace(/[.!?]+$/, '').split(/\s+/).filter(Boolean);
    if (words.length > MAX_WORDS) text = words.slice(0, MAX_WORDS).join(' ') + '.';

    if (text.length > MAX_CHARS) {
      let cut = text.slice(0, MAX_CHARS);
      const lastSpace = cut.lastIndexOf(' ');
      if (lastSpace > 40) cut = cut.slice(0, lastSpace);
      cut = cut.replace(/[,:;]+$/, '').trim();
      if (!/[.!?]$/.test(cut)) cut += '.';
      text = cut;
    }

    const end = text.search(/[.!?]/);
    if (end !== -1 && end < text.length - 1) text = text.slice(0, end + 1);
    return text || "I'm here.";
  }

  function isIntelligible(text, confidence) {
    const cleaned = String(text || '')
      .replace(/[^a-z0-9'\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return false;
    const words = cleaned.split(' ');
    const real = words.filter((word) => !FILLERS[word.toLowerCase()]);
    if (!real.length) return false;
    const allowOne = { i: 1, a: 1 };
    if (real.every((word) => word.length < 2 && !allowOne[word.toLowerCase()])) return false;
    if (typeof confidence === 'number' && confidence > 0 && confidence < 0.25 && real.join(' ').length < 3) {
      return false;
    }
    return true;
  }

  function synth() {
    return window.speechSynthesis || null;
  }

  function isEnUS(voice) {
    return String(voice.lang || '').toLowerCase().replace(/_/g, '-').startsWith('en-us');
  }

  function chooseVoice() {
    const s = synth();
    if (!s || typeof s.getVoices !== 'function') return null;
    const voices = s.getVoices() || [];
    return (
      voices.find((voice) => voice.name === VOICE_NAME && isEnUS(voice)) ||
      voices.find((voice) => voice.name === VOICE_NAME) ||
      voices.find((voice) => isEnUS(voice)) ||
      voices.find((voice) => String(voice.lang || '').toLowerCase().startsWith('en')) ||
      null
    );
  }

  function unlockAudio() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        if (!audioCtx) audioCtx = new AudioCtx();
        audioCtx.resume().catch(() => {});
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
      } catch (error) {
        audioCtx = null;
      }
    }
    const s = synth();
    if (!s || typeof window.SpeechSynthesisUtterance !== 'function') return;
    try {
      const primer = new SpeechSynthesisUtterance(' ');
      primer.volume = 0;
      primer.rate = RATE;
      primer.pitch = PITCH;
      primer.lang = 'en-US';
      const voice = chooseVoice();
      if (voice) primer.voice = voice;
      s.resume();
      s.speak(primer);
    } catch (error) {
      /* a later reply still tries */
    }
  }

  function scheduleQuiet() {
    clearTimeout(quietTimer);
    if (!sessionOn || setupOpen) return;
    const wait = Math.min(QUIET_MAX_MS, QUIET_BASE_MS * (quietSteps + 1));
    quietTimer = setTimeout(() => {
      if (!sessionOn || setupOpen || state !== 'listening') return;
      const line = QUIET_PROMPTS[quietSteps % QUIET_PROMPTS.length];
      quietSteps += 1;
      speakLine(line);
    }, wait);
  }

  function speakLine(raw) {
    const line = oneSentence(raw);
    const gen = ++speakGen;
    setState('speaking');
    stopListening();
    clearTimeout(quietTimer);

    const done = () => {
      if (gen !== speakGen || done.finished) return;
      done.finished = true;
      if (!sessionOn || setupOpen) {
        setState('idle');
        return;
      }
      // Let the last word finish before the microphone opens again.
      setState('listening');
      scheduleQuiet();
      setTimeout(() => {
        if (gen !== speakGen || !sessionOn || setupOpen || state !== 'listening') return;
        startListening();
      }, 350);
    };

    const s = synth();
    if (!s || typeof window.SpeechSynthesisUtterance !== 'function') {
      setTimeout(done, 250);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(line);
    utterance.rate = RATE;
    utterance.pitch = PITCH;
    utterance.lang = 'en-US';
    utterance.volume = 1;
    const voice = chooseVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = done;
    utterance.onerror = done;

    try { s.cancel(); } catch (error) { /* ignore */ }

    setTimeout(() => {
      if (gen !== speakGen) return;
      try {
        s.resume();
        s.speak(utterance);
      } catch (error) {
        done();
        return;
      }
      setTimeout(done, Math.min(9000, 1600 + line.length * 80));
    }, 60);
  }

  function pauseForTap() {
    sessionOn = false;
    listenWanted = false;
    speakGen += 1;
    requestGen += 1;
    clearTimeout(quietTimer);
    clearTimeout(restartTimer);
    stopListening();
    stage.dataset.ready = 'no';
    setState('idle');
  }

  function ensureRecognition() {
    if (recognition) return recognition;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => {
      failedStarts = 0;
    };
    rec.onerror = (event) => {
      const code = event && event.error;
      if (code === 'aborted' || code === 'no-speech') return;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        pauseForTap();
        return;
      }
      failedStarts += 1;
      if (failedStarts > 4) pauseForTap();
    };
    rec.onend = () => {
      if (!listenWanted || !sessionOn || setupOpen || state !== 'listening') return;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (listenWanted && state === 'listening') startListening();
      }, 350);
    };
    rec.onresult = (event) => {
      if (!listenWanted || setupOpen || state === 'thinking' || state === 'speaking') return;
      let finalText = '';
      let interimText = '';
      let confidence = null;
      const results = event.results || [];
      const start = event.resultIndex || 0;
      for (let i = start; i < results.length; i += 1) {
        const result = results[i];
        const piece = (result[0] && result[0].transcript) || '';
        if (result.isFinal) {
          finalText += piece;
          if (result[0] && typeof result[0].confidence === 'number') confidence = result[0].confidence;
        } else {
          interimText += piece;
        }
      }
      if (interimText.trim()) scheduleQuiet();
      finalText = finalText.replace(/\s+/g, ' ').trim();
      if (!finalText || !isIntelligible(finalText, confidence)) return;
      quietSteps = 0;
      clearTimeout(quietTimer);
      askBuddy(finalText);
    };
    recognition = rec;
    return rec;
  }

  function startListening() {
    if (!sessionOn || setupOpen || state === 'speaking' || state === 'thinking') return;
    const rec = ensureRecognition();
    if (!rec) {
      pauseForTap();
      return;
    }
    listenWanted = true;
    setState('listening');
    try {
      rec.start();
    } catch (error) {
      /* already started */
    }
  }

  function stopListening() {
    listenWanted = false;
    clearTimeout(restartTimer);
    if (!recognition) return;
    try {
      recognition.abort();
    } catch (error) {
      try { recognition.stop(); } catch (ignore) { /* already stopped */ }
    }
  }

  async function askBuddy(transcript) {
    const message = transcript.replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!message || !isIntelligible(message)) return;
    const gen = ++requestGen;
    setState('thinking');
    stopListening();
    clearTimeout(quietTimer);

    const key = readKey();
    if (!key) {
      openSetup();
      return;
    }

    const payload = {
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: message }],
        },
      ],
    };

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(payload),
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
      });
      if (gen !== requestGen || setupOpen || !sessionOn) return;
      if (!response.ok) throw new Error('reply failed');
      const data = await response.json();
      const parts = data
        && data.candidates
        && data.candidates[0]
        && data.candidates[0].content
        && data.candidates[0].content.parts;
      const raw = Array.isArray(parts) ? parts.map((part) => part.text || '').join(' ') : '';
      if (gen !== requestGen || setupOpen || !sessionOn) return;
      speakLine(raw);
    } catch (error) {
      if (gen !== requestGen || setupOpen || !sessionOn) return;
      speakLine("I'm here.");
    }
  }

  function openSetup() {
    setupOpen = true;
    sessionOn = false;
    listenWanted = false;
    speakGen += 1;
    requestGen += 1;
    clearTimeout(quietTimer);
    clearTimeout(restartTimer);
    stopListening();
    const s = synth();
    if (s) {
      try { s.cancel(); } catch (error) { /* ignore */ }
    }
    setState('idle');
    const saved = !!readKey();
    setupNote.textContent = saved
      ? 'A key is already saved on this iPad.'
      : 'Saved on this iPad only.';
    keyInput.value = '';
    setup.hidden = false;
  }

  function closeSetup() {
    if (!readKey()) {
      openSetup();
      return;
    }
    setupOpen = false;
    keyInput.value = '';
    setup.hidden = true;
    stage.dataset.ready = 'no';
    setState('idle');
  }

  function normalizedKey() {
    return keyInput.value.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, '');
  }

  face.addEventListener('click', () => {
    if (setupOpen) return;
    if (!readKey()) {
      openSetup();
      return;
    }
    if (state === 'speaking' || state === 'thinking') return;
    if (sessionOn && state === 'listening') return;
    sessionOn = true;
    quietSteps = 0;
    stage.dataset.ready = 'yes';
    unlockAudio();
    setState('listening');
    startListening();
    scheduleQuiet();
  });

  let holdTimer = null;
  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  corner.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    cancelHold();
    holdTimer = setTimeout(openSetup, HOLD_MS);
  });
  corner.addEventListener('pointerup', cancelHold);
  corner.addEventListener('pointerleave', cancelHold);
  corner.addEventListener('pointercancel', cancelHold);
  corner.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('contextmenu', (event) => event.preventDefault());

  setup.addEventListener('click', () => {
    if (readKey()) closeSetup();
  });
  setupForm.addEventListener('click', (event) => event.stopPropagation());
  setupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = normalizedKey();
    if (!value) return;
    try {
      writeKey(value);
    } catch (error) {
      return;
    }
    closeSetup();
  });
  clearButton.addEventListener('click', () => {
    try { forgetKey(); } catch (error) { /* ignore */ }
    keyInput.value = '';
    openSetup();
  });

  const params = new URLSearchParams(location.search);
  if (!readKey() || params.has('setup')) openSetup();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  }

  window.__buddy = Object.freeze({
    storageKey: STORAGE_KEY,
    systemPrompt: SYSTEM_PROMPT,
    model: MODEL,
    voiceName: VOICE_NAME,
    rate: RATE,
    pitch: PITCH,
    holdMs: HOLD_MS,
    quietBaseMs: QUIET_BASE_MS,
    quietMaxMs: QUIET_MAX_MS,
    maxWords: MAX_WORDS,
    maxChars: MAX_CHARS,
    quietPrompts: QUIET_PROMPTS.slice(),
    oneSentence,
    isIntelligible,
  });
})();
