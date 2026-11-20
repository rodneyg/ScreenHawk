import { readSettings } from './settings';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

type Answer =
  | { ok: true; answer: string }
  | { ok: false; message: string; showOptions?: boolean };

export async function askOpenAI(prompt: string, image: string, signal: AbortSignal): Promise<Answer> {
  const { apiKey, model } = await readSettings();
  if (!apiKey) {
    return { ok: false, message: 'Add your OpenAI API key in ScreenHawk settings.', showOptions: true };
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal,
    body: JSON.stringify({
      model,
      store: false,
      max_completion_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: image } },
        ],
      }],
    }),
  });

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false, message: 'OpenAI rejected the key or its permissions. Check your API key in settings.',
      showOptions: true,
    };
  }
  if (response.status === 429) {
    return { ok: false, message: 'OpenAI reached a rate or quota limit. Check your API usage or try again later.' };
  }
  if (response.status === 400 || response.status === 404) {
    return {
      ok: false, message: 'OpenAI could not use this request. Check that your model supports image inputs.',
      showOptions: true,
    };
  }
  if (!response.ok) {
    return { ok: false, message: 'OpenAI could not answer right now. Try again.' };
  }

  const result = await response.json();
  const answer = result.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) {
    return { ok: false, message: 'OpenAI returned no answer. Try a shorter question or choose another model.' };
  }

  // The API never needs to return the key to the page, even if a provider echoes it.
  return { ok: true, answer: answer.trim().split(apiKey).join('[API key removed]') };
}
