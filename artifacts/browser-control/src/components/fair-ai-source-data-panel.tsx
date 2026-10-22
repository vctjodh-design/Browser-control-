import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFootballFairAiDataQueryKey,
  useGetFootballFairAiData,
  useStartFootballFairAiDataIngestion,
} from '@workspace/api-client-react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Database,
  RefreshCw,
  UsersRound,
} from 'lucide-react';

function readableError(error: unknown) {
  if (!error) return 'The data summary could not be loaded.';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error &&
      typeof error.message === 'string') return error.message;
  if (typeof error === 'object' && error !== null && 'error' in error &&
      typeof error.error === 'string') return error.error;
  return 'The request could not be completed. Try again.';
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(date) + ' UTC';
}

export default function FairAiSourceDataPanel() {
  const client = useQueryClient();
  const queryKey = getGetFootballFairAiDataQueryKey();
  const summaryQuery = useGetFootballFairAiData({
    query: {
      queryKey,
      refetchInterval: (query) =>
        query.state.data?.status === 'running' ? 1500 : false,
    },
  });
  const ingest = useStartFootballFairAiDataIngestion();
  const summary = summaryQuery.data;
  const progress = summary && summary.sourceFixtureCount > 0
    ? Math.min(
        100,
        ((summary.processedSourceFixtureCount + summary.skippedSourceFixtureCount) /
          summary.sourceFixtureCount) * 100,
      )
    : 0;
  const busy = summary?.status === 'running' || ingest.isPending;
  const complete = summary?.status === 'completed' &&
    summary.remainingSourceFixtureCount === 0;

  const startIngestion = () => {
    if (busy) return;
    ingest.mutate(
      undefined,
      {
        onSuccess: (result) => {
          client.setQueryData(queryKey, result);
          void client.invalidateQueries({ queryKey });
        },
      },
    );
  };

  return (
    <section
      className="mt-4 overflow-hidden rounded-xl border border-[#d9e0d6] bg-[#fbfaf6]"
      aria-labelledby="fair-source-data-title"
      data-testid="section-fair-source-data"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e5dc] bg-[#f0f4ed] px-3 py-3 sm:px-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-[#e0eade] text-[#5d806a]" aria-hidden="true">
            <Database size={15} />
          </span>
          <div>
            <p className="mono text-[8px] uppercase tracking-[.13em] text-[#9b7160]">03 / Source-backed data</p>
            <h3 id="fair-source-data-title" className="mt-0.5 text-[11px] font-extrabold text-[#43575a]">
              Normalized KickoffScore records
            </h3>
          </div>
        </div>
        <button
          type="button"
          onClick={startIngestion}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#253746] px-3 text-[9px] font-extrabold text-[#f8f2e7] transition hover:bg-[#344b5a] disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d96f51]"
          data-testid="button-ingest-fair-ai-data"
        >
          {busy
            ? <><RefreshCw size={12} className="animate-spin" aria-hidden="true" /> Importing archive</>
            : complete
              ? <><RefreshCw size={12} aria-hidden="true" /> Refresh imported archive</>
              : <><RefreshCw size={12} aria-hidden="true" /> {summary?.processedSourceFixtureCount ? 'Resume archive import' : 'Import archive'}</>}
        </button>
      </div>

      <div className="space-y-3 p-3 sm:p-4">
        {summaryQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="status" aria-label="Loading source data coverage">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-[64px] animate-pulse rounded-lg bg-[#eeede6]" />
            ))}
          </div>
        ) : summaryQuery.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-3" role="alert" data-testid="status-fair-source-data-error">
            <p className="flex items-start gap-2 text-[9px] leading-5 text-[#784b3e]">
              <CircleAlert size={13} className="mt-1 shrink-0" aria-hidden="true" />
              {readableError(summaryQuery.error)}
            </p>
            <button
              type="button"
              onClick={() => void summaryQuery.refetch()}
              className="text-[9px] font-extrabold text-[#855542]"
              data-testid="button-retry-fair-source-data"
            >
              Retry
            </button>
          </div>
        ) : summary ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Normalized source record counts">
              {[
                { label: 'Teams', value: summary.teamCount },
                { label: 'Matches', value: summary.matchCount },
                { label: 'Players', value: summary.playerCount },
                { label: 'Coaches', value: summary.coachCount },
              ].map((metric) => (
                <div key={metric.label} className="rounded-lg border border-[#e3e2d9] bg-[#f5f4ed] px-3 py-2.5" data-testid={`metric-fair-source-${metric.label.toLowerCase()}`}>
                  <p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#90938a]">{metric.label}</p>
                  <p className="mono mt-1 text-[15px] font-medium leading-none text-[#344c43]">{metric.value.toLocaleString()}</p>
                </div>
              ))}
            </div>

            {(summary.status === 'running' || summary.status === 'failed' || summary.sourceFixtureCount > 0) && (
              <div className="rounded-lg border border-[#e3e2d9] bg-[#f9f8f3] px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[8px] font-bold text-[#59675f]" data-testid="status-fair-ingestion">
                    {summary.status === 'running'
                      ? 'Import running'
                      : summary.status === 'failed'
                        ? 'Import stopped — resume to continue'
                        : summary.status === 'completed'
                          ? summary.remainingSourceFixtureCount > 0
                            ? 'New archive rows are awaiting import'
                            : 'Archive scan complete'
                          : 'Archive scan not started'}
                  </p>
                  <p className="mono text-[8px] text-[#858982]" data-testid="text-fair-ingestion-progress">
                    {summary.processedSourceFixtureCount.toLocaleString()} processed · {summary.skippedSourceFixtureCount.toLocaleString()} skipped · {summary.remainingSourceFixtureCount.toLocaleString()} remaining
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e7e6dd]" role="progressbar" aria-label="Archive ingestion progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-[#567d69] transition-[width] duration-500" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex items-start gap-2 rounded-lg border border-[#e5e3da] bg-white/50 px-3 py-2.5">
                <UsersRound size={13} className="mt-0.5 shrink-0 text-[#6a8272]" aria-hidden="true" />
                <p className="text-[8px] leading-[1.65] text-[#777f77]">
                  <strong className="text-[#4d5f58]">Player match data:</strong> {summary.playerMatchCount.toLocaleString()} player-match records; {summary.playerWithStableIdCount.toLocaleString()} distinct players have source IDs and {summary.playerWithRatingCount.toLocaleString()} observations include ratings.
                </p>
              </div>
              <div className="rounded-lg border border-[#e5e3da] bg-white/50 px-3 py-2.5">
                <p className="text-[8px] leading-[1.65] text-[#777f77]">
                  <strong className="text-[#4d5f58]">Match / tactical context:</strong> {summary.eventCount.toLocaleString()} match events, {summary.tacticalProfileCount.toLocaleString()} lineup profiles ({summary.teamWithFormationCount.toLocaleString()} formations), and {summary.standingSnapshotCount.toLocaleString()} standings snapshots. {summary.coachWithStableIdCount.toLocaleString()} coaches have provider IDs.
                </p>
              </div>
            </div>

            {summary.skippedSourceFixtureCount > 0 && summary.lastError && (
              <p className="flex items-start gap-2 rounded-lg border border-[#e8d7b8] bg-[#fbf4e6] px-3 py-2.5 text-[8px] leading-[1.65] text-[#836c43]" role="status" data-testid="status-fair-ingestion-skips">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                {summary.skippedSourceFixtureCount.toLocaleString()} source fixtures were skipped. Latest issue: {summary.lastError}
              </p>
            )}

            {summary.status === 'failed' && summary.lastError && (
              <p className="rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-3 py-2 text-[8px] leading-[1.65] text-[#784b3e]" role="alert" data-testid="status-fair-ingestion-error">
                Import stopped: {summary.lastError}
              </p>
            )}

            <div className="rounded-lg border border-[#e7d8c9] bg-[#fbf5ee] px-3 py-2.5 text-[8px] leading-[1.7] text-[#806e60]" data-testid="note-fair-ai-source-limitations">
              <strong className="text-[#6d584a]">Source boundary:</strong> these are aggregate match and lineup records, not full player profiles. Coach identifiers, injury status, action coordinates, and tracking trajectories are not provided here. Tracked coordinate records: {summary.trackingCoordinateRecords}. Source IDs are preserved where present; name-only coaches remain name-keyed. Capture time: {formatTimestamp(summary.lastImportedAt)}.
            </div>

            {ingest.isError && (
              <p className="rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-3 py-2 text-[8px] leading-4 text-[#784b3e]" role="alert" data-testid="status-fair-ingestion-start-error">
                {readableError(ingest.error)}
              </p>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
