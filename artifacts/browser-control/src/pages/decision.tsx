import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import {
  CalendarDays,
  CircleAlert,
  Crosshair,
  Database,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Trophy,
  X,
} from 'lucide-react';
import { fixtureId, loadFixtures, type FixtureOption } from '@/lib/inevitability';
import { DecisionBatch } from '@/components/decision-batch';
import { DecisionTreePanel } from '@/components/decision-tree-panel';

// The whole-date view of the decision tree.
//
// The match page answers one fixture; this page answers a date. Every fixture is
// settled by the same tree — one board read, every market called from it — and the
// run is paced and saved so a date can be worked through in more than one sitting.
//
// The rows are the date; the full card is one fixture. Opening a row raises that
// card as a sheet over the page, because printed inline it sat below the whole
// date's list — a report nobody scrolls to is a report nobody reads.

const today = () => new Date().toISOString().slice(0, 10);
const KEPT_DATE_KEY = 'browser-control:decision-date';

/** The date being worked on outlives a reload, so a half-settled date is where you land back. */
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
          <Link href="/inevitability" className={idleClass} data-testid="link-inevitability">
            <Crosshair size={13} /> Inevitability
          </Link>
          <Link href="/decision" aria-current="page" className={activeClass} data-testid="link-decision">
            <GitBranch size={13} /> Decision
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default function DecisionPage() {
  const [date, setDate] = useState(readKeptDate);
  const [fixtures, setFixtures] = useState<FixtureOption[]>([]);
  // The fixture whose card is open. There is no other reason to select one, so
  // selecting and opening are the same act: a row or a tile raises the card.
  const [opened, setOpened] = useState<number | null>(null);
  const [loadingFixtures, setLoadingFixtures] = useState(false);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const openedFixture = fixtures.find((fixture) => fixtureId(fixture) === opened) ?? null;

  // A sheet over a scrolling page needs the page behind it to stay put, and
  // Escape has to close it: on a phone there is no backdrop beside the card.
  useEffect(() => {
    if (opened === null) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpened(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [opened]);

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
    setOpened(null);
    loadFixtures(date, controller.signal)
      .then((rows) => {
        setFixtures(rows);
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

  return (
    <main className="screen-noise min-h-[100dvh] bg-[#f2f0e8] text-[#243443]">
      <Header />

      <div className="mx-auto max-w-[1320px] px-4 pb-14 pt-7 sm:px-7 sm:pt-10 lg:px-10">
        <div className="animate-rise mb-6 flex flex-col justify-between gap-4 border-b border-[#d9d8cf] pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="mono mb-2 text-[9px] uppercase tracking-[.2em] text-[#9b7160]">Research bench / decision tree</p>
            <h1 className="text-[27px] font-extrabold leading-tight tracking-[-.055em] sm:text-[36px]">
              A date, settled market by market.
            </h1>
            <p className="mt-2 max-w-[620px] text-[12px] leading-6 text-[#727973]">
              Every fixture on the date is put on the board once, and the same tree settles each card: result, goals,
              both sides to score, and the team lines. Nothing on a card is a price, and the run can be stopped and
              continued without reading a fixture twice.
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
                data-testid="input-decision-date"
              />
            </label>
            <button
              type="button"
              onClick={() => setReloadToken((token) => token + 1)}
              disabled={opened === null}
              className="grid size-9 place-items-center rounded-lg border border-[#dcd9d0] bg-[#faf9f5] text-[#7d827d] transition hover:bg-white disabled:opacity-40"
              title="Re-read this fixture"
              aria-label="Re-read this fixture"
              data-testid="button-decision-reload"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {error && (
          <section
            className="mb-5 flex items-start gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] px-4 py-3.5"
            role="alert"
            data-testid="status-decision-page-error"
          >
            <CircleAlert size={16} className="mt-0.5 shrink-0 text-[#b85b46]" />
            <p className="text-[11px] leading-5 text-[#8c6b5e]">{error}</p>
          </section>
        )}

        <section className="mb-5" data-testid="section-decision-picker">
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
              const active = id === opened;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setOpened(id)}
                  className={`min-w-[210px] shrink-0 rounded-xl border px-3.5 py-2.5 text-left transition ${
                    active
                      ? 'border-[#253746] bg-[#253746] text-[#f8f2e7]'
                      : 'border-[#dcd9d0] bg-[#faf9f5] text-[#4c5a58] hover:border-[#c3c1b6] hover:bg-white'
                  }`}
                  data-testid={`button-decision-fixture-${id}`}
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

        <DecisionBatch date={date} fixtures={fixtures} selected={opened} onSelect={setOpened} />

        {opened === null && fixtures.length > 0 && (
          <p className="mb-5 px-1 text-[10px] leading-5 text-[#93958b]" data-testid="hint-open-card">
            Open a settled row — or any fixture above — to read its full card.
          </p>
        )}

        {opened !== null && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-[#1b2730]/45 backdrop-blur-[1px] sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Decision card"
            onClick={() => setOpened(null)}
            data-testid="sheet-decision-report"
          >
            <div
              className="h-[100dvh] w-full overflow-y-auto bg-[#f7f5ef] shadow-2xl sm:h-[92dvh] sm:max-w-[900px] sm:rounded-[18px]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f7f5ef]/95 px-4 py-3 backdrop-blur sm:px-5">
                <div className="min-w-0">
                  <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Decision card · full report</p>
                  <p className="truncate text-[12px] font-extrabold text-[#2b3e49]" data-testid="text-sheet-fixture">
                    {openedFixture ? `${openedFixture.homeTeam} v ${openedFixture.awayTeam}` : `Fixture ${opened}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpened(null)}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#dcd9d0] bg-white px-2.5 text-[10px] font-extrabold text-[#5c6f63] transition hover:bg-[#f4f3ec]"
                  data-testid="button-close-decision-report"
                >
                  <X size={13} /> Close
                </button>
              </div>
              <div className="px-3 pb-10 pt-4 sm:px-5">
                <DecisionTreePanel key={`${opened}-${reloadToken}`} fixtureId={opened} />
              </div>
            </div>
          </div>
        )}

        <footer className="mt-6 flex flex-col justify-between gap-2 px-1 text-[10px] leading-5 text-[#8b8d84] sm:flex-row sm:items-center">
          <p>One board per fixture. The tree settles the card, and the trace can be checked after full time.</p>
          <p className="mono shrink-0 tracking-wide">
            DECISION <span className="text-[#c27d62]">/</span> EVERY MARKET
          </p>
        </footer>
      </div>
    </main>
  );
}
