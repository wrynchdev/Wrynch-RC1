// Voice notes: a big microphone button that turns speech into the technician's note. Uses the phone's own speech
// recognition when it has one (Safari and Chrome do), or records and has the server turn it into text. Either way the
// words land in the note field for the technician to read and edit; nothing is sent to the customer from here.
import { useEffect, useRef, useState } from 'react';
import { actions, toast } from '../state/store';
import { Icon } from './kit';

type Recognition = {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const SpeechRecognitionCtor = (): (new () => Recognition) | null => {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
};
export const canDictate = () => typeof window !== 'undefined'
  && (!!SpeechRecognitionCtor() || (typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia));

/** First letter capitalised, trimmed. */
const tidy = (t: string) => { const s = t.trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

export function MicButton({ inspId, onText, disabled }: { inspId: string; onText: (text: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'listening' | 'working'>('idle');
  const [heard, setHeard] = useState('');
  const rec = useRef<Recognition | null>(null);
  const media = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[] } | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => { rec.current?.abort(); media.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const start = async () => {
    const SR = SpeechRecognitionCtor();
    if (SR) {
      const r = new SR();
      r.continuous = true; r.interimResults = true; r.lang = navigator.language || 'en-US';
      r.onresult = (e) => {
        let finalText = '', interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript;
        }
        if (finalText.trim()) (onTextRef.current as (t: string) => void)(tidy(finalText));
        setHeard(interim);
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone access is off. Allow it for this site in your browser settings.', 'error');
        else if (e.error !== 'no-speech' && e.error !== 'aborted') toast(`Voice note stopped (${e.error}).`, 'error');
      };
      r.onend = () => { setState('idle'); setHeard(''); rec.current = null; };
      rec.current = r;
      try { r.start(); setState('listening'); } catch { toast('Couldn’t start listening. Try again.', 'error'); }
      return;
    }
    // No built-in recognition: record, then let the server turn it into text.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        media.current = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!blob.size) { setState('idle'); return; }
        setState('working');
        try { const text = await actions.transcribe(inspId, blob); if (text) (onTextRef.current as (t: string) => void)(tidy(text)); else toast('Didn’t catch anything. Try again a little closer.'); }
        catch (e) { toast(e instanceof Error ? e.message : 'Couldn’t turn that into text', 'error'); }
        finally { setState('idle'); }
      };
      media.current = { recorder, stream, chunks };
      recorder.start();
      setState('listening');
    } catch {
      toast('Microphone access is off. Allow it for this site in your browser settings.', 'error');
    }
  };
  const stop = () => { rec.current?.stop(); if (media.current?.recorder.state === 'recording') media.current.recorder.stop(); };

  if (!canDictate()) return null;
  const listening = state === 'listening';
  return (
    <div className="mic-wrap">
      <button type="button" className={`mic${listening ? ' on' : ''}`} disabled={disabled || state === 'working'}
        aria-pressed={listening} aria-label={listening ? 'Stop voice note' : 'Speak a note'} onClick={() => (listening ? stop() : void start())}>
        <Icon name="mic" size={30} />
        <span>{state === 'working' ? 'Writing it down…' : listening ? 'Listening · tap to stop' : 'Speak a note'}</span>
      </button>
      {listening && <span className="small muted heard" aria-live="polite">{heard || 'Say what you found. Your words go into the note below.'}</span>}
    </div>
  );
}
