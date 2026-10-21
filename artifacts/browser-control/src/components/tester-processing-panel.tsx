import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFootballTesterMatchesQueryKey,
  getGetFootballTesterProcessingForDateQueryKey,
  getGetFootballProcessingJobQueryKey,
  useGetFootballProcessingJob,
  useGetFootballTesterMatches,
  useGetFootballTesterProcessingForDate,
  useStartFootballTesterProcessing,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Activity, Archive, CircleAlert, Clock3, RefreshCw, ShieldCheck } from 'lucide-react';

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function lastCompletedDate() {
  return localDate(new Date(Date.now() - 86400000));
}

function initialTesterDate() {
  try {
    const saved = localStorage.getItem('football-tester-date');
    const parsed = saved ? new Date(`${saved}T00:00:00.000Z`) : null;
    if (
      saved &&
      /^\d{4}-\d{2}-\d{2}$/.test(saved) &&
      parsed &&
      parsed.toISOString().slice(0, 10) === saved &&
      saved < localDate()
    ) return saved;
  } catch {
    // Storage can be unavailable in private browsing.
  }
  return lastCompletedDate();
}

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
  }
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Tester processing could not be reached. Try again.';
}

export default function TesterProcessingPanel() {
  const client = useQueryClient();
  const [date, setDate] = useState(initialTesterDate);
  const lookupParams = { date };
  const lookupQuery = useGetFootballTesterProcessingForDate(lookupParams, {
    query: {
      enabled: Boolean(date),
      queryKey: getGetFootballTesterProcessingForDateQueryKey(lookupParams),
      refetchOnMount: 'always',
    },
  });
  const jobId = lookupQuery.data?.job?.id ?? '';
  const start = useStartFootballTesterProcessing();
  const jobQuery = useGetFootballProcessingJob(jobId, {
    query: {
      enabled: Boolean(jobId),
      queryKey: getGetFootballProcessingJobQueryKey(jobId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'completed' || status === 'partial' || status === 'failed' ? false : 1200;
      },
    },
  });
  const resultsParams = { date, limit: 6, offset: 0 };
  const resultsQuery = useGetFootballTesterMatches(resultsParams, {
    query: { queryKey: getGetFootballTesterMatchesQueryKey(resultsParams) },
  });
  const job = jobQuery.data;
  const terminal = job?.status === 'completed' || job?.status === 'partial' || job?.status === 'failed';
  const progress = job && job.totalFixtures > 0
    ? Math.min(100, (job.processedFixtures / job.totalFixtures) * 100)
    : job?.status === 'completed' ? 100 : 0;

  useEffect(() => {
    if (terminal) void client.invalidateQueries({ queryKey: getGetFootballTesterMatchesQueryKey() });
  }, [client, date, terminal, job?.updatedAt]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!date || start.isPending) return;
    start.mutate({ data: { date } }, {
      onSuccess: (created) => {
        try {
          localStorage.setItem('football-tester-date', date);
        } catch {
          // The saved tester job remains available from its date when storage is enabled.
        }
        client.setQueryData(getGetFootballProcessingJobQueryKey(created.id), created);
        client.setQueryData(getGetFootballTesterProcessingForDateQueryKey(lookupParams), { job: created });
        void client.invalidateQueries({ queryKey: getGetFootballTesterMatchesQueryKey({ date, limit: 6, offset: 0 }) });
      },
    });
  };

  return <section className="mb-5 overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_16px_50px_rgba(47,59,64,.055)]" aria-labelledby="tester-job-heading" data-testid="section-tester-processing">
    <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)]">
      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><ShieldCheck size={16} /></span><div><h2 id="tester-job-heading" className="text-[14px] font-extrabold text-[#344550]">Build pre-match tester data</h2><p className="mt-0.5 text-[10px] text-[#858982]">Target-match scores and outcomes are not stored</p></div></div>
        <form onSubmit={submit} className="mt-4" aria-label="Start pre-match tester import">
          <label htmlFor="tester-processing-date" className="mb-2 block text-[9px] font-extrabold uppercase tracking-[.13em] text-[#687570]">Tester match day</label>
          <div className="flex gap-2">
            <input id="tester-processing-date" type="date" max={lastCompletedDate()} value={date} onChange={(event) => {
              setDate(event.target.value);
              try {
                localStorage.setItem('football-tester-date', event.target.value);
              } catch {
                // The selected date remains available for this page session.
              }
            }} className="h-10 min-w-0 flex-1 rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] px-3 text-[11px] font-bold text-[#354750] focus:border-[#d96f51] focus:outline-none" data-testid="input-tester-date" />
            <button type="submit" disabled={!date || start.isPending} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[#668574] px-3.5 text-[9px] font-extrabold text-white transition hover:bg-[#557460] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-start-tester-import">
              {start.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Activity size={13} />} {start.isPending ? 'Starting' : 'Build tester set'}
            </button>
          </div>
          <p className="mt-2 text-[9px] leading-4 text-[#858982]">All competitions on this date. Form and H2H are filtered to matches before kickoff; latest available standings may not be a historical match-day snapshot.</p>
          {start.isError && <p role="alert" className="mt-2 text-[10px] text-[#a55242]" data-testid="error-start-tester">{errorText(start.error)}</p>}
        </form>
      </div>

      <div className="border-t border-[#e1dfd7] bg-[#f4f3ed] p-4 sm:p-5 lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Activity size={14} className="text-[#537867]" /><h3 className="text-[11px] font-extrabold text-[#344550]">Tester job status</h3></div>{job && <span className="rounded-full bg-[#e5eceb] px-2 py-1 text-[8px] font-extrabold uppercase text-[#527366]" data-testid="status-tester-job">{job.status}</span>}</div>
        {lookupQuery.isLoading ? <div className="mt-4 h-14 animate-pulse rounded-lg bg-[#e9e8df]" role="status" aria-label="Checking tester job" />
          : lookupQuery.isError ? <div className="mt-3 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-3 text-[9px] text-[#8c6b5e]" role="alert" data-testid="error-tester-job-lookup"><p>{errorText(lookupQuery.error)}</p><button type="button" onClick={() => void lookupQuery.refetch()} className="mt-2 inline-flex items-center gap-1 font-extrabold"><RefreshCw size={11} /> Retry</button></div>
            : !jobId ? <div className="mt-4 flex items-center gap-2 text-[9px] text-[#858982]" data-testid="empty-tester-job"><Clock3 size={13} /> No tester job for {date || 'this date'}.</div>
              : jobQuery.isLoading ? <div className="mt-4 h-14 animate-pulse rounded-lg bg-[#e9e8df]" role="status" aria-label="Loading tester job" />
                : jobQuery.isError ? <div className="mt-3 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-3 text-[9px] text-[#8c6b5e]" role="alert">{errorText(jobQuery.error)} <button type="button" onClick={() => void jobQuery.refetch()} className="font-extrabold">Retry</button></div>
                  : job ? <div className="mt-4" data-testid="tester-job-progress">
                    <div className="flex items-end justify-between gap-3"><span className="mono text-[16px] font-medium text-[#2f4a42]">{job.processedFixtures}<span className="ml-1.5 text-[9px] text-[#858982]">/ {job.totalFixtures}</span></span><span className="mono text-[9px] font-bold text-[#567d69]">{progress.toFixed(0)}%</span></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e4e3db]" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-[#668574] transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
                    <p className="mt-2 text-[8px] text-[#858982]">Saved {job.savedFixtures} · skipped {job.skippedFixtures} · failed {job.failedFixtures}</p>
                    {job.error && <p className="mt-2 text-[8px] leading-4 text-[#84684f]" role="status">{job.error}</p>}
                  </div> : null}
        {resultsQuery.data && resultsQuery.data.total > 0 && <div className="mt-4 border-t border-[#e1dfd7] pt-3">
          <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-1.5 text-[8px] font-extrabold text-[#60756a]"><Archive size={11} /> {resultsQuery.data.total} tester record{resultsQuery.data.total === 1 ? '' : 's'} saved for {date}</span><Link href="/tester" className="text-[8px] font-extrabold text-[#60756a] hover:text-[#d06c4f]" data-testid="link-open-tester">Open tester</Link></div>
          <div className="space-y-1.5">{resultsQuery.data.matches.slice(0, 4).map((match) => <div key={match.fixtureId} className="flex items-center justify-between gap-2 text-[8px] text-[#52615e]"><span className="truncate">{match.homeTeamName} vs {match.awayTeamName}</span><span className="shrink-0 rounded-full bg-[#e8eee8] px-1.5 py-0.5 text-[7px] font-extrabold text-[#60756a]">PRE-MATCH</span></div>)}</div>
        </div>}
      </div>
    </div>
  </section>;
}
