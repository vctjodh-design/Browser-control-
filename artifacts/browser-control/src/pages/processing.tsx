import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFootballProcessingForDateQueryKey,
  getGetFootballProcessedMatchesQueryKey,
  getGetFootballProcessingJobQueryKey,
  getGetFootballTesterMatchesQueryKey,
  getGetFootballTesterProcessingForDateQueryKey,
  useGetFootballProcessedMatches,
  useGetFootballProcessingForDate,
  useGetFootballProcessingJob,
  useGetFootballTesterMatches,
  useGetFootballTesterProcessingForDate,
  useStartFootballBulkProcessing,
  useStartFootballTesterProcessing,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Activity, Archive, CalendarDays, CircleAlert, Clock3, Database, FlaskConical, RefreshCw, Trophy } from 'lucide-react';

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function lastCompletedDate() {
  return localDate(new Date(Date.now() - 86400000));
}

function savedProcessingDate(storageKey = 'football-processing-date') {
  const urlDate = new URLSearchParams(window.location.search).get('date');
  try {
    const saved = urlDate ?? localStorage.getItem(storageKey);
    const parsed = saved ? new Date(`${saved}T00:00:00.000Z`) : null;
    const isValidPastDate = Boolean(
      saved &&
      /^\d{4}-\d{2}-\d{2}$/.test(saved) &&
      parsed &&
      parsed.toISOString().slice(0, 10) === saved &&
      saved < localDate(),
    );
    if (isValidPastDate && saved) {
      localStorage.setItem(storageKey, saved);
      return saved;
    }
  } catch {
    // Storage can be unavailable in private browsing; use the latest completed day.
  }
  return lastCompletedDate();
}

function readableError(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'The processing service could not be reached. Try again.';
}

function Header() {
  return <header className="border-b border-[#d9d8cf] bg-[#f7f5ef]">
    <div className="mx-auto flex min-h-[68px] max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7">
      <Link href="/" className="flex items-center gap-3" data-testid="link-brand-home">
        <span className="grid size-10 place-items-center rounded-[13px] bg-[#253746] text-[#f8f2e7]"><Trophy size={19} /></span>
        <span><strong className="block text-[14px] tracking-[-.04em] text-[#2b3e49]">Browser Control</strong><span className="text-[10px] text-[#858780]">Football research archive</span></span>
      </Link>
      <nav aria-label="Main navigation" className="flex items-center gap-1 rounded-xl border border-[#deddd3] bg-[#efeee7] p-1">
        <Link href="/processing" aria-current="page" className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#253746] px-3 text-[10px] font-extrabold text-[#f8f2e7]" data-testid="link-processing"><Activity size={13} /> Processing</Link>
        <Link href="/database" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]" data-testid="link-database"><Database size={13} /> Database</Link>
        <Link href="/tester" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]" data-testid="link-tester">Tester</Link>
        <Link href="/fixtures" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]" data-testid="link-fixtures"><CalendarDays size={13} /> Fixtures</Link>
      </nav>
    </div>
  </header>;
}

export default function ProcessingPage() {
  const client = useQueryClient();
  const [date, setDate] = useState(savedProcessingDate);
  const [testerDate, setTesterDate] = useState(() => savedProcessingDate('football-tester-date'));
  const lookupParams = { date };
  const testerLookupParams = { date: testerDate };
  const lookupQuery = useGetFootballProcessingForDate(lookupParams, {
    query: {
      enabled: Boolean(date),
      queryKey: getGetFootballProcessingForDateQueryKey(lookupParams),
      refetchOnMount: 'always',
    },
  });
  const jobId = lookupQuery.data?.job?.id ?? '';
  const start = useStartFootballBulkProcessing();
  const jobQuery = useGetFootballProcessingJob(jobId, {
    query: { enabled: Boolean(jobId), queryKey: getGetFootballProcessingJobQueryKey(jobId), refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'partial' || status === 'failed' ? false : 1200;
    } },
  });
  const resultsParams = { date, limit: 100, offset: 0 };
  const resultsQuery = useGetFootballProcessedMatches(resultsParams, {
    query: { queryKey: getGetFootballProcessedMatchesQueryKey(resultsParams) },
  });
  const testerLookupQuery = useGetFootballTesterProcessingForDate(testerLookupParams, {
    query: {
      enabled: Boolean(testerDate),
      queryKey: getGetFootballTesterProcessingForDateQueryKey(testerLookupParams),
      refetchOnMount: 'always',
    },
  });
  const testerJobId = testerLookupQuery.data?.job?.id ?? '';
  const startTester = useStartFootballTesterProcessing();
  const testerJobQuery = useGetFootballProcessingJob(testerJobId, {
    query: {
      enabled: Boolean(testerJobId),
      queryKey: getGetFootballProcessingJobQueryKey(testerJobId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'completed' || status === 'partial' || status === 'failed' ? false : 1200;
      },
    },
  });
  const testerResultsParams = { date: testerDate, limit: 100, offset: 0 };
  const testerResultsQuery = useGetFootballTesterMatches(testerResultsParams, {
    query: { queryKey: getGetFootballTesterMatchesQueryKey(testerResultsParams) },
  });
  const job = jobQuery.data;
  const terminal = job?.status === 'completed' || job?.status === 'partial' || job?.status === 'failed';
  const testerJob = testerJobQuery.data;
  const testerTerminal = testerJob?.status === 'completed' || testerJob?.status === 'partial' || testerJob?.status === 'failed';
  const archiveCanResume = Boolean(
    job &&
    job.date.slice(0, 10) === date &&
    (job.status === 'partial' || job.status === 'failed'),
  );
  const testerCanResume = Boolean(
    testerJob &&
    testerJob.date.slice(0, 10) === testerDate &&
    (testerJob.status === 'partial' || testerJob.status === 'failed'),
  );

  useEffect(() => {
    if (terminal) void client.invalidateQueries({ queryKey: getGetFootballProcessedMatchesQueryKey() });
  }, [client, date, terminal, job?.updatedAt]);
  useEffect(() => {
    if (testerTerminal) void client.invalidateQueries({ queryKey: getGetFootballTesterMatchesQueryKey() });
  }, [client, testerDate, testerTerminal, testerJob?.updatedAt]);

  const startArchive = () => {
    if (!date || start.isPending) return;
    start.mutate({ data: { date } }, {
      onSuccess: (created) => {
        try {
          localStorage.setItem('football-processing-date', date);
        } catch {
          // The server-side job remains discoverable even when browser storage is disabled.
        }
        client.setQueryData(getGetFootballProcessingJobQueryKey(created.id), created);
        client.setQueryData(getGetFootballProcessingForDateQueryKey(lookupParams), { job: created });
        void client.invalidateQueries({ queryKey: getGetFootballProcessedMatchesQueryKey({ date, limit: 100, offset: 0 }) });
      },
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startArchive();
  };
  const startTesterBuild = () => {
    if (!testerDate || startTester.isPending) return;
    startTester.mutate({ data: { date: testerDate } }, {
      onSuccess: (created) => {
        try {
          localStorage.setItem('football-tester-date', testerDate);
        } catch {
          // The server-side job remains discoverable even when browser storage is disabled.
        }
        client.setQueryData(getGetFootballProcessingJobQueryKey(created.id), created);
        client.setQueryData(getGetFootballTesterProcessingForDateQueryKey(testerLookupParams), { job: created });
        void client.invalidateQueries({ queryKey: getGetFootballTesterMatchesQueryKey(testerResultsParams) });
      },
    });
  };
  const submitTester = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTesterBuild();
  };
  const progress = job && job.totalFixtures > 0 ? Math.min(100, (job.processedFixtures / job.totalFixtures) * 100) : job?.status === 'completed' ? 100 : 0;
  const statusTone = job?.status === 'completed' ? 'bg-[#e5eee7] text-[#4e755c]' : job?.status === 'partial' ? 'bg-[#fbf1df] text-[#986b32]' : job?.status === 'failed' ? 'bg-[#f8e7de] text-[#ad5944]' : 'bg-[#e5eceb] text-[#527366]';
  const testerProgress = testerJob && testerJob.totalFixtures > 0 ? Math.min(100, (testerJob.processedFixtures / testerJob.totalFixtures) * 100) : testerJob?.status === 'completed' ? 100 : 0;
  const testerStatusTone = testerJob?.status === 'completed' ? 'bg-[#e5eee7] text-[#4e755c]' : testerJob?.status === 'partial' ? 'bg-[#fbf1df] text-[#986b32]' : testerJob?.status === 'failed' ? 'bg-[#f8e7de] text-[#ad5944]' : 'bg-[#e5eceb] text-[#527366]';

  return <main className="screen-noise min-h-[100dvh] bg-[#f2f0e8] text-[#243443]">
    <Header />
    <div className="mx-auto max-w-[1320px] px-4 pb-12 pt-7 sm:px-7 sm:pt-10">
      <div className="animate-rise mb-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,720px)] lg:items-end">
        <div>
          <p className="mono mb-2 text-[10px] uppercase tracking-[.19em] text-[#9b7160]">Archive operations / 01</p>
          <h1 className="max-w-[720px] text-[32px] font-extrabold leading-[1.04] tracking-[-.06em] text-[#263746] sm:text-[48px]">Turn match days into <span className="text-[#d96f51]">evidence.</span></h1>
          <p className="mt-3 max-w-[560px] text-[13px] leading-6 text-[#727973]">Choose a past match day to save completed results to Database or build outcome-free pre-match records for Tester.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <form onSubmit={submit} className="rounded-[15px] border border-[#d8d7ce] bg-[#f9f8f3] p-4 shadow-[0_10px_30px_rgba(47,59,64,.045)]" aria-label="Start completed-match import">
            <label htmlFor="processing-date" className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.13em] text-[#687570]">Completed match day · Database</label>
            <div className="flex gap-2">
              <input id="processing-date" type="date" max={lastCompletedDate()} value={date} onChange={(e) => {
                setDate(e.target.value);
                try {
                  localStorage.setItem('football-processing-date', e.target.value);
                } catch {
                  // The server-side job remains discoverable even when browser storage is disabled.
                }
              }} className="h-11 min-w-0 flex-1 rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] px-3 text-[12px] font-bold text-[#354750] focus:border-[#d96f51] focus:outline-none" data-testid="input-processing-date" />
              <button type="submit" disabled={!date || start.isPending} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-[#d96f51] px-4 text-[10px] font-extrabold text-white transition hover:bg-[#c95f43] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-start-import">
                {start.isPending ? <RefreshCw size={14} className="animate-spin" /> : archiveCanResume ? <RefreshCw size={14} /> : <Activity size={14} />} {start.isPending ? (archiveCanResume ? 'Resuming' : 'Starting') : archiveCanResume ? 'Resume import' : 'Import day'}
              </button>
            </div>
            <p className="mt-2 text-[9px] leading-4 text-[#858982]">All competitions · completed scores and outcomes are saved to Database.</p>
            {start.isError && <p role="alert" className="mt-2 text-[10px] text-[#a55242]">{readableError(start.error)}</p>}
          </form>
          <form onSubmit={submitTester} className="rounded-[15px] border border-[#d8d7ce] bg-[#f9f8f3] p-4 shadow-[0_10px_30px_rgba(47,59,64,.045)]" aria-label="Build pre-match tester records">
            <label htmlFor="tester-processing-date" className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.13em] text-[#687570]">Pre-match day · Tester</label>
            <div className="flex gap-2">
              <input id="tester-processing-date" type="date" max={lastCompletedDate()} value={testerDate} onChange={(e) => {
                setTesterDate(e.target.value);
                try {
                  localStorage.setItem('football-tester-date', e.target.value);
                } catch {
                  // The server-side job remains discoverable even when browser storage is disabled.
                }
              }} className="h-11 min-w-0 flex-1 rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] px-3 text-[12px] font-bold text-[#354750] focus:border-[#d96f51] focus:outline-none" data-testid="input-tester-processing-date" />
              <button type="submit" disabled={!testerDate || startTester.isPending} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-[#567d69] px-4 text-[10px] font-extrabold text-white transition hover:bg-[#456b58] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-start-tester">
                {startTester.isPending ? <RefreshCw size={14} className="animate-spin" /> : testerCanResume ? <RefreshCw size={14} /> : <FlaskConical size={14} />} {startTester.isPending ? (testerCanResume ? 'Resuming' : 'Starting') : testerCanResume ? 'Resume build' : 'Build records'}
              </button>
            </div>
            <p className="mt-2 text-[9px] leading-4 text-[#858982]">All fixtures · stores pre-match context only, never target scores or outcomes.</p>
            {startTester.isError && <p role="alert" className="mt-2 text-[10px] text-[#a55242]">{readableError(startTester.error)}</p>}
          </form>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)]">
        <section className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_16px_50px_rgba(47,59,64,.055)]" aria-labelledby="job-heading" data-testid="section-processing-job">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><Activity size={16} /></span><div><h2 id="job-heading" className="text-[14px] font-extrabold text-[#344550]">Import status</h2><p className="mt-0.5 text-[10px] text-[#858982]">Persistent job · live polling</p></div></div>
            {job && <span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[.1em] ${statusTone}`} data-testid="status-job">{job.status}</span>}
          </div>
          {lookupQuery.isLoading ? <div className="space-y-4 p-5" role="status" aria-label="Checking saved job state" data-testid="status-job-lookup-loading"><div className="h-3 w-36 animate-pulse rounded bg-[#e6e4dc]" /><div className="h-20 rounded-xl bg-[#eeede6]" /></div>
          : lookupQuery.isError ? <div className="m-5 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4" role="alert" data-testid="status-job-lookup-error"><div className="flex gap-2 text-[11px] font-bold text-[#784b3e]"><CircleAlert size={15} /> Couldn’t restore saved job</div><p className="mt-2 text-[10px] text-[#8c6b5e]">{readableError(lookupQuery.error)}</p><button onClick={() => void lookupQuery.refetch()} className="mt-3 inline-flex items-center gap-2 text-[10px] font-extrabold text-[#855542]"><RefreshCw size={12} /> Retry</button></div>
          : !jobId ? <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-12 text-center" data-testid="status-job-empty">
            <span className="grid size-12 place-items-center rounded-2xl border border-[#dfe4dc] bg-[#edf2ec] text-[#718879]"><Clock3 size={20} /></span><h3 className="mt-4 text-[15px] font-extrabold text-[#354750]">No import running</h3><p className="mt-2 max-w-[330px] text-[10px] leading-5 text-[#858982]">Choose a completed match day to create a job. Its progress and final counts will stay visible here.</p>
          </div> : jobQuery.isLoading ? <div className="space-y-4 p-5" role="status" aria-label="Loading job state" data-testid="status-job-loading"><div className="h-3 w-36 animate-pulse rounded bg-[#e6e4dc]" /><div className="h-3 w-full animate-pulse rounded bg-[#e9e8df]" /><div className="grid grid-cols-2 gap-3">{[0,1,2,3].map(i=><div key={i} className="h-16 animate-pulse rounded-lg bg-[#eeede6]" />)}</div></div> : jobQuery.isError ? <div className="m-5 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4" role="alert" data-testid="status-job-error"><div className="flex gap-2 text-[11px] font-bold text-[#784b3e]"><CircleAlert size={15} /> Couldn’t load job status</div><p className="mt-2 text-[10px] text-[#8c6b5e]">{readableError(jobQuery.error)}</p><button onClick={() => void jobQuery.refetch()} className="mt-3 inline-flex items-center gap-2 text-[10px] font-extrabold text-[#855542]"><RefreshCw size={12} /> Retry</button></div> : job ? <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mono text-[9px] uppercase tracking-[.13em] text-[#9b7160]">Match day · {job.date}</p><p className="mono mt-1 text-[9px] text-[#92958c]">JOB / {job.id}</p></div><span className="text-[9px] text-[#828980]">{terminal ? 'Finished' : 'Updated'} · {new Date(job.updatedAt).toLocaleString()}</span></div>
            <div className="mt-5 flex items-end justify-between gap-3"><div><span className="mono text-[31px] font-medium leading-none tracking-[-.07em] text-[#2f4a42]" data-testid="text-job-progress">{job.processedFixtures}</span><span className="mono ml-2 text-[11px] text-[#858982]">/ {job.totalFixtures} fixtures</span></div><span className="mono text-[12px] font-bold text-[#567d69]">{progress.toFixed(0)}%</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e7e6dd]" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-[#567d69] transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Saved', job.savedFixtures, 'text-[#4e755c]'], ['Skipped', job.skippedFixtures, 'text-[#8a7650]'], ['Failed', job.failedFixtures, 'text-[#ad5944]'], ['Total', job.totalFixtures, 'text-[#4a5c63]']].map(([label, value, tone]) => <div key={label} className="rounded-lg border border-[#e3e2d9] bg-[#f5f4ed] px-3 py-3"><p className="text-[8px] font-extrabold uppercase tracking-[.12em] text-[#90938a]">{label}</p><p className={`mono mt-1 text-[19px] font-medium ${tone}`}>{value}</p></div>)}
            </div>
            {job.error && <div role="status" className="mt-4 flex gap-2 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2.5 text-[10px] leading-5 text-[#84684f]"><CircleAlert size={13} className="mt-1 shrink-0" />{job.error}</div>}
            {job.status === 'partial' && <p className="mt-3 rounded-lg bg-[#fbf3e9] px-3 py-2.5 text-[9px] leading-4 text-[#84684f]" role="status">Some fixtures were skipped or failed. Resume to retry missing fixtures; saved records will be skipped.</p>}
            {job.status === 'failed' && <p className="mt-3 rounded-lg bg-[#fff2ed] px-3 py-2.5 text-[9px] leading-4 text-[#9c5949]" role="status">Resume this date to continue. Fixtures already saved will not be fetched again.</p>}
            {archiveCanResume && <button type="button" onClick={startArchive} disabled={start.isPending} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-[#d96f51] px-4 text-[10px] font-extrabold text-white transition hover:bg-[#c95f43] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-resume-import">{start.isPending ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}{start.isPending ? 'Resuming import' : 'Resume import'}</button>}
          </div> : null}
        </section>

        <section className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_16px_50px_rgba(47,59,64,.055)]" aria-labelledby="date-results-heading" data-testid="section-date-results">
          <div className="flex items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><Archive size={16} /></span><div><h2 id="date-results-heading" className="text-[14px] font-extrabold text-[#344550]">Saved for this date</h2><p className="mt-0.5 text-[10px] text-[#858982]">{date} · archive records</p></div></div><Link href="/database" className="text-[9px] font-extrabold text-[#668074] hover:text-[#d06c4f]" data-testid="link-open-date-database">Open archive</Link></div>
          {resultsQuery.isLoading ? <div className="space-y-3 p-4" role="status" aria-label="Loading saved date results">{[0,1,2,3].map(i=><div key={i} className="h-[54px] animate-pulse rounded-lg bg-[#eeede6]" />)}</div>
          : resultsQuery.isError ? <div className="m-4 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-4 text-[10px] text-[#8c6b5e]" role="alert"><p className="font-bold">Saved results unavailable.</p><p className="mt-1">{readableError(resultsQuery.error)}</p><button onClick={() => void resultsQuery.refetch()} className="mt-2 font-extrabold">Retry</button></div>
           : resultsQuery.data?.matches.length ? <div className="divide-y divide-[#e8e6de]" data-testid="list-date-results">{resultsQuery.data.matches.slice(0, 8).map((match) => <Link key={match.fixtureId} href={`/database?fixture=${match.fixtureId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-[#fbfaf6]" data-testid={`row-date-result-${match.fixtureId}`}><span className="min-w-0"><span className="block truncate text-[10px] font-bold text-[#455951]">{match.homeTeamName} <span className="font-medium text-[#9a9a90]">vs</span> {match.awayTeamName}</span><span className="mt-1 block truncate text-[8px] text-[#92958c]">{match.competition} · #{match.fixtureId}</span></span><span className="mono text-[13px] font-medium text-[#344c43]">{match.homeScore ?? '–'} : {match.awayScore ?? '–'}</span></Link>)}<div className="px-4 py-3 text-[9px] text-[#858982]">{resultsQuery.data.total} saved record{resultsQuery.data.total === 1 ? '' : 's'} for this date</div></div>
          : <div className="flex min-h-[230px] flex-col items-center justify-center px-6 py-10 text-center" data-testid="status-date-results-empty"><span className="grid size-11 place-items-center rounded-xl bg-[#edf2ec] text-[#718879]"><Archive size={18} /></span><h3 className="mt-3 text-[13px] font-extrabold text-[#354750]">Nothing archived yet</h3><p className="mt-1.5 max-w-[270px] text-[9px] leading-5 text-[#858982]">Completed match summaries saved for this date will appear here.</p></div>}
        </section>

        <section className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_16px_50px_rgba(47,59,64,.055)]" aria-labelledby="tester-job-heading" data-testid="section-tester-job">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><FlaskConical size={16} /></span><div><h2 id="tester-job-heading" className="text-[14px] font-extrabold text-[#344550]">Tester build status</h2><p className="mt-0.5 text-[10px] text-[#858982]">Pre-match only · live job progress</p></div></div>
            {testerJob && <span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[.1em] ${testerStatusTone}`} data-testid="status-tester-job">{testerJob.status}</span>}
          </div>
          {testerLookupQuery.isLoading ? <div className="space-y-4 p-5" role="status" aria-label="Checking tester job state" data-testid="status-tester-lookup-loading"><div className="h-3 w-36 animate-pulse rounded bg-[#e6e4dc]" /><div className="h-20 rounded-xl bg-[#eeede6]" /></div>
          : testerLookupQuery.isError ? <div className="m-5 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4" role="alert" data-testid="status-tester-lookup-error"><div className="flex gap-2 text-[11px] font-bold text-[#784b3e]"><CircleAlert size={15} /> Couldn’t restore tester job</div><p className="mt-2 text-[10px] text-[#8c6b5e]">{readableError(testerLookupQuery.error)}</p><button onClick={() => void testerLookupQuery.refetch()} className="mt-3 inline-flex items-center gap-2 text-[10px] font-extrabold text-[#855542]"><RefreshCw size={12} /> Retry</button></div>
          : !testerJobId ? <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-12 text-center" data-testid="status-tester-job-empty"><span className="grid size-12 place-items-center rounded-2xl border border-[#dfe4dc] bg-[#edf2ec] text-[#718879]"><Clock3 size={20} /></span><h3 className="mt-4 text-[15px] font-extrabold text-[#354750]">No tester build for this date</h3><p className="mt-2 max-w-[330px] text-[10px] leading-5 text-[#858982]">Choose a pre-match day above to build records for every fixture without storing target scores or outcomes.</p></div>
          : testerJobQuery.isLoading ? <div className="space-y-4 p-5" role="status" aria-label="Loading tester job state" data-testid="status-tester-job-loading"><div className="h-3 w-36 animate-pulse rounded bg-[#e6e4dc]" /><div className="h-3 w-full animate-pulse rounded bg-[#e9e8df]" /><div className="grid grid-cols-2 gap-3">{[0,1,2,3].map(i=><div key={i} className="h-16 animate-pulse rounded-lg bg-[#eeede6]" />)}</div></div>
          : testerJobQuery.isError ? <div className="m-5 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4" role="alert" data-testid="status-tester-job-error"><div className="flex gap-2 text-[11px] font-bold text-[#784b3e]"><CircleAlert size={15} /> Couldn’t load tester job</div><p className="mt-2 text-[10px] text-[#8c6b5e]">{readableError(testerJobQuery.error)}</p><button onClick={() => void testerJobQuery.refetch()} className="mt-3 inline-flex items-center gap-2 text-[10px] font-extrabold text-[#855542]"><RefreshCw size={12} /> Retry</button></div>
          : testerJob ? <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mono text-[9px] uppercase tracking-[.13em] text-[#9b7160]">Pre-match day · {testerJob.date}</p><p className="mono mt-1 text-[9px] text-[#92958c]">JOB / {testerJob.id}</p></div><span className="text-[9px] text-[#828980]">{testerTerminal ? 'Finished' : 'Updated'} · {new Date(testerJob.updatedAt).toLocaleString()}</span></div>
            <div className="mt-5 flex items-end justify-between gap-3"><div><span className="mono text-[31px] font-medium leading-none tracking-[-.07em] text-[#2f4a42]" data-testid="text-tester-job-progress">{testerJob.processedFixtures}</span><span className="mono ml-2 text-[11px] text-[#858982]">/ {testerJob.totalFixtures} fixtures</span></div><span className="mono text-[12px] font-bold text-[#567d69]">{testerProgress.toFixed(0)}%</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e7e6dd]" role="progressbar" aria-valuenow={testerProgress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-[#567d69] transition-[width] duration-500" style={{ width: `${testerProgress}%` }} /></div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Saved', testerJob.savedFixtures, 'text-[#4e755c]'], ['Skipped', testerJob.skippedFixtures, 'text-[#8a7650]'], ['Failed', testerJob.failedFixtures, 'text-[#ad5944]'], ['Total', testerJob.totalFixtures, 'text-[#4a5c63]']].map(([label, value, tone]) => <div key={label} className="rounded-lg border border-[#e3e2d9] bg-[#f5f4ed] px-3 py-3"><p className="text-[8px] font-extrabold uppercase tracking-[.12em] text-[#90938a]">{label}</p><p className={`mono mt-1 text-[19px] font-medium ${tone}`}>{value}</p></div>)}
            </div>
            {testerJob.error && <div role="status" className="mt-4 flex gap-2 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2.5 text-[10px] leading-5 text-[#84684f]"><CircleAlert size={13} className="mt-1 shrink-0" />{testerJob.error}</div>}
            {testerJob.status === 'partial' && <p className="mt-3 rounded-lg bg-[#fbf3e9] px-3 py-2.5 text-[9px] leading-4 text-[#84684f]" role="status">Some fixtures were skipped or failed. Resume to retry missing pre-match records; saved records will be skipped.</p>}
            {testerJob.status === 'failed' && <p className="mt-3 rounded-lg bg-[#fff2ed] px-3 py-2.5 text-[9px] leading-4 text-[#9c5949]" role="status">Resume this date to continue. Saved pre-match records will not be fetched again.</p>}
            {testerCanResume && <button type="button" onClick={startTesterBuild} disabled={startTester.isPending} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-[#567d69] px-4 text-[10px] font-extrabold text-white transition hover:bg-[#456b58] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-resume-tester">{startTester.isPending ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}{startTester.isPending ? 'Resuming build' : 'Resume build'}</button>}
          </div> : null}
        </section>

        <section className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_16px_50px_rgba(47,59,64,.055)]" aria-labelledby="tester-results-heading" data-testid="section-tester-results">
          <div className="flex items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><FlaskConical size={16} /></span><div><h2 id="tester-results-heading" className="text-[14px] font-extrabold text-[#344550]">Tester records for this date</h2><p className="mt-0.5 text-[10px] text-[#858982]" data-testid="text-tester-record-count">{testerResultsQuery.data ? `${testerResultsQuery.data.total} records · ${testerDate}` : `${testerDate} · pre-match only`}</p></div></div><Link href="/tester" className="text-[9px] font-extrabold text-[#668074] hover:text-[#d06c4f]" data-testid="link-open-tester">Open Tester</Link></div>
          {testerResultsQuery.isLoading ? <div className="space-y-3 p-4" role="status" aria-label="Loading tester results">{[0,1,2,3].map(i=><div key={i} className="h-[54px] animate-pulse rounded-lg bg-[#eeede6]" />)}</div>
          : testerResultsQuery.isError ? <div className="m-4 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-4 text-[10px] text-[#8c6b5e]" role="alert"><p className="font-bold">Tester records unavailable.</p><p className="mt-1">{readableError(testerResultsQuery.error)}</p><button onClick={() => void testerResultsQuery.refetch()} className="mt-2 font-extrabold">Retry</button></div>
          : testerResultsQuery.data?.matches.length ? <div className="divide-y divide-[#e8e6de]" data-testid="list-tester-date-results">{testerResultsQuery.data.matches.slice(0, 8).map((match) => <Link key={match.fixtureId} href={`/tester?fixture=${match.fixtureId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-[#fbfaf6]" data-testid={`row-tester-result-${match.fixtureId}`}><span className="min-w-0"><span className="block truncate text-[10px] font-bold text-[#455951]">{match.homeTeamName} <span className="font-medium text-[#9a9a90]">vs</span> {match.awayTeamName}</span><span className="mt-1 block truncate text-[8px] text-[#92958c]">{match.competition} · #{match.fixtureId}</span></span><span className="mono text-[9px] font-extrabold uppercase tracking-[.08em] text-[#567d69]">Pre-match</span></Link>)}<div className="px-4 py-3 text-[9px] text-[#858982]">{testerResultsQuery.data.total} tester record{testerResultsQuery.data.total === 1 ? '' : 's'} for this date</div></div>
          : <div className="flex min-h-[230px] flex-col items-center justify-center px-6 py-10 text-center" data-testid="status-tester-results-empty"><span className="grid size-11 place-items-center rounded-xl bg-[#edf2ec] text-[#718879]"><FlaskConical size={18} /></span><h3 className="mt-3 text-[13px] font-extrabold text-[#354750]">No tester records for this date</h3><p className="mt-1.5 max-w-[270px] text-[9px] leading-5 text-[#858982]">Build pre-match records above to see all fixtures for this day here.</p></div>}
        </section>
      </div>
      <footer className="mt-5 flex items-center gap-2 px-1 text-[9px] text-[#8b8d84]"><Database size={12} /> Database imports store completed scores and outcomes; Tester builds store only pre-match records without the target fixture’s score or outcome.</footer>
    </div>
  </main>;
}
