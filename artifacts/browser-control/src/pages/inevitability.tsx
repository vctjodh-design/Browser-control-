import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import {
  CalendarDays,
  CircleAlert,
  Crosshair,
  Database,
  LoaderCircle,
  RefreshCw,
  Trophy,
} from 'lucide-react';
import {
  fixtureId,
  loadFixtures,
  loadInevitability,
  type FixtureOption,
  type InevitabilityVerdict,
} from '@/lib/inevitability';
import { Cascade, LynchpinCard, Script, VerdictHeader } from '@/components/inevitability-verdict';
import { InevitabilityBatch } from '@/components/inevitability-batch';

// The Inevitability Engine's own page.
//
// Every other forecast in this app reports a share of something. This one
// reports one fixture played once: the contest that decides it, what covering
// that contest costs, and the goals that follow. The trace at the bottom is the
// verdict — it is meant to be read after full time, not taken on trust.

const today = () => new Date().toISOString().slice(0, 10);
const KEPT_DATE_KEY = 'browser-control:inevitability-date';

/**
 * The date being worked on outlives a reload, so a date that was half processed is
 * still the page you land back on, with its results in place, rather than today.
 */
function readKeptDate(): string {
  try {
    const saved = window.localStorage.getItem(KEPT_DATE_KEY);
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
  } catch {
    // Storage can be disabled; today is still a fine place to start.
  }
  return today();
}

function scoreOf(fixture: FixtureOption) {
  return fixture.homeScore === null || fixture.awayScore === null
    ? null
    : `${fixture.homeScore}–${fixture.awayScore}`;
}

function Header() {
  const activeClass =
    'inline-flex h-8 items-center gap-2 rounded-lg bg-[#253746] px-3 text-[10px] font-extrabold text-[#f8f2e7]';
  const idleClass =
    'inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]';
  return (
    <header className="border-b border-[#d9d8cf] bg-[#f7f5ef]">
      <div className="mx-auto flex min-h-[68px] max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7 lg:px-10">
        <Link href="/" className="flex items-center gap-3" data-testid="link-brand-home">
          <span className="grid size-10 place-items-center rounded-[13px] bg-[#253746] text-[#f8f2e7]">
            <Trophy size={18} />
          </span>
          <span>
            <strong className="block text-[14px] tracking-[-.04em] text-[#2b3e49]">Browser Control</strong>
            <span className="text-[10px] text-[#858780]">Football research archive</span>
          </span>
        </Link>
        <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-1 rounded-xl border border-[#deddd3] bg-[#efeee7] p-1">
          <Link href="/fixtures" className={idleClass} data-testid="link-fixtures">
            <CalendarDays size={13} /> Fixtures
          </Link>
          <Link href="/processing" className={idleClass} data-testid="link-processing">
            Processing
          </Link>
          <Link href="/database" className={idleClass} data-testid="link-database">
            <Database size={13} /> Database
          </Link>
          <Link href="/model-training" className={idleClass} data-testid="link-model-training">
            Model training
          </Link>
          <Link href="/inevitability" aria-current="page" className={activeClass} data-testid="link-inevitability">
            <Crosshair size={13} /> Inevitability
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default function InevitabilityPage() {
  const [date, setDate] = useState(readKeptDate);
  const [fixtures, setFixtures] = useState<FixtureOption[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<InevitabilityVerdict | null>(null);
  const [loadingFixtures, setLoadingFixtures] = useState(false);
  const [loadingVerdict, setLoadingVerdict] = useState(false);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEPT_DATE_KEY, date);
    } catch {
      // Nothing to keep; the page still works for this visit.
    }
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingFixtures(true);
    setError('');
    setVerdict(null);
    setSelected(null);
    loadFixtures(date, controller.signal)
      .then((rows) => {
        setFixtures(rows);
        setSelected(rows[0] ? fixtureId(rows[0]) : null);
        if (!rows.length) setError('No fixtures were listed for this date.');
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setFixtures([]);
        setError(cause instanceof Error ? cause.message : 'Fixtures could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFixtures(false);
      });
    return () => controller.abort();
  }, [date]);

  useEffect(() => {
    if (selected === null) {
      setVerdict(null);
      return;
    }
    const controller = new AbortController();
    setLoadingVerdict(true);
    setError('');
    loadInevitability(selected, controller.signal)
      .then((next) => setVerdict(next))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setVerdict(null);
        setError(cause instanceof Error ? cause.message : 'The fixture could not be resolved.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingVerdict(false);
      });
    return () => controller.abort();
  }, [selected, reloadToken]);

  return (
    <main className="screen-noise min-h-[100dvh] bg-[#f2f0e8] text-[#243443]">
      <Header />

      <div className="mx-auto max-w-[1320px] px-4 pb-14 pt-7 sm:px-7 sm:pt-10 lg:px-10">
        <div className="animate-rise mb-6 flex flex-col justify-between gap-4 border-b border-[#d9d8cf] pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="mono mb-2 text-[9px] uppercase tracking-[.2em] text-[#9b7160]">Research bench / inevitability</p>
            <h1 className="text-[27px] font-extrabold leading-tight tracking-[-.055em] sm:text-[36px]">
              One fixture. One trace. One verdict.
            </h1>
            <p className="mt-2 max-w-[620px] text-[12px] leading-6 text-[#727973]">
              The squads are put on the board once, the contest nobody can answer is found, and the goals are read off
              the chain it forces. No price goes in, and nothing is averaged across a thousand replays.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-[#dcd9d0] bg-[#faf9f5] px-3 py-2">
              <CalendarDays size={14} className="text-[#8b8d84]" />
              <span className="sr-only">Fixture date</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="mono bg-transparent text-[11px] text-[#4c5a58] outline-none"
                data-testid="input-inevitability-date"
              />
            </label>
            <button
              type="button"
              onClick={() => setReloadToken((token) => token + 1)}
              disabled={selected === null || loadingVerdict}
              className="grid size-9 place-items-center rounded-lg border border-[#dcd9d0] bg-[#faf9f5] text-[#7d827d] transition hover:bg-white disabled:opacity-40"
              title="Re-read this fixture"
              aria-label="Re-read this fixture"
              data-testid="button-reload-verdict"
            >
              <RefreshCw size={13} className={loadingVerdict ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {error && (
          <section
            className="mb-5 flex items-start gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] px-4 py-3.5"
            role="alert"
            data-testid="status-inevitability-error"
          >
            <CircleAlert size={16} className="mt-0.5 shrink-0 text-[#b85b46]" />
            <p className="text-[11px] leading-5 text-[#8c6b5e]">{error}</p>
          </section>
        )}

        <section className="mb-5" data-testid="section-fixture-picker">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="mono text-[8px] uppercase tracking-[.16em] text-[#9a8c80]">
              {loadingFixtures ? 'Loading fixtures' : `${fixtures.length} fixtures`}
            </p>
            {loadingFixtures && <LoaderCircle size={13} className="animate-spin text-[#b09a8c]" />}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {fixtures.map((fixture) => {
              const id = fixtureId(fixture);
              if (id === null) return null;
              const active = id === selected;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelected(id)}
                  className={`min-w-[210px] shrink-0 rounded-xl border px-3.5 py-2.5 text-left transition ${
                    active
                      ? 'border-[#253746] bg-[#253746] text-[#f8f2e7]'
                      : 'border-[#dcd9d0] bg-[#faf9f5] text-[#4c5a58] hover:border-[#c3c1b6] hover:bg-white'
                  }`}
                  data-testid={`button-fixture-${id}`}
                >
                  <span
                    className={`mono block truncate text-[8px] uppercase tracking-[.1em] ${
                      active ? 'text-[#c9a892]' : 'text-[#9a8c80]'
                    }`}
                  >
                    {fixture.competition}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] font-bold">
                    {fixture.homeTeam} v {fixture.awayTeam}
                  </span>
                  <span className={`mono mt-0.5 block text-[9px] ${active ? 'text-[#c9c2b4]' : 'text-[#9a9c93]'}`}>
                    {fixture.kickoff} · {scoreOf(fixture) ?? fixture.status}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <InevitabilityBatch date={date} fixtures={fixtures} selected={selected} onSelect={setSelected} />

        {loadingVerdict && (
          <section
            className="flex min-h-[220px] flex-col items-center justify-center rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]"
            role="status"
            data-testid="status-verdict-loading"
          >
            <LoaderCircle size={20} className="animate-spin text-[#b09a8c]" />
            <p className="mt-3 text-[11px] font-bold text-[#6b7772]">Reading the two squads</p>
            <p className="mt-1 text-[10px] text-[#93958b]">Pricing every contest, then playing the match once.</p>
          </section>
        )}

        {!loadingVerdict && verdict && (
          <div className="animate-rise space-y-4">
            <VerdictHeader verdict={verdict} />
            <LynchpinCard verdict={verdict} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <Cascade verdict={verdict} />
              <Script verdict={verdict} />
            </div>
            <p className="px-1 text-[10px] leading-5 text-[#93958b]">{verdict.note}</p>
          </div>
        )}

        {!loadingVerdict && !verdict && !error && (
          <section className="flex min-h-[200px] items-center justify-center rounded-[17px] border border-dashed border-[#cfcdc2] bg-[#f7f5ef] px-6 text-center">
            <p className="text-[11px] text-[#8b8d84]">Choose a fixture to resolve it.</p>
          </section>
        )}

        <footer className="mt-6 flex flex-col justify-between gap-2 px-1 text-[10px] leading-5 text-[#8b8d84] sm:flex-row sm:items-center">
          <p>One resolution per fixture. The verdict is the trace, and the trace can be checked after full time.</p>
          <p className="mono shrink-0 tracking-wide">
            INEVITABILITY <span className="text-[#c27d62]">/</span> ONE TRACE
          </p>
        </footer>
      </div>
    </main>
  );
}
