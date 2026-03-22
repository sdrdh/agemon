/**
 * Voice Input extension component.
 * Uses the browser's SpeechRecognition API to dictate messages.
 *
 * Props are provided by the Agemon host (InputExtensionProps):
 *   onInsert(text)  — append text to the textarea
 *   onSend(text)    — insert text and send immediately
 *   onClose()       — close this panel
 *   connected       — WebSocket connection state
 *   sessionState    — e.g. 'running', 'ready', 'stopped'
 */
import { useState, useRef, useEffect } from 'react';

// SpeechRecognition is a browser global not in standard TS lib
declare const SpeechRecognition: new () => SpeechRecognitionInstance;
declare const webkitSpeechRecognition: new () => SpeechRecognitionInstance;

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface Props {
  onInsert: (text: string) => void;
  onSend: (text: string) => void;
  onClose: () => void;
  connected: boolean;
  sessionState: string;
}

const SpeechAPI = typeof SpeechRecognition !== 'undefined'
  ? SpeechRecognition
  : typeof webkitSpeechRecognition !== 'undefined'
    ? webkitSpeechRecognition
    : null;

export default function VoiceInput({ onSend, onClose }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  if (!SpeechAPI) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>Voice input is not supported in this browser.</span>
        <button type="button" onClick={onClose} className="text-xs underline">
          Close
        </button>
      </div>
    );
  }

  function startRecording() {
    setError(null);
    setPartial('');
    const recognition = new SpeechAPI!();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setPartial(interim || final);
      if (final) {
        setIsRecording(false);
        onSend(final.trim());
        setPartial('');
      }
    };

    recognition.onerror = (e: { error: string }) => {
      setError(e.error === 'not-allowed' ? 'Microphone access denied.' : `Error: ${e.error}`);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }

  function stopRecording() {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          isRecording
            ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            : 'bg-primary text-primary-foreground hover:bg-primary/90'
        }`}
      >
        <span className={isRecording ? 'animate-pulse' : ''}>●</span>
        {isRecording ? 'Stop' : 'Start recording'}
      </button>

      <span className="flex-1 text-sm text-muted-foreground truncate">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : partial ? (
          partial
        ) : isRecording ? (
          'Listening...'
        ) : (
          'Press Start to dictate'
        )}
      </span>

      <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
        ✕
      </button>
    </div>
  );
}
