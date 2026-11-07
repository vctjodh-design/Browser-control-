import { useEffect, useState } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { loadInevitability, type InevitabilityVerdict } from '@/lib/inevitability';
import { Cascade, LynchpinCard, Reasoning, Script, VerdictHeader } from '@/components/inevitability-verdict';

// The match page's Inevitability tab: the same fixture resolved once, on the
// squads alone. It sits next to Player duels on purpose — that tab samples the
// board two thousand times, this one plays it once and prints why.

export function InevitabilityPanel({ fixtureId }: { fixtureId: number }) {
  const [verdict, setVerdict] = useState<InevitabilityVerdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setVerdict(null);
    loadInevitability(fixtureId, controller.signal)
      .then((next) => setVerdict(next))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'The fixture could not be resolved.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [fixtureId]);

  if (loading) {
    return (
      <section
        className="flex min-h-[240px] flex-col items-center justify-center rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]"
        role="status"
        data-testid="status-inevitability-loading"
      >
        <LoaderCircle size={20} className="animate-spin text-[#b09a8c]" />
        <p className="mt-3 text-[11px] font-bold text-[#6b7772]">Reading the two squads</p>
        <p className="mt-1 text-[10px] text-[#93958b]">Pricing every contest, then playing the match once.</p>
      </section>
    );
  }

  if (error || !verdict) {
    return (
      <section
        className="flex items-start gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] px-4 py-3.5"
        role="alert"
        data-testid="status-inevitability-error"
      >
        <CircleAlert size={16} className="mt-0.5 shrink-0 text-[#b85b46]" />
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-[#784b3e]">This fixture could not be resolved.</p>
          <p className="mt-1 text-[10px] leading-5 text-[#8c6b5e]">
            {error || 'The squads returned no contest to read.'}
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4" data-testid="panel-inevitability">
      <VerdictHeader verdict={verdict} showMatchLink={false} />
      <LynchpinCard verdict={verdict} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Cascade verdict={verdict} />
        <Script verdict={verdict} />
      </div>
      <Reasoning verdict={verdict} />
      <p className="px-1 text-[10px] leading-5 text-[#93958b]">{verdict.note}</p>
    </div>
  );
}
