import { useEffect, useMemo, useState } from 'react';
import { BookOpen, LoaderCircle, RefreshCw } from 'lucide-react';
import { loadDecisionLedger, type LedgerStanding, type UpsetLevel } from '@/lib/decision-tree';

// The ledger readout: how each market's calls have actually held, in the band they
// were given before kick-off.
//
// This is the only place the app reports a rate, and it is a measured one — calls
// marked at full time, not a model's confidence. A band with no marked lines is
// left out rather than shown as a perfect record.

const BANDS: UpsetLevel[] = ['high', 'live', 'low'];

const BAND_TONE: Record<UpsetLevel, string> = {
  high: 'text-[#a4513a]',
  live: 'text-[#8a6a38]',
  low: 'text-[#5b7a63]',
};

export function DecisionLedger({ refreshKey = 0 }: { refreshKey?: number }) {
  const [standings, setStandings] = useState<LedgerStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [token, setToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    loadDecisionLedger(controller.signal)
      .then((rows) => setStandings(rows))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setStandings([]);
        setError(cause instanceof Error ? cause.message : 'The ledger could not be read.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, refreshKey]);

  const byMarket = useMemo(() => {
    const grouped = new Map<string, { label: string; bands: Map<UpsetLevel, LedgerStanding> }>();
    for (const row of standings) {
      const entry = grouped.get(row.marketId) ?? { label: row.label, bands: new Map<UpsetLevel, LedgerStanding>() };
      entry.bands.set(row.upsetLevel, row);
      grouped.set(row.marketId, entry);
    }
    return [...grouped.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [standings]);

  const marked = standings.reduce((sum, row) => sum + row.laid, 0);

  return (
    <section
      className="mb-5 overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]"
      data-testid="section-decision-ledger"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f1f0e9] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="mono flex items-center gap-1.5 text-[9px] uppercase tracking-[.17em] text-[#9b7160]">
            <BookOpen size={11} /> The ledger
          </p>
          <p className="mt-0.5 max-w-[560px] text-[10px] leading-5 text-[#858780]">
            Every line the cards called, marked against the final score. A rate here is measured, not claimed: it is
            how many of the calls in that band held.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setToken((value) => value + 1)}
          disabled={loading}
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#dcd9d0] bg-white text-[#7d827d] transition hover:bg-[#f4f3ec] disabled:opacity-40"
          aria-label="Re-read the ledger"
          data-testid="button-reload-ledger"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && standings.length === 0 && (
        <p className="flex items-center gap-2 px-4 py-4 text-[10px] text-[#93958b] sm:px-6">
          <LoaderCircle size={12} className="animate-spin" /> Reading the book
        </p>
      )}

      {error && (
        <p className="px-4 py-4 text-[10px] text-[#8c6b5e] sm:px-6" data-testid="status-ledger-error">
          {error}
        </p>
      )}

      {!loading && !error && marked === 0 && (
        <p className="px-4 py-4 text-[10px] leading-5 text-[#93958b] sm:px-6" data-testid="status-ledger-empty">
          Nothing marked yet. Lines are written when a card is settled and marked once that match is final, so this fills
          as dates are worked through.
        </p>
      )}

      {marked > 0 && (
        <ul className="divide-y divide-[#e8e6dd]" data-testid="list-ledger-standings">
          {byMarket.map(([marketId, entry]) => (
            <li key={marketId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6">
              <span className="min-w-0 flex-1 basis-[180px] truncate text-[10.5px] font-bold text-[#2b3e49]">
                {entry.label}
              </span>
              <span className="mono flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[9px]">
                {BANDS.map((band) => {
                  const row = entry.bands.get(band);
                  if (!row) return null;
                  return (
                    <span key={band} className={BAND_TONE[band]} data-testid={`ledger-${marketId}-${band}`}>
                      {band} {row.held}/{row.laid}
                      <span className="text-[#9a9c93]"> · {row.rate}%</span>
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {marked > 0 && (
        <p className="mono border-t border-[#e8e6dd] px-4 py-2 text-[8px] uppercase tracking-[.12em] text-[#a0a29a] sm:px-6">
          {marked} marked lines · held first, then how many
        </p>
      )}
    </section>
  );
}
