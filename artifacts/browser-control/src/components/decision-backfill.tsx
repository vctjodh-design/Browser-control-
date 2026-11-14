import { useCallback, useEffect, useRef, useState } from 'react';
import { History, LoaderCircle, Pause, Play } from 'lucide-react';
import {
  loadBackfillStatus,
  pauseBackfillRun,
  startBackfillRange,
  type BackfillStatus,
} from '@/lib/decision-tree';

// Reading the past back in.
//
// A finished fixture still has its board, so settling it now answers the question
// the app would have asked before kick-off — which is how the ledger gets hundreds
// of marked lines instead of two. The queue runs on the server at one fixture per
// few seconds, so this only has to start it, stop it and show where it is.

function isoDay(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function DecisionBackfill({ onSettled }: { onSettled?: () => void }) {
  const [from, setFrom] = useState(() => isoDay(-14));
  const [to, setTo] = useState(() => isoDay(-1));
  const [cards, setCards] = useState(false);
  const [status, setStatus] = useState<BackfillStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const settledBefore = useRef(0);

  const read = useCallback(async () => {
    try {
      const next = await loadBackfillStatus();
      setStatus(next);
      setError('');
      if (next.done > settledBefore.current) {
        settledBefore.current = next.done;
        onSettled?.();
      }
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The backfill could not be read.');
      return null;
    }
  }, [onSettled]);

  useEffect(() => {
    void read();
  }, [read]);

  // Only poll while something is actually running; a stopped queue costs nothing.
  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(() => void read(), 5000);
    return () => clearInterval(timer);
  }, [status?.running, read]);

  const start = async () => {
    setBusy(true);
    try {
      const next = await startBackfillRange(from, to, { cards, cardLimit: 200 });
      setStatus(next);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That range could not be queued.');
    } finally {
      setBusy(false);
    }
  };

  const pause = async () => {
    setBusy(true);
    try {
      setStatus(await pauseBackfillRun());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The backfill could not be paused.');
    } finally {
      setBusy(false);
    }
  };

  const remaining = status ? status.queued + (status.working ? 1 : 0) : 0;

  return (
    <section
      className="mb-5 overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]"
      data-testid="section-decision-backfill"
    >
      <div className="border-b border-[#e1dfd7] bg-[#f1f0e9] px-4 py-3 sm:px-6">
        <p className="mono flex items-center gap-1.5 text-[9px] uppercase tracking-[.17em] text-[#9b7160]">
          <History size={11} /> Past fixtures
        </p>
        <p className="mt-0.5 max-w-[560px] text-[10px] leading-5 text-[#858780]">
          Settle the cards of finished matches and mark them at full time. Each one is a real board read, taken one at a
          time; the queue survives a restart.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 px-4 py-3 sm:px-6">
        <label className="flex flex-col gap-1">
          <span className="mono text-[8px] uppercase tracking-[.14em] text-[#9a9c93]">From</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className="mono rounded-lg border border-[#dcd9d0] bg-white px-2 py-1.5 text-[10px] text-[#2b3e49] outline-none focus:border-[#b9b7ab]"
            data-testid="input-backfill-from"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono text-[8px] uppercase tracking-[.14em] text-[#9a9c93]">To</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            className="mono rounded-lg border border-[#dcd9d0] bg-white px-2 py-1.5 text-[10px] text-[#2b3e49] outline-none focus:border-[#b9b7ab]"
            data-testid="input-backfill-to"
          />
        </label>

        <label className="flex items-center gap-1.5 pb-1.5 text-[9.5px] text-[#7d827d]" title="Results are one feed call per date; cards are a board read each.">
          <input
            type="checkbox"
            checked={cards}
            onChange={(event) => setCards(event.target.checked)}
            className="size-3 rounded border-[#dcd9d0] accent-[#2b3e49]"
            data-testid="checkbox-backfill-cards"
          />
          settle their cards too
        </label>

        {status?.running ? (
          <button
            type="button"
            onClick={() => void pause()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#dcd9d0] bg-white px-3 py-1.5 text-[10px] font-bold text-[#4c5a63] transition hover:bg-[#f4f3ec] disabled:opacity-40"
            data-testid="button-backfill-pause"
          >
            <Pause size={11} /> Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2b3e49] px-3 py-1.5 text-[10px] font-bold text-[#f6f3ea] transition hover:bg-[#22323b] disabled:opacity-40"
            data-testid="button-backfill-start"
          >
            {busy ? <LoaderCircle size={11} className="animate-spin" /> : <Play size={11} />} Read the past
          </button>
        )}
      </div>

      {error && (
        <p className="px-4 pb-3 text-[10px] text-[#8c6b5e] sm:px-6" data-testid="status-backfill-error">
          {error}
        </p>
      )}

      {status && (
        <p
          className="mono border-t border-[#e8e6dd] px-4 py-2 text-[8px] uppercase tracking-[.12em] text-[#8f9188] sm:px-6"
          data-testid="status-backfill"
        >
          {status.running ? (status.working ? 'reading' : 'next fixture') : 'stopped'} · {remaining} left ·{' '}
          {status.done} marked · {status.skipped} no board
          {status.failed > 0 ? ` · ${status.failed} failed` : ''}
          {status.history ? ` · ${status.history.matches} in history` : ''}
          {status.current ? ` · #${status.current}` : ''}
        </p>
      )}
    </section>
  );
}
