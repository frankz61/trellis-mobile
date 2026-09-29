import { ExpoSpeechRecognitionModule, type ExpoSpeechRecognitionErrorCode } from 'expo-speech-recognition';
import type { RecognitionCapability, SpeechRecognitionGateway } from '../../contracts/speech';

const errorMessages: Partial<Record<ExpoSpeechRecognitionErrorCode, string>> = {
  'not-allowed': '没有麦克风或语音识别权限，请在系统设置中允许。',
  'language-not-supported': '当前识别服务不支持英语，请在系统语音设置中安装英语资源。',
  'no-speech': '没有听到说话内容，请再试一次。',
  'speech-timeout': '没有听到说话内容，请再试一次。',
  network: '语音识别需要网络，当前无法连接。',
  'service-not-allowed': '系统语音识别服务不可用。',
  'audio-capture': '无法录音，请检查麦克风是否被其他应用占用。',
  busy: '语音识别正忙，请稍后再试。',
};

function abortError(): Error {
  return Object.assign(new Error('识别已取消。'), { name: 'AbortError' });
}

// Android SpeechRecognizer via expo-speech-recognition. Availability is checked without
// prompting; the permission prompt only appears when the learner actually starts recording.
export const systemRecognition: SpeechRecognitionGateway = {
  async capability(): Promise<RecognitionCapability> {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      return { available: false, onDevice: false, reason: '这台设备没有可用的语音识别服务。' };
    }
    return { available: true, onDevice: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition() };
  },

  async recognize(language, signal, onPartial) {
    if (signal.aborted) throw abortError();
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) throw new Error(errorMessages['not-allowed']);

    return new Promise<string>((resolve, reject) => {
      let transcript = '';
      let settled = false;
      const subscriptions = [
        ExpoSpeechRecognitionModule.addListener('result', (event) => {
          const text = event.results[0]?.transcript ?? '';
          if (!text) return;
          transcript = text;
          if (event.isFinal) finish(() => resolve(text)); else onPartial?.(text);
        }),
        ExpoSpeechRecognitionModule.addListener('error', (event) => {
          if (event.error === 'aborted') return finish(() => reject(abortError()));
          finish(() => reject(new Error(errorMessages[event.error] ?? `语音识别失败（${event.error}）。`)));
        }),
        // `end` is always last; an end without a final result still returns whatever was heard.
        ExpoSpeechRecognitionModule.addListener('end', () => finish(() => (transcript ? resolve(transcript) : reject(new Error(errorMessages['no-speech']))))),
      ];
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        for (const subscription of subscriptions) subscription.remove();
        settle();
      };
      const onAbort = () => { ExpoSpeechRecognitionModule.abort(); finish(() => reject(abortError())); };
      signal.addEventListener('abort', onAbort, { once: true });

      ExpoSpeechRecognitionModule.start({
        lang: language,
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        // On-device is preferred only when the system offers it; a missing model must not block recognition.
        requiresOnDeviceRecognition: false,
      });
    });
  },
};
