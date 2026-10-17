import { useState } from 'react';
import { useGetFootballFixtures } from '@workspace/api-client-react';
import { Link } from 'wouter';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Search,
  Trophy,
  X,
} from 'lucide-react';

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDate(dateString: string, amount: number) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + amount);
  return getLocalDateString(date);
}

function formatSelectedDate(dateString: string) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day, 12));
}

function readableError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') {
    return error.error;
  }
  return 'The fixture feed could not be reached. Please try again.';
}

function normalizeSearchTerm(value: string) {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function TeamMark({ name, logo }: { name: string; logo: string | null }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#e1e1d9] bg-[#f4f4ed] text-[11px] font-extrabold tracking-tight text-[#75817b]">
      {logo ? <img src={logo} alt="" className="size-full object-contain p-1" loading="lazy" /> : name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function FixtureRow({ fixture, index }: {
  fixture: {
    competition: string;
    homeTeam: string;
    awayTeam: string;
    homeLogo: string | null;
    awayLogo: string | null;
    kickoff: string;
    status: string;
    homeScore: number | null;
    awayScore: number | null;
    matchUrl: string;
  };
  index: number;
}) {
  const hasScore = fixture.homeScore !== null && fixture.awayScore !== null;
  const status = fixture.status.trim() || 'Scheduled';
  const statusLower = status.toLowerCase();
  const isLive = statusLower.includes('live') || statusLower.includes('in play');
  const isComplete = statusLower.includes('full') || statusLower.includes('finished') || statusLower.includes('ft');

  return (
    <article className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-4 border-b border-[#e7e5dc] px-4 py-4 transition-colors last:border-b-0 hover:bg-[#fbfaf5] sm:grid-cols-[minmax(190px,1fr)_minmax(250px,1.35fr)_minmax(130px,.7fr)_auto] sm:gap-5 sm:px-5" data-testid={`fixture-row-${index}`}>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-extrabold uppercase tracking-[.13em] text-[#9a7867]" data-testid={`text-competition-${index}`}>{fixture.competition}</p>
        <p className="mono mt-1.5 text-[10px] text-[#8b928a]" data-testid={`text-kickoff-${index}`}>{fixture.kickoff}</p>
      </div>

      <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 sm:col-span-1">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <TeamMark name={fixture.homeTeam} logo={fixture.homeLogo} />
          <span className="truncate text-[12px] font-bold tracking-[-.02em] text-[#354750]" data-testid={`text-home-team-${index}`}>{fixture.homeTeam}</span>
        </div>
        <div className="flex min-w-[42px] flex-col items-center">
          {hasScore ? (
            <span className="mono text-[14px] font-medium tracking-[-.06em] text-[#293b45]" data-testid={`text-score-${index}`}>
              {fixture.homeScore}<span className="mx-1 text-[#a2a69c]">:</span>{fixture.awayScore}
            </span>
          ) : (
            <span className="mono text-[10px] text-[#a0a39b]">VS</span>
          )}
          <span className={`mt-1 rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[.1em] ${isLive ? 'bg-[#f8e7de] text-[#b65c42]' : isComplete ? 'bg-[#e9eee8] text-[#64806d]' : 'bg-[#efeee8] text-[#7d837b]'}`} data-testid={`status-match-${index}`}>
            {status}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5 text-right">
          <span className="truncate text-[12px] font-bold tracking-[-.02em] text-[#354750]" data-testid={`text-away-team-${index}`}>{fixture.awayTeam}</span>
          <TeamMark name={fixture.awayTeam} logo={fixture.awayLogo} />
        </div>
      </div>

      <a href={fixture.matchUrl} target="_blank" rel="noreferrer" className="col-start-2 row-start-1 inline-flex items-center justify-end gap-1.5 text-[10px] font-extrabold text-[#668074] transition hover:text-[#d06c4f] sm:col-start-auto sm:row-start-auto sm:justify-start" aria-label={`Open ${fixture.homeTeam} versus ${fixture.awayTeam} match details on KickoffScore`} data-testid={`link-match-${index}`}>
        Match details <ExternalLink size={12} />
      </a>
    </article>
  );
}

export default function FixturesPage() {
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateString());
  const [searchTerm, setSearchTerm] = useState('');
  const fixturesQuery = useGetFootballFixtures({ date: selectedDate });
  const data = fixturesQuery.data;
  const normalizedSearch = normalizeSearchTerm(searchTerm);
  const allFixtures = data?.fixtures ?? [];
  const filteredFixtures = normalizedSearch
    ? allFixtures.filter((fixture) =>
        normalizeSearchTerm(
          `${fixture.homeTeam} vs ${fixture.awayTeam} ${fixture.competition}`,
        ).includes(normalizedSearch),
      )
    : allFixtures;

  return (
    <main className="screen-noise min-h-[100dvh] bg-[#f2f0e8] text-[#243443]">
      <header className="relative z-10 border-b border-[#d9d8cf] bg-[#f7f5ef]">
        <div className="mx-auto flex min-h-[72px] max-w-[1260px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-7 lg:px-10">
          <div className="flex items-center gap-3.5">
            <div className="grid size-10 place-items-center rounded-[13px] bg-[#253746] text-[#f8f2e7] shadow-sm" aria-hidden="true">
              <Trophy size={19} strokeWidth={1.8} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-[15px] font-extrabold tracking-[-.04em]">Browser Control</span>
                <span className="rounded-full border border-[#deddd3] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.16em] text-[#7e827d]">Fixture finder</span>
              </div>
              <p className="mt-0.5 hidden text-[11px] text-[#858780] sm:block">One clear view of football, any day.</p>
            </div>
          </div>
          <nav aria-label="Main navigation" className="flex items-center gap-1 rounded-xl border border-[#deddd3] bg-[#efeee7] p-1" data-testid="navigation-main">
            <Link href="/" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] transition hover:bg-[#fbfaf6] hover:text-[#344550]" data-testid="link-browser-home">
              <ArrowLeft size={13} /> <span>Browser</span>
            </Link>
            <Link href="/fixtures" aria-current="page" className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#253746] px-3 text-[10px] font-extrabold text-[#f8f2e7] shadow-sm" data-testid="link-fixtures">
              <CalendarDays size={13} /> <span>Fixtures</span>
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1260px] px-4 pb-12 pt-8 sm:px-7 sm:pt-11 lg:px-10">
        <div className="animate-rise mb-7 grid gap-7 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="mono mb-2 text-[10px] uppercase tracking-[.19em] text-[#9b7160]">KickoffScore / fixtures</p>
            <h1 className="max-w-[720px] text-[32px] font-extrabold leading-[1.05] tracking-[-.06em] text-[#263746] sm:text-[48px]">
              The day’s football, <span className="text-[#d96f51]">at a glance.</span>
            </h1>
            <p className="mt-3 max-w-[540px] text-[13px] leading-6 text-[#727973]">
              Choose any date to see the matches on the calendar, with scores and status straight from KickoffScore.
            </p>
          </div>

          <section className="rounded-[15px] border border-[#d8d7ce] bg-[#f9f8f3] p-3 shadow-[0_10px_30px_rgba(47,59,64,.045)] sm:p-4" aria-label="Choose fixture date">
            <label htmlFor="fixtures-date" className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.13em] text-[#687570]">Match date</label>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setSelectedDate((date) => shiftDate(date, -1))} className="grid size-10 shrink-0 place-items-center rounded-lg border border-[#deddd4] bg-[#f4f3ed] text-[#64736d] transition hover:bg-[#e9eee8]" aria-label="Previous day" data-testid="button-previous-day">
                <ChevronLeft size={17} />
              </button>
              <div className="relative min-w-0 flex-1">
                <CalendarDays size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-[#9a7867]" />
                <input
                  id="fixtures-date"
                  type="date"
                  value={selectedDate}
                  onChange={(event) => {
                    if (event.target.value) setSelectedDate(event.target.value);
                  }}
                  className="h-10 w-full min-w-0 appearance-none rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] pl-9 pr-2 text-[12px] font-bold text-[#354750] focus:border-[#d96f51] focus:outline-none focus:ring-2 focus:ring-[#d96f51]/15"
                  aria-label="Select a fixture date"
                  data-testid="input-fixtures-date"
                />
              </div>
              <button type="button" onClick={() => setSelectedDate((date) => shiftDate(date, 1))} className="grid size-10 shrink-0 place-items-center rounded-lg border border-[#deddd4] bg-[#f4f3ed] text-[#64736d] transition hover:bg-[#e9eee8]" aria-label="Next day" data-testid="button-next-day">
                <ChevronRight size={17} />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="truncate text-[10px] text-[#858982]" data-testid="text-selected-date">{formatSelectedDate(selectedDate)}</p>
              <button type="button" onClick={() => setSelectedDate(getLocalDateString())} className="shrink-0 text-[10px] font-extrabold text-[#a36550] hover:text-[#d96f51]" data-testid="button-select-today">Today</button>
            </div>
          </section>
        </div>

        <section className="animate-rise overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_20px_60px_rgba(47,59,64,.065)]" aria-label={`Fixtures for ${formatSelectedDate(selectedDate)}`} data-testid="section-fixtures">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><Trophy size={16} /></span>
              <div className="min-w-0">
                <h2 className="truncate text-[14px] font-extrabold tracking-[-.035em] text-[#344550]" data-testid="text-fixtures-heading">Fixtures · {formatSelectedDate(selectedDate)}</h2>
                <p className="mt-0.5 text-[10px] text-[#858982]" aria-live="polite" data-testid="text-fixtures-count">
                  {data
                    ? normalizedSearch
                      ? `${filteredFixtures.length} of ${data.fixtures.length} matches`
                      : `${data.fixtures.length} ${data.fixtures.length === 1 ? 'match' : 'matches'} listed`
                    : 'Match schedule and results'}
                </p>
              </div>
            </div>
            {data?.sourceUrl && (
              <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#d9ddd4] bg-[#fbfaf6] px-3 text-[10px] font-extrabold text-[#5c7669] transition hover:border-[#bfcfc4] hover:bg-white" data-testid="link-kickoffscore-source">
                Source: KickoffScore <ExternalLink size={12} />
              </a>
            )}
          </div>

          {data?.fixtures.length ? (
            <div className="flex flex-col gap-2.5 border-b border-[#e7e5dc] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <label className="relative block w-full sm:max-w-[440px]">
                <span className="sr-only">Search matches by team or competition</span>
                <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b928a]" />
                <input
                  type="text"
                  inputMode="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search teams or competitions"
                  autoComplete="off"
                  aria-label="Search matches by team or competition"
                  className="h-10 w-full rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] pl-9 pr-10 text-[12px] font-medium text-[#354750] placeholder:text-[#9a9b93] focus:border-[#d96f51] focus:outline-none focus:ring-2 focus:ring-[#d96f51]/15"
                  data-testid="input-fixture-search"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    aria-label="Clear match search"
                    className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-[#78817b] transition hover:bg-[#efeee8] hover:text-[#354750]"
                    data-testid="button-clear-fixture-search"
                  >
                    <X size={14} />
                  </button>
                )}
              </label>
              <p className="text-[10px] text-[#858982]" aria-live="polite">
                {normalizedSearch
                  ? `${filteredFixtures.length} ${filteredFixtures.length === 1 ? 'match' : 'matches'} found`
                  : 'Search by team or competition'}
              </p>
            </div>
          ) : null}

          {fixturesQuery.isLoading ? (
            <div className="p-4 sm:p-5" role="status" aria-label="Loading fixtures" data-testid="status-fixtures-loading">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-bold text-[#78817b]"><LoaderCircle size={13} className="animate-spin" /> Checking the fixture list</div>
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex items-center justify-between gap-5 border-b border-[#e7e5dc] py-5 last:border-0">
                  <div className="space-y-2"><div className="h-2.5 w-28 animate-pulse rounded-full bg-[#e7e6dd]" /><div className="h-2 w-14 animate-pulse rounded-full bg-[#ecebe4]" /></div>
                  <div className="h-8 w-2/5 animate-pulse rounded-lg bg-[#e7e6dd]" />
                  <div className="h-2.5 w-20 animate-pulse rounded-full bg-[#ecebe4]" />
                </div>
              ))}
            </div>
          ) : fixturesQuery.isError ? (
            <div className="m-4 flex flex-col items-start gap-4 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-5 sm:m-6 sm:flex-row sm:items-center" role="alert" data-testid="status-fixtures-error">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#f6e2d8] text-[#b85b46]"><CircleAlert size={17} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-extrabold text-[#784b3e]">Couldn’t load fixtures for this date.</p>
                <p className="mt-1 break-words text-[11px] leading-5 text-[#8c6b5e]">{readableError(fixturesQuery.error)}</p>
              </div>
              <button type="button" onClick={() => fixturesQuery.refetch()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-3 text-[10px] font-extrabold text-[#855542] transition hover:bg-white" data-testid="button-retry-fixtures">
                <RefreshCw size={13} /> Try again
              </button>
            </div>
          ) : data?.fixtures.length ? (
            filteredFixtures.length ? (
              <div data-testid="list-fixtures">
                {filteredFixtures.map((fixture, index) => (
                  <FixtureRow key={`${fixture.matchUrl}-${index}`} fixture={fixture} index={index} />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[255px] flex-col items-center justify-center px-6 py-12 text-center" data-testid="status-fixtures-no-search-results">
                <span className="grid size-12 place-items-center rounded-2xl border border-[#dfe4dc] bg-[#edf2ec] text-[#718879]"><Search size={20} /></span>
                <h3 className="mt-4 text-[16px] font-extrabold tracking-[-.04em] text-[#354750]">No matching fixtures</h3>
                <p className="mt-2 max-w-[320px] text-[11px] leading-5 text-[#858982]">No teams or competitions match “{searchTerm}”. Try a different search.</p>
                <button type="button" onClick={() => setSearchTerm('')} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-[#253746] px-3.5 text-[10px] font-extrabold text-[#f8f2e7] transition hover:bg-[#344c5d]" data-testid="button-reset-fixture-search">
                  <X size={13} /> Clear search
                </button>
              </div>
            )
          ) : (
            <div className="flex min-h-[255px] flex-col items-center justify-center px-6 py-12 text-center" data-testid="status-fixtures-empty">
              <span className="grid size-12 place-items-center rounded-2xl border border-[#dfe4dc] bg-[#edf2ec] text-[#718879]"><CalendarDays size={20} /></span>
              <h3 className="mt-4 text-[16px] font-extrabold tracking-[-.04em] text-[#354750]">No fixtures on this date</h3>
              <p className="mt-2 max-w-[320px] text-[11px] leading-5 text-[#858982]">There are no matches listed for {formatSelectedDate(selectedDate)}. Try another day to explore the schedule.</p>
              <button type="button" onClick={() => setSelectedDate(getLocalDateString())} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-[#253746] px-3.5 text-[10px] font-extrabold text-[#f8f2e7] transition hover:bg-[#344c5d]" data-testid="button-empty-today">
                <CalendarDays size={13} /> Go to today
              </button>
            </div>
          )}
        </section>

        <footer className="mt-5 flex flex-col justify-between gap-2 px-1 text-[10px] leading-5 text-[#8b8d84] sm:flex-row sm:items-center">
          <p>Fixtures, kickoff times and results are sourced from KickoffScore.</p>
          {data?.sourceUrl ? (
            <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="mono inline-flex shrink-0 items-center gap-1.5 tracking-wide text-[#758078] hover:text-[#d06c4f]" data-testid="link-footer-source">
              KICKOFFSCORE <ExternalLink size={11} />
            </a>
          ) : (
            <span className="mono shrink-0 tracking-wide">FIXTURES <span className="text-[#c27d62]">/</span> KICKOFFSCORE</span>
          )}
        </footer>
      </div>
    </main>
  );
}
