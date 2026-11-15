import { useCallback, useEffect, useState } from 'react';
import { Dna, LoaderCircle } from 'lucide-react';
import {
  loadTeamDna,
  startTeamDna,
  type DnaResponse,
  type DnaTrait,
  type TeamDna,
} from '@/lib/decision-tree';

// What each side actually is, from its own last matches.
//
// A result says who won; this says how. Expected goals against actual goals, big
// chances taken and missed, when the goals arrived, whether leads held and deficits
// were rescued, and what the players were rated while doing it. Fifty matches of
// that is the closest thing to a team's DNA the feed can give.

function formatTrait(trait: DnaTrait): string {
  if (trait.unit === 'share') return `${Math.round(trait.value)}%`;
  if (trait.unit === 'rating') return trait.value.toFixed(2);
  if (trait.unit === 'count') return String(Math.round(trait.value));
  return trait.value.toFixed(2);
}

const GROUPS: Array<{ key: keyof Pick<TeamDna, 'identity' | 'dynamics' | 'pressure' | 'mistakes'>; title: string }> = [
  { key: 'identity', title: 'Identity' },
  { key: 'dynamics', title: 'Dynamics' },
  { key: 'pressure', title: 'Pressure' },
  { key: 'mistakes', title: 'Mistakes & quality' },
];

function DnaColumn({ data }: { data: DnaResponse }) {
  const { dna, coverage } = data;
  return (
    <div className="min-w-0 rounded-[13px] border border-[#e0ded5] bg-white/70 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="truncate text-[12px] font-extrabold text-[#2b3e49]" data-testid="text-dna-team">
          {dna.team}
        </p>
        <p className="mono text-[8px] uppercase tracking-[.12em] text-[#9a9c93]" data-testid="text-dna-coverage">
          {coverage.stored}/{coverage.expected || dna.matches} matches read
          {coverage.empty ? ` · ${coverage.empty} without detail` : ''}
        </p>
      </div>
      <p className="mono mt-0.5 text-[8.5px] uppercase tracking-[.1em] text-[#9a9c93]">
        {dna.matches} in window · {dna.record.wins}W {dna.record.draws}D {dna.record.losses}L ·{' '}
        {dna.record.goalsFor}–{dna.record.goalsAgainst}
      </p>
      <p className="mono mt-0.5 text-[8px] uppercase tracking-[.1em] text-[#a39b8e]" data-testid="text-dna-ageing">
        weighted to the recent side · half after {dna.halfLifeDays ?? 90} days
      </p>

      {dna.matches === 0 ? (
        <p className="mt-2 text-[10px] leading-5 text-[#93958b]" data-testid="status-dna-empty">
          No match detail read yet for this side. Use “Read 50 matches” above; the queue works through it a match at a
          time.
        </p>
      ) : (
        <>
          <div className="mt-2 space-y-1.5">
            <p className="text-[10px] leading-5 text-[#5c6f63]">{dna.verdict.scoring}</p>
            <p className="text-[10px] leading-5 text-[#5c6f63]">{dna.verdict.control}</p>
            <p className="text-[10px] leading-5 text-[#5c6f63]">{dna.verdict.late}</p>
          </div>

          <div className="mt-3 space-y-2.5">
            {GROUPS.map((group) => {
              const traits = dna[group.key];
              if (!traits.length) return null;
              return (
                <div key={group.key}>
                  <p className="mono text-[7.5px] uppercase tracking-[.16em] text-[#9b7160]">{group.title}</p>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {traits.map((trait) => (
                      <div key={trait.label} className="flex items-baseline justify-between gap-2" title={trait.note}>
                        <dt className="min-w-0 truncate text-[9.5px] text-[#7d827d]">{trait.label}</dt>
                        <dd className="mono shrink-0 text-[9.5px] font-bold text-[#2b3e49]">{formatTrait(trait)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function TeamDnaSection({ home, away, asOf }: { home: string; away: string; asOf: string }) {
  const [data, setData] = useState<[DnaResponse | null, DnaResponse | null]>([null, null]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(0);

  const read = useCallback(async () => {
    const asOfDay = asOf || new Date().toISOString().slice(0, 10);
    try {
      const [homeDna, awayDna] = await Promise.all([loadTeamDna(home, asOfDay), loadTeamDna(away, asOfDay)]);
      setData([homeDna, awayDna]);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Team DNA could not be read.');
    }
  }, [home, away, asOf]);

  useEffect(() => {
    void read();
  }, [read, token]);

  // While a read is queued for either side, keep asking: each poll nudges the queue
  // that the server is already working through.
  const pending = (data[0]?.queue.queued ?? 0) + (data[1]?.queue.queued ?? 0);
  useEffect(() => {
    if (pending === 0) return;
    const timer = setInterval(() => setToken((value) => value + 1), 6000);
    return () => clearInterval(timer);
  }, [pending]);

  const startRead = async () => {
    const asOfDay = asOf || new Date().toISOString().slice(0, 10);
    setBusy(true);
    try {
      await Promise.all([startTeamDna(home, asOfDay), startTeamDna(away, asOfDay)]);
      setToken((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The read could not be started.');
    } finally {
      setBusy(false);
    }
  };

  // What is left to read across both sides, leaving out the matches the feed has no
  // detail for: those are not waiting on the queue, and promising them would make the
  // button look stuck when it is finished.
  const outstanding = (side?: DnaResponse | null): number =>
    side ? Math.max(0, side.coverage.expected - side.coverage.stored - (side.coverage.empty ?? 0)) : 0;
  const missing = outstanding(data[0]) + outstanding(data[1]);

  return (
    <section className="mt-4 overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]" data-testid="section-team-dna">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e1dfd7] bg-[#f1f0e9] px-4 py-3">
        <div className="min-w-0">
          <p className="mono flex items-center gap-1.5 text-[9px] uppercase tracking-[.17em] text-[#9b7160]">
            <Dna size={11} /> Team DNA
          </p>
          <p className="mt-0.5 max-w-[520px] text-[10px] leading-5 text-[#858780]">
            Each side's own last matches: xG against goals, chance quality, when goals arrive, whether leads held, and
            the ratings behind it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void startRead()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#dcd9d0] bg-white px-2.5 py-1.5 text-[10px] font-extrabold text-[#4c5a63] transition hover:bg-[#f4f3ec] disabled:opacity-40"
          data-testid="button-dna-read"
        >
          {busy ? <LoaderCircle size={11} className="animate-spin" /> : null} Read 50 matches
          {missing > 0 ? <span className="mono text-[8px] text-[#9a9c93]">· {missing} left</span> : null}
        </button>
      </div>

      {error && (
        <p className="px-4 py-3 text-[10px] text-[#8c6b5e]" data-testid="status-dna-error">
          {error}
        </p>
      )}

      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
        {data[0] ? <DnaColumn data={data[0]} /> : <p className="text-[10px] text-[#93958b]">Reading {home}…</p>}
        {data[1] ? <DnaColumn data={data[1]} /> : <p className="text-[10px] text-[#93958b]">Reading {away}…</p>}
      </div>

      {pending > 0 && (
        <p className="mono border-t border-[#e8e6dd] px-4 py-2 text-[8px] uppercase tracking-[.12em] text-[#8f9188]" data-testid="status-dna-queue">
          reading the last fifty · {pending} team queue{done(data)}
        </p>
      )}
    </section>
  );
}

function done(data: [DnaResponse | null, DnaResponse | null]): string {
  const stored = (data[0]?.queue.matchesStored ?? 0) + (data[1]?.queue.matchesStored ?? 0);
  return stored ? ` · ${stored} match rows stored` : '';
}
