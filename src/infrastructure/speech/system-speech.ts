import * as Speech from 'expo-speech';
import type { SpeechSynthesisGateway } from '../../contracts/speech';

const english = /^en(?:[-_]|$)/i;
// Engines list voices in arbitrary order; prefer a stable accent before falling back to any English voice.
const preferred = [/^en[-_]us$/i, /^en[-_]gb$/i];

function pickEnglishVoice(voices: Speech.Voice[]): Speech.Voice | undefined {
  for (const pattern of preferred) {
    const match = voices.find((voice) => pattern.test(voice.language));
    if (match) return match;
  }
  return voices.find((voice) => english.test(voice.language));
}

export const systemSpeech: SpeechSynthesisGateway = {
  async hasEnglishVoice() {
    const voices = await Speech.getAvailableVoicesAsync();
    return voices.some((voice) => english.test(voice.language));
  },
  async speak(text, rate) {
    const voices = await Speech.getAvailableVoicesAsync();
    const voice = pickEnglishVoice(voices);
    if (!voice) throw new Error('设备没有可用的英语声音，请在系统语音设置中安装英语资源。');
    await Speech.stop();
    return new Promise<void>((resolve, reject) => {
      Speech.speak(text, {
        voice: voice.identifier,
        language: voice.language,
        rate,
        onDone: resolve,
        onStopped: resolve,
        onError: () => reject(new Error('系统朗读失败，请检查语音引擎和网络。')),
      });
    });
  },
  stop: () => Speech.stop(),
};
