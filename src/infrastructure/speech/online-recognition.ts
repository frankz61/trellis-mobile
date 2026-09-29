import { fetch } from 'expo/fetch';
import {
  AudioModule, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import type { OnlineAudioConfig, SpeechRecognitionGateway } from '../../contracts/speech';
import { maxRecordingSeconds } from '../../domain/voice';
import { createTranscriber } from './online-audio-api';

const preset = RecordingPresets.HIGH_QUALITY;
// Speech needs neither stereo nor 44.1 kHz: 16 kHz mono AAC keeps a full minute under 0.5 MB.
// The native recorder takes the platform-flattened form that useAudioRecorder builds internally.
const recordingOptions = {
  extension: preset.extension,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: false,
  ...(Platform.OS === 'ios' ? preset.ios : preset.android),
} as Partial<RecordingOptions>;

function abortError(): Error {
  return Object.assign(new Error('识别已取消。'), { name: 'AbortError' });
}

// Resolves when the learner finishes or the time limit is reached; rejects when cancelled.
function recordingEnd(signal: AbortSignal, finish: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      finish?.removeEventListener('abort', done);
    };
    const done = () => { cleanup(); resolve(); };
    const cancel = () => { cleanup(); reject(abortError()); };
    const timer = setTimeout(done, maxRecordingSeconds * 1000);
    if (signal.aborted) return cancel();
    if (finish?.aborted) return done();
    signal.addEventListener('abort', cancel, { once: true });
    finish?.addEventListener('abort', done, { once: true });
  });
}

// Records one utterance to a temporary file, then uploads it to the configured transcription endpoint.
// The recording is deleted afterwards whatever the outcome.
export function createOnlineRecognition(config: OnlineAudioConfig): SpeechRecognitionGateway {
  const transcriber = createTranscriber(config, fetch);
  return {
    async capability() {
      return { available: true, mode: 'manual', privacyNote: '这段录音已上传到你配置的语音识别服务。' };
    },

    async recognize(language, signal, options) {
      if (signal.aborted) throw abortError();
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('没有麦克风权限，请在系统设置中允许。');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      const recorder = new AudioModule.AudioRecorder(recordingOptions);
      let file: File | null = null;
      try {
        try {
          await recorder.prepareToRecordAsync();
          recorder.record();
        } catch {
          throw new Error('无法开始录音，请检查麦克风是否被其他应用占用。');
        }
        await recordingEnd(signal, options?.finish);
        await recorder.stop();
        if (!recorder.uri) throw new Error('没有录到声音，请再试一次。');
        file = new File(recorder.uri);
        options?.onTranscribing?.();
        const text = await transcriber.transcribe(file, language, signal);
        if (!text) throw new Error('没有听到说话内容，请再试一次。');
        return text;
      } finally {
        if (recorder.isRecording) await recorder.stop().catch(() => undefined);
        recorder.release();
        await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
        try { if (file?.exists) file.delete(); } catch { /* the cache is cleared by the system eventually */ }
      }
    },
  };
}
