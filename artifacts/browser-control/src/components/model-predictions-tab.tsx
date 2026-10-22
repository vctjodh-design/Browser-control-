import { useEffect, useMemo, useState } from 'react';
import {
  getGetFootballTesterMatchesQueryKey,
  useGetFootballTesterMatches,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FlaskConical,
  RefreshCw,
  Search,
} from 'lucide-react';
import { TesterModelPredictionsPanel } from '@/components/model-predictions-panel';

const PAGE_SIZE = 10;

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Saved pre-match records could not be loaded. Try again.';
}

function dateLabel(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
}

export default function ModelPredictionsTab() {
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(null);
  const params = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset,
      ...(search ? { search } : {}),
    }),
    [offset, search],
  );
  const matchesQuery = useGetFootballTesterMatches(params, {
    query: { queryKey: getGetFootballTesterMatchesQueryKey(params) },
  });
  const matches = matchesQuery.data?.matches ?? [];
  const total = matchesQuery.data?.total ?? 0;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchText.trim().slice(0, 100));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchText]);

  useEffect(() => {
    setOffset(0);
  }, [search]);

  useEffect(() => {
    if (!matches.length) {
      setSelectedFixtureId(null);
      return;
    }
    if (!matches.some((match) => match.fixtureId === selectedFixtureId)) {
      setSelectedFixtureId(matches[0].fixtureId);
    }
  }, [matches, selectedFixtureId]);

  const selectRecord = (fixtureId: number) => setSelectedFixtureId(fixtureId);
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <section
      className="overflow-hidden rounded-[16px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_12px_36px_rgba(47,59,64,.045)]"
      aria-labelledby="model-predictions-browser-title"
      data-testid="section-model-predictions-browser"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]">
            <FlaskConical size={16} />
          </span>
          <div>
            <h2 id="model-predictions-browser-title" className="text-[13px] font-extrabold text-[#344550]">
              Compare model predictions
            </h2>
            <p className="mt-0.5 text-[9px] text-[#858982]">
              Choose a saved pre-match fixture to score with every trained model.
            </p>
          </div>
        </div>
        <Link
          href="/tester"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#deddd3] bg-[#fbfaf6] px-3 text-[9px] font-extrabold text-[#64716d] transition hover:bg-white"
          data-testid="link-build-pre-match-records"
        >
          <CalendarDays size={12} /> Manage test fixtures
        </Link>
      </div>

      <div className="grid items-start gap-4 p-3 sm:p-4 xl:grid-cols-[minmax(250px,.78fr)_minmax(0,1.22fr)]">
        <section
          className="overflow-hidden rounded-xl border border-[#e1dfd7] bg-[#fbfaf6]"
          aria-labelledby="prediction-fixture-list-title"
        >
          <div className="border-b border-[#e8e6de] bg-[#f5f4ed] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 id="prediction-fixture-list-title" className="text-[10px] font-extrabold text-[#43575a]">
                Pre-match fixtures
              </h3>
              <span className="mono text-[8px] text-[#92958c]" data-testid="text-prediction-fixture-count">
                {total.toLocaleString()} saved
              </span>
            </div>
            <label className="relative block">
              <span className="sr-only">Search saved fixtures</span>
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b928a]" />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search team, league, or fixture ID"
                maxLength={100}
                className="h-9 w-full rounded-lg border border-[#d8d7ce] bg-[#fffefa] pl-9 pr-3 text-[9px] text-[#47595b] placeholder:text-[#9a9b93] focus:border-[#d96f51] focus:outline-none"
                aria-label="Search saved pre-match fixtures"
                data-testid="input-prediction-fixture-search"
              />
            </label>
          </div>

          {matchesQuery.isLoading ? (
            <div className="space-y-2 p-3" role="status" aria-label="Loading saved pre-match fixtures">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-[62px] animate-pulse rounded-lg bg-[#eeede6]" />
              ))}
            </div>
          ) : matchesQuery.isError ? (
            <div className="m-3 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-3" role="alert" data-testid="error-prediction-fixtures">
              <div className="flex items-start gap-2 text-[9px] leading-4 text-[#8c6b5e]">
                <CircleAlert size={13} className="mt-0.5 shrink-0" />
                <span>{errorText(matchesQuery.error)}</span>
              </div>
              <button
                type="button"
                onClick={() => void matchesQuery.refetch()}
                className="mt-2 inline-flex items-center gap-1.5 text-[9px] font-extrabold text-[#855542]"
                data-testid="button-retry-prediction-fixtures"
              >
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : matches.length ? (
            <div className="divide-y divide-[#e8e6de]" data-testid="list-prediction-fixtures">
              {matches.map((match) => (
                <button
                  key={match.fixtureId}
                  type="button"
                  onClick={() => selectRecord(match.fixtureId)}
                  aria-pressed={selectedFixtureId === match.fixtureId}
                  className={`w-full px-3 py-3 text-left transition-colors hover:bg-[#f3f3ec] ${
                    selectedFixtureId === match.fixtureId ? 'bg-[#edf2ec]' : ''
                  }`}
                  data-testid={`button-prediction-fixture-${match.fixtureId}`}
                >
                  <span className="block truncate text-[9px] font-extrabold text-[#455951]">
                    {match.homeTeamName} <span className="font-medium text-[#9a9a90]">vs</span> {match.awayTeamName}
                  </span>
                  <span className="mt-1 block truncate text-[8px] text-[#92958c]">
                    {dateLabel(match.date)} · {match.competition}
                  </span>
                  <span className="mt-1 inline-flex rounded-full bg-[#f1f0e9] px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-[.08em] text-[#79817a]">
                    {match.completeness} context
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="m-3 flex items-start gap-2 rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] p-3 text-[9px] leading-4 text-[#858982]" role="status" data-testid="empty-prediction-fixtures">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[#a2814b]" />
              <span>
                {search
                  ? 'No saved fixtures match that search.'
                  : 'No pre-match fixtures are saved yet. Build test fixtures first, then return here.'}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-[#e8e6de] bg-[#f5f4ed] px-3 py-2">
            <span className="mono text-[8px] text-[#858982]" aria-live="polite">
              {pageStart}–{pageEnd} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
                disabled={offset === 0 || matchesQuery.isLoading}
                aria-label="Previous fixtures"
                className="grid size-7 place-items-center rounded-md text-[#687570] transition hover:bg-white disabled:opacity-35"
                data-testid="button-previous-prediction-fixtures"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => setOffset((current) => current + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total || matchesQuery.isLoading}
                aria-label="Next fixtures"
                className="grid size-7 place-items-center rounded-md text-[#687570] transition hover:bg-white disabled:opacity-35"
                data-testid="button-next-prediction-fixtures"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </section>

        <div className="min-w-0" data-testid="panel-selected-model-predictions">
          {selectedFixtureId === null ? (
            <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-6 py-10 text-center text-[9px] leading-5 text-[#858982]">
              Select a saved fixture to view predictions from each trained model.
            </div>
          ) : (
            <TesterModelPredictionsPanel fixtureId={selectedFixtureId} />
          )}
        </div>
      </div>
    </section>
  );
}
