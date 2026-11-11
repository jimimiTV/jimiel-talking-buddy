# Jimiel Talking Buddy

A calm talking companion for an iPad. The screen is one friendly face. He taps it, talks, and hears one short sentence back.

Live page: https://jimimitv.github.io/jimiel-talking-buddy/

## How Jimmy tests it on the iPad

1. On the iPad, open Safari and go to https://jimimitv.github.io/jimiel-talking-buddy/
2. The first launch asks for a Gemini API key. Create one at [Google AI Studio](https://aistudio.google.com/apikey), paste it, and tap Save. The key stays in this iPad's browser storage. It is not in the website code.
3. In Safari, tap Share, then **Add to Home Screen**.
4. Open **Buddy** from the home screen so it fills the screen.
5. Tap the face once. Allow the microphone if Safari asks.
6. Say a few words, then wait. The face thinks, speaks one short sentence, and listens again. If he is quiet, Buddy waits about nine seconds and then says something gentle, such as "I'm here." It waits longer between later prompts.
7. To paste a new key, or to remove the key, press and hold the top-right corner for about three seconds. You can also open `https://jimimitv.github.io/jimiel-talking-buddy/?setup`. Tap Clear to erase the key from this iPad. Tap the dim area around the card to close setup once a key is saved.

The iPad needs a network connection. Microphone, voice, and speech recognition can only be checked on the iPad itself.

Buddy sends the current spoken sentence and a fixed personality prompt to Gemini. It does not send audio, names, or earlier turns, and it does not keep a transcript.

## Voice and model

- Model: `gemini-flash-lite-latest` (the faster lite line, so the reply is not slow)
- Voice: Samantha, US English. If Samantha is missing, the first en-US voice, then any English voice
- Rate `0.85`, pitch `1`

## Check the page on a computer

```bash
npm install
npx playwright install chromium
npm test
```

`BASE_URL=https://jimimitv.github.io/jimiel-talking-buddy/ npm test` runs the same check against the live page. The test mocks Gemini and speech, so it does not need a real key or microphone.
