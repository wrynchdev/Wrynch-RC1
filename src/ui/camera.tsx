// In-app camera for burst capture. The phone's own camera (a file input with `capture`) returns one photo per
// launch, so this keeps a live viewfinder open instead: tap the shutter for each shot, or hold it to fire a burst.
// Every shot carries the corner picked in the viewfinder, and uploads in the background while the tech keeps shooting.
import { useEffect, useRef, useState } from 'react';
import { CORNER_LABEL, CORNER_SHORT, CORNERS, type Corner } from '../domain/corner';
import { actions } from '../state/store';
import { Icon } from './kit';

const BURST_MS = 350; // about three shots a second while the shutter is held

export function CameraSheet({ inspId, sectionId, stageName, corner, onCorner, onShot, onClose, onUnavailable }: {
  inspId: string; sectionId: string; stageName: string;
  corner: Corner | null; onCorner: (c: Corner | null) => void;
  onShot: (corner: Corner | null) => void; onClose: () => void; onUnavailable: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const cornerRef = useRef(corner);
  cornerRef.current = corner;
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [pending, setPending] = useState(0);
  const [flash, setFlash] = useState(0);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false,
        });
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => undefined); }
        setReady(true);
      } catch {
        if (!stopped) unavailable.current!(); // no camera, or permission denied: fall back to the phone's camera app
      }
    })();
    return () => {
      stopped = true;
      if (timer.current) window.clearInterval(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const tag = cornerRef.current;
    setFlash((n) => n + 1);
    setCount((n) => n + 1);
    onShot(tag);
    setPending((n) => n + 1);
    c.toBlob((blob) => {
      if (!blob) { setPending((n) => n - 1); return; }
      const name = `IMG_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      const file = new File([blob], name, { type: 'image/jpeg' });
      const url = URL.createObjectURL(file);
      setLast(url);
      // One upload at a time, in shooting order, without a busy banner over the viewfinder.
      queue.current = queue.current!.then(() => actions.addPhotos(inspId, sectionId, [{ url, name, file }], undefined, tag, true))
        .catch(() => undefined).finally(() => setPending((n) => n - 1));
    }, 'image/jpeg', 0.9);
  };
  const press = () => { shoot(); timer.current = window.setInterval(shoot, BURST_MS); };
  const release = () => { if (timer.current) { window.clearInterval(timer.current); timer.current = null; } };

  return (
    <div className="cam" role="dialog" aria-label={`Camera · ${stageName}`}>
      <video ref={video} className="cam-view" playsInline muted autoPlay />
      {flash > 0 && <div key={flash} className="cam-flash" />}
      <div className="cam-top">
        <button className="cam-x" onClick={onClose} aria-label="Close camera"><Icon name="close" size={24} /></button>
        <div className="cam-title"><strong>{stageName}</strong><span>{corner ? CORNER_LABEL[corner] : 'No corner'}</span></div>
        <span className="cam-count" role="status">{count} {count === 1 ? 'photo' : 'photos'}{pending > 0 ? ` · saving ${pending}` : ''}</span>
      </div>
      {!ready && <div className="cam-wait">Starting camera…</div>}
      <div className="cam-bottom">
        <div className="cam-corners" role="group" aria-label="Corner of the vehicle">
          {CORNERS.map((c) => (
            <button key={c} className="cam-corner" aria-pressed={corner === c} onClick={() => onCorner(corner === c ? null : c)}
              aria-label={CORNER_LABEL[c]}>{CORNER_SHORT[c]}</button>
          ))}
        </div>
        <div className="cam-row">
          <div className="cam-last">{last && <img src={last} alt="Last photo" />}</div>
          <button className="cam-shutter" disabled={!ready} aria-label="Take photo (hold for a burst)"
            onPointerDown={(e) => { e.preventDefault(); press(); }} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
            onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); shoot(); } }} />
          <button className="cam-done" onClick={onClose}>Done</button>
        </div>
        <div className="cam-hint">Tap for one photo · hold for a burst</div>
      </div>
    </div>
  );
}
