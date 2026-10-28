import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { CircleAlert, CircleStop, Crosshair, MonitorUp, ShieldCheck } from 'lucide-react';

type NormalizedPoint = { x: number; y: number };
type BallSample = NormalizedPoint & { similarity: number; sampledAt: number };
type Template = { pixels: Uint8ClampedArray; size: number; radius: number };
type Tracker = {
  x: number;
  y: number;
  width: number;
  height: number;
  template: Template;
};

const MAX_SAMPLE_WIDTH = 520;
const TEMPLATE_RADIUS = 8;
const SEARCH_STEP = 2;
const MAX_HISTORY = 48;

function sampleVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  if (!video.videoWidth || !video.videoHeight) return null;

  const scale = Math.min(1, MAX_SAMPLE_WIDTH / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  return { image: context.getImageData(0, 0, width, height), width, height };
}

function makeTemplate(
  image: ImageData,
  centerX: number,
  centerY: number,
): Template | null {
  const radius = TEMPLATE_RADIUS;
  const size = radius * 2 + 1;
  const left = Math.round(centerX) - radius;
  const top = Math.round(centerY) - radius;
  if (left < 0 || top < 0 || left + size > image.width || top + size > image.height) {
    return null;
  }

  const pixels = new Uint8ClampedArray(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const source = ((top + y) * image.width + left + x) * 4;
      const target = (y * size + x) * 3;
      pixels[target] = image.data[source];
      pixels[target + 1] = image.data[source + 1];
      pixels[target + 2] = image.data[source + 2];
    }
  }
  return { pixels, size, radius };
}

function findTemplateMatch(image: ImageData, tracker: Tracker) {
  const { radius, size, pixels } = tracker.template;
  if (image.width !== tracker.width || image.height !== tracker.height) return null;

  const maxSearch = Math.max(24, Math.round(Math.min(image.width, image.height) * 0.12));
  const minX = Math.max(radius, Math.round(tracker.x) - maxSearch);
  const maxX = Math.min(image.width - radius - 1, Math.round(tracker.x) + maxSearch);
  const minY = Math.max(radius, Math.round(tracker.y) - maxSearch);
  const maxY = Math.min(image.height - radius - 1, Math.round(tracker.y) + maxSearch);
  let best: { x: number; y: number; similarity: number } | null = null;

  for (let centerY = minY; centerY <= maxY; centerY += SEARCH_STEP) {
    for (let centerX = minX; centerX <= maxX; centerX += SEARCH_STEP) {
      let error = 0;
      let weightTotal = 0;
      for (let patchY = 0; patchY < size; patchY += 1) {
        for (let patchX = 0; patchX < size; patchX += 1) {
          const distanceX = patchX - radius;
          const distanceY = patchY - radius;
          const weight = Math.max(
            0.2,
            1 - (distanceX * distanceX + distanceY * distanceY) / (2 * radius * radius),
          );
          const source = ((centerY - radius + patchY) * image.width + centerX - radius + patchX) * 4;
          const target = (patchY * size + patchX) * 3;
          error += (
            Math.abs(image.data[source] - pixels[target]) +
            Math.abs(image.data[source + 1] - pixels[target + 1]) +
            Math.abs(image.data[source + 2] - pixels[target + 2])
          ) / 3 * weight;
          weightTotal += weight;
        }
      }

      const similarity = Math.max(0, 1 - error / (weightTotal * 255));
      if (!best || similarity > best.similarity) {
        best = { x: centerX, y: centerY, similarity };
      }
    }
  }
  return best;
}

function captureErrorMessage(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error
    ? String(error.name)
    : '';
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return 'Screen sharing was cancelled or blocked. Choose the 365Scores tab and allow sharing.';
  }
  if (name === 'InvalidStateError') {
    return 'The browser needs this app in a top-level tab. Open the app in a new tab and try again.';
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'The browser could not start screen sharing. Try desktop Chrome or Edge.';
}

export function LiveScreenCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureSurface, setCaptureSurface] = useState('shared tab or screen');
  const [isMarkingBall, setIsMarkingBall] = useState(false);
  const [seed, setSeed] = useState<NormalizedPoint | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState('Not tracking');
  const [samples, setSamples] = useState<BallSample[]>([]);
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  const captureSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  const stopCapture = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    trackerRef.current = null;
    setStream(null);
    setVideoReady(false);
    setIsTracking(false);
    setIsMarkingBall(false);
    setSeed(null);
    setSamples([]);
    setSimilarity(null);
    setTrackingStatus('Not tracking');
    setCaptureError(null);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!stream) {
      video.pause();
      video.srcObject = null;
      return;
    }

    video.srcObject = stream;
    void video.play().catch(() => {
      setCaptureError('The shared tab preview could not start. Try stopping and sharing the tab again.');
    });
  }, [stream]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCapture = async () => {
    setCaptureError(null);
    if (!window.isSecureContext) {
      setCaptureError('Screen sharing requires a secure browser tab. Open the app over HTTPS and try again.');
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setCaptureError('This browser does not support tab sharing. Try desktop Chrome or Edge.');
      return;
    }

    try {
      const nextStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 8, max: 12 } },
        audio: false,
      });
      streamRef.current = nextStream;
      const displaySurface = nextStream.getVideoTracks()[0]?.getSettings().displaySurface;
      setCaptureSurface(displaySurface || 'shared tab or screen');
      nextStream.getVideoTracks()[0]?.addEventListener('ended', stopCapture, { once: true });
      setStream(nextStream);
      setTrackingStatus('Shared locally · mark the ball to begin');
    } catch (error) {
      setCaptureError(captureErrorMessage(error));
    }
  };

  const handleVideoClick = (event: MouseEvent<HTMLVideoElement>) => {
    if (!isMarkingBall) return;
    const video = videoRef.current;
    if (!video) return;
    const bounds = video.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
    setSeed(point);
    setIsMarkingBall(false);
    setIsTracking(false);
    trackerRef.current = null;
    setSamples([{ ...point, similarity: 1, sampledAt: Date.now() }]);
    setSimilarity(null);
    setTrackingStatus('Ball marked · start local tracking');
  };

  const startTracking = () => {
    const video = videoRef.current;
    const canvas = sampleCanvasRef.current;
    if (!video || !canvas || !seed || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setTrackingStatus('Wait for the shared tab preview, then mark the ball again');
      return;
    }

    const frame = sampleVideoFrame(video, canvas);
    if (!frame) {
      setTrackingStatus('The shared frame could not be read');
      return;
    }
    const x = seed.x * frame.width;
    const y = seed.y * frame.height;
    const template = makeTemplate(frame.image, x, y);
    if (!template) {
      setTrackingStatus('Mark the ball farther from the edge of the shared frame');
      return;
    }

    trackerRef.current = {
      x,
      y,
      width: frame.width,
      height: frame.height,
      template,
    };
    setSamples([{ ...seed, similarity: 1, sampledAt: Date.now() }]);
    setSimilarity(1);
    setTrackingStatus('Tracking the marked visual pattern locally');
    setIsTracking(true);
  };

  useEffect(() => {
    if (!isTracking || !stream) return;
    let frameHandle = 0;
    let lastSampleAt = 0;

    const processFrame = (timestamp: number) => {
      if (timestamp - lastSampleAt >= 250) {
        lastSampleAt = timestamp;
        const video = videoRef.current;
        const canvas = sampleCanvasRef.current;
        const tracker = trackerRef.current;
        if (video && canvas && tracker && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const frame = sampleVideoFrame(video, canvas);
          if (frame) {
            const candidate = findTemplateMatch(frame.image, tracker);
            if (candidate && candidate.similarity >= 0.5) {
              tracker.x = candidate.x;
              tracker.y = candidate.y;
              setSimilarity(candidate.similarity);
              setTrackingStatus(
                candidate.similarity >= 0.68
                  ? 'Tracking · template match is provisional'
                  : 'Low match · re-mark the ball if the marker drifts',
              );
              const point = {
                x: candidate.x / frame.width,
                y: candidate.y / frame.height,
                similarity: candidate.similarity,
                sampledAt: Date.now(),
              };
              setSamples((current) => [...current, point].slice(-MAX_HISTORY));
            } else {
              setSimilarity(candidate?.similarity ?? null);
              setTrackingStatus('Marker lost · re-mark the ball to resume');
            }
          }
        }
      }
      frameHandle = window.requestAnimationFrame(processFrame);
    };

    frameHandle = window.requestAnimationFrame(processFrame);
    return () => window.cancelAnimationFrame(frameHandle);
  }, [isTracking, stream]);

  const latest = samples.at(-1);
  const pathPoints = samples
    .map((point) => `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`)
    .join(' ');

  return (
    <section
      className="rounded-xl border border-[#d9e0d6] bg-[#f8faf5] p-4"
      data-testid="section-live-screen-capture"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[#e8efe6] text-[#58705e]">
            <MonitorUp size={15} />
          </span>
          <div>
            <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Opt-in visual prototype</p>
            <h3 className="mt-1 text-[12px] font-extrabold text-[#344550]">Capture the live pitch</h3>
            <p className="mt-1 max-w-2xl text-[9px] leading-5 text-[#727973]">
              Share the 365Scores tab, then mark the ball in the preview. A local template tracker follows that marker; it is not a trained model.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d9dfd5] bg-white px-2.5 py-1.5 text-[8px] font-extrabold uppercase tracking-wide text-[#68796e]" data-testid="status-screen-capture">
          <span className={`size-1.5 rounded-full ${stream ? 'bg-[#4c9c6b]' : 'bg-[#a5aaa1]'}`} />
          {stream ? 'Sharing' : 'Stopped'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!stream ? (
          <button
            type="button"
            onClick={() => { void startCapture(); }}
            disabled={!captureSupported}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#314d40] px-3.5 text-[9px] font-extrabold text-[#f7f2e6] hover:bg-[#263f34] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-start-screen-capture"
          >
            <MonitorUp size={13} /> Share a tab or screen
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => { setIsTracking(false); setIsMarkingBall(true); setTrackingStatus('Click the ball marker in the preview'); }}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#cfd9ce] bg-white px-3 text-[9px] font-extrabold text-[#455b4c] hover:bg-[#f0f5ef]"
              data-testid="button-mark-ball"
            >
              <Crosshair size={13} /> {seed ? 'Re-mark ball' : 'Mark the ball'}
            </button>
            {seed && !isTracking && (
              <button
                type="button"
                onClick={startTracking}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#314d40] px-3 text-[9px] font-extrabold text-[#f7f2e6] hover:bg-[#263f34]"
                data-testid="button-start-visual-tracking"
              >
                <Crosshair size={13} /> Start local tracking
              </button>
            )}
            <button
              type="button"
              onClick={stopCapture}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#e3c3b6] bg-[#fff7f2] px-3 text-[9px] font-extrabold text-[#9a5544] hover:bg-white"
              data-testid="button-stop-screen-capture"
            >
              <CircleStop size={13} /> Stop sharing
            </button>
          </>
        )}
      </div>

      {captureError && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-3 py-2.5 text-[9px] leading-5 text-[#8c5c4e]" role="alert" data-testid="status-screen-capture-error">
          <CircleAlert size={13} className="mt-0.5 shrink-0" /> {captureError}
        </p>
      )}
      {!captureSupported && (
        <p className="mt-3 rounded-lg border border-[#e5d8bd] bg-[#fffaf0] px-3 py-2 text-[9px] leading-5 text-[#806d4f]" data-testid="status-screen-capture-unsupported">
          This browser does not expose tab sharing. Try desktop Chrome or Edge, and open the app in its own tab if the embedded preview blocks sharing.
        </p>
      )}

      {stream ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-[#d7ded5] bg-[#17231d]">
          <div className="max-h-[62vh] overflow-auto">
            <div className="relative w-full">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={() => setVideoReady(true)}
                onClick={handleVideoClick}
                className={`block h-auto w-full ${isMarkingBall ? 'cursor-crosshair' : ''}`}
                aria-label={isMarkingBall ? 'Click the ball marker in the shared tab preview' : 'Shared tab preview'}
                data-testid="video-shared-tab-preview"
              />
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                aria-hidden="true"
                data-testid="overlay-ball-track"
              >
                {samples.length > 1 && (
                  <polyline points={pathPoints} fill="none" stroke="#f4a261" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
                )}
                {seed && (
                  <circle cx={seed.x * 1000} cy={seed.y * 1000} r="16" fill="none" stroke="#fff" strokeWidth="5" />
                )}
                {latest && (
                  <circle cx={latest.x * 1000} cy={latest.y * 1000} r="11" fill="#ef6b4a" stroke="#fff" strokeWidth="4" />
                )}
              </svg>
              {isMarkingBall && (
                <div className="pointer-events-none absolute inset-x-2 top-2 rounded-md bg-[#17231d]/90 px-3 py-2 text-center text-[9px] font-bold text-white" role="status" data-testid="status-mark-ball-instruction">
                  Click the white ball marker in the shared preview
                </div>
              )}
              {!videoReady && (
                <div className="absolute inset-0 grid place-items-center bg-[#17231d] text-[9px] text-white/80" role="status" data-testid="status-screen-preview-loading">
                  Waiting for the shared tab…
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-[8px] text-white/75">
            <span data-testid="text-capture-surface">Source: {captureSurface}</span>
            <span data-testid="text-visual-tracking-status">{trackingStatus}</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid min-h-32 place-items-center rounded-lg border border-dashed border-[#ccd6ca] bg-white px-4 py-5 text-center" data-testid="status-screen-capture-empty">
          <div>
            <MonitorUp size={18} className="mx-auto text-[#718579]" />
            <p className="mt-2 text-[9px] font-bold text-[#506256]">Choose the 365Scores browser tab</p>
            <p className="mt-1 max-w-md text-[8px] leading-4 text-[#858982]">
              Start sharing, select the match tab in the browser prompt, then click the moving ball in the preview. Do not choose this analyzer tab.
            </p>
          </div>
        </div>
      )}

      <canvas ref={sampleCanvasRef} className="hidden" aria-hidden="true" data-testid="canvas-local-frame-sampler" />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#dfe5db] bg-[#f0f4ed] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[8px] leading-4 text-[#66766b]" data-testid="text-capture-privacy">
          <ShieldCheck size={12} className="shrink-0" /> Frames stay in this browser; nothing is recorded, saved, or uploaded.
        </p>
        <p className="mono text-[8px] text-[#899087]" data-testid="text-template-similarity">
          {latest ? `Marker ${Math.round(latest.x * 100)}% / ${Math.round(latest.y * 100)}%` : 'No marker selected'}
          {similarity !== null && isTracking ? ` · similarity ${Math.round(similarity * 100)}%` : ''}
        </p>
      </div>
    </section>
  );
}
