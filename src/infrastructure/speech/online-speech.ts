import { fetch } from 'expo/fetch';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import type { OnlineSynthesisConfig, SpeechSynthesisGateway } from '../../contracts/speech';
import { splitForSpeech } from '../../domain/voice';
import { createSynthesizer } from './online-audio-api';

// Without any status within this time the file is taken as unplayable instead of waiting forever.
const loadTimeoutMs = 10_000;

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

// Plays one file to the end; resolves early when `signal` fires. The rate is applied by the player
// (pitch-corrected), so it works the same whether or not the provider supports a speed parameter.
function play(uri: string, rate: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const player = createAudioPlayer({ uri });
    let started = false;
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.remove();
      signal.removeEventListener('abort', stopped);
      player.pause();
      player.remove();
      if (error) reject(error); else resolve();
    };
    const stopped = () => settle();
    const timer = setTimeout(() => {
      if (!started) settle(new Error('无法播放朗读音频，请在“我的”页面换一种音频格式再试。'));
    }, loadTimeoutMs);
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.isLoaded || status.playing) started = true;
      if (status.didJustFinish) settle();
    });
    if (signal.aborted) return settle();
    signal.addEventListener('abort', stopped, { once: true });
    player.setPlaybackRate(rate, 'high');
    player.play();
  });
}

// Long replies are split to the endpoint's input limit and played in sequence. Each chunk is
// fetched right before it plays; its temporary file is deleted once it has played.
export function createOnlineSpeech(config: OnlineSynthesisConfig): SpeechSynthesisGateway {
  const synthesizer = createSynthesizer(config, fetch);
  let active: AbortController | null = null;

  return {
    async hasEnglishVoice() {
      return true;
    },

    async speak(text, rate) {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      await setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
      try {
        for (const chunk of splitForSpeech(text)) {
          const bytes = await synthesizer.synthesize(chunk, controller.signal);
          if (controller.signal.aborted) return;
          const file = new File(Paths.cache, `trellis-speech-${Date.now()}.${config.format}`);
          file.write(bytes);
          try {
            await play(file.uri, rate, controller.signal);
          } finally {
            try { file.delete(); } catch { /* the cache is cleared by the system eventually */ }
          }
          if (controller.signal.aborted) return;
        }
      } catch (error) {
        // Stopping mid-request is a normal end of speech, not a failure.
        if (isAbort(error)) return;
        throw error;
      } finally {
        if (active === controller) active = null;
      }
    },

    async stop() {
      active?.abort();
      active = null;
    },
  };
}
