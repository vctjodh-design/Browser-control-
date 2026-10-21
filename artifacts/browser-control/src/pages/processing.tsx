import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFootballProcessedMatchesQueryKey,
  getGetFootballProcessingJobQueryKey,
  useGetFootballProcessedMatches,
  useGetFootballProcessingJob,
  useStartFootballBulkProcessing,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Activity, Archive, CalendarDays, CircleAlert, Clock3, Database, RefreshCw, Trophy } from 'lucide-react';

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function lastCompletedDate() {
  return localDate(new Date(Date.now() - 86400000));
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
        <Link href="/fixtures" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]" data-testid="link-fixtures"><CalendarDays size={13} /> Fixtures</Link>
      </nav>
    </div>
  </header>;
}

export default function ProcessingPage() {
  const client = useQueryClient();
  const [date, setDate] = useState(lastCompletedDate);
  const [jobId, setJobId] = useState('');
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
  const job = jobQuery.data;
  const terminal = job?.status === 'completed' || job?.status === 'partial' || job?.status === 'failed';

  useEffect(() => {
    if (terminal) void client.invalidateQueries({ queryKey: getGetFootballProcessedMatchesQueryKey() });
  }, [client, date, terminal, job?.updatedAt]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!date || start.isPending) return;
    start.mutate({ data: { date } }, {
      onSuccess: (created) => {
        setJobId(created.id);
        client.setQueryData(getGetFootballProcessingJobQueryKey(created.id), created);
        void client.invalidateQueries({ queryKey: getGetFootballProcessedMatchesQueryKey({ date, limit: 100, offset: 0 }) });
      },
    });
  };
  const progress = job && job.totalFixtures > 0 ? Math.min(100, (job.processedFixtures / job.totalFixtures) * 100) : job?.status === 'completed' ? 100 : 0;
  const statusTone = job?.status === 'completed' ? 'bg-[#e5eee7] text-[#4e755c]' : job?.status === 'partial' ? 'bg-[#fbf1df] text-[#986b32]' : job?.status === 'failed' ? 'bg-[#f8e7de] text-[#ad5944]' : 'bg-[#e5eceb] text-[#527366]';

  return <main className="screen-noise min-h-[100dvh] bg-[#f2f0e8] text-[#243443]">
    <Header />
    <div className="mx-auto max-w-[1320px] px-4 pb-12 pt-7 sm:px-7 sm:pt-10">
      <div className="animate-rise mb-7 grid gap-7 lg:grid-cols-[1fr_360px] lg:items-end">
        <div>
          <p className="mono mb-2 text-[10px] uppercase tracking-[.19em] text-[#9b7160]">Archive operations / 01</p>
          <h1 className="max-w-[720px] text-[32px] font-extrabold leading-[1.04] tracking-[-.06em] text-[#263746] sm:text-[48px]">Turn match days into <span className="text-[#d96f51]">evidence.</span></h1>
          <p className="mt-3 max-w-[560px] text-[13px] leading-6 text-[#727973]">Import completed fixtures across competitions, then follow each persistent job as it enriches the archive.</p>
        </div>
        <form onSubmit={submit} className="rounded-[15px] border border-[#d8d7ce] bg-[#f9f8f3] p-4 shadow-[0_10px_30px_rgba(47,59,64,.045)]" aria-label="Start match-day import">
          <label htmlFor="processing-date" className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.13em] text-[#687570]">Completed match day</label>
          <div className="flex gap-2">
            <input id="processing-date" type="date" max={lastCompletedDate()} value={date} onChange={(e) => setDate(e.target.value)} className="h-11 min-w-0 flex-1 rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] px-3 text-[12px] font-bold text-[#354750] focus:border-[#d96f51] focus:outline-none" data-testid="input-processing-date" />
            <button type="submit" disabled={!date || start.isPending} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-[#d96f51] px-4 text-[10px] font-extrabold text-white transition hover:bg-[#c95f43] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-start-import">
              {start.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />} {start.isPending ? 'Starting' : 'Import day'}
            </button>
          </div>
          <p className="mt-2 text-[9px] leading-4 text-[#858982]">All competitions · completed scores only. Unfinished fixtures are skipped by the importer.</p>
          {start.isError && <p role="alert" className="mt-2 text-[10px] text-[#a55242]">{readableError(start.error)}</p>}
        </form>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)]">
        <section className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_16px_50px_rgba(47,59,64,.055)]" aria-labelledby="job-heading" data-testid="section-processing-job">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><Activity size={16} /></span><div><h2 id="job-heading" className="text-[14px] font-extrabold text-[#344550]">Import status</h2><p className="mt-0.5 text-[10px] text-[#858982]">Persistent job · live polling</p></div></div>
            {job && <span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[.1em] ${statusTone}`} data-testid="status-job">{job.status}</span>}
          </div>
          {!jobId ? <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-12 text-center" data-testid="status-job-empty">
            <span className="grid size-12 place-items-center rounded-2xl border border-[#dfe4dc] bg-[#edf2ec] text-[#718879]"><Clock3 size={20} /></span><h3 className="mt-4 text-[15px] font-extrabold text-[#354750]">No import running</h3><p className="mt-2 max-w-[330px] text-[10px] leading-5 text-[#858982]">Choose a completed match day to create a job. Its progress and final counts will stay visible here.</p>
          </div> : jobQuery.isLoading ? <div className="space-y-4 p-5" role="status" aria-label="Loading job state" data-testid="status-job-loading"><div className="h-3 w-36 animate-pulse rounded bg-[#e6e4dc]" /><div className="h-3 w-full animate-pulse rounded bg-[#e9e8df]" /><div className="grid grid-cols-2 gap-3">{[0,1,2,3].map(i=><div key={i} className="h-16 animate-pulse rounded-lg bg-[#eeede6]" />)}</div></div> : jobQuery.isError ? <div className="m-5 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4" role="alert" data-testid="status-job-error"><div className="flex gap-2 text-[11px] font-bold text-[#784b3e]"><CircleAlert size={15} /> Couldn’t load job status</div><p className="mt-2 text-[10px] text-[#8c6b5e]">{readableError(jobQuery.error)}</p><button onClick={() => void jobQuery.refetch()} className="mt-3 inline-flex items-center gap-2 text-[10px] font-extrabold text-[#855542]"><RefreshCw size={12} /> Retry</button></div> : job ? <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mono text-[9px] uppercase tracking-[.13em] text-[#9b7160]">Match day · {job.date}</p><p className="mono mt-1 text-[9px] text-[#92958c]">JOB / {job.id}</p></div><span className="text-[9px] text-[#828980]">{terminal ? 'Finished' : 'Updated'} · {new Date(job.updatedAt).toLocaleString()}</span></div>
            <div className="mt-5 flex items-end justify-between gap-3"><div><span className="mono text-[31px] font-medium leading-none tracking-[-.07em] text-[#2f4a42]" data-testid="text-job-progress">{job.processedFixtures}</span><span className="mono ml-2 text-[11px] text-[#858982]">/ {job.totalFixtures} fixtures</span></div><span className="mono text-[12px] font-bold text-[#567d69]">{progress.toFixed(0)}%</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e7e6dd]" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-[#567d69] transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Saved', job.savedFixtures, 'text-[#4e755c]'], ['Skipped', job.skippedFixtures, 'text-[#8a7650]'], ['Failed', job.failedFixtures, 'text-[#ad5944]'], ['Total', job.totalFixtures, 'text-[#4a5c63]']].map(([label, value, tone]) => <div key={label} className="rounded-lg border border-[#e3e2d9] bg-[#f5f4ed] px-3 py-3"><p className="text-[8px] font-extrabold uppercase tracking-[.12em] text-[#90938a]">{label}</p><p className={`mono mt-1 text-[19px] font-medium ${tone}`}>{value}</p></div>)}
            </div>
            {job.error && <div role="status" className="mt-4 flex gap-2 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2.5 text-[10px] leading-5 text-[#84684f]"><CircleAlert size={13} className="mt-1 shrink-0" />{job.error}</div>}
            {job.status === 'partial' && <p className="mt-3 rounded-lg bg-[#fbf3e9] px-3 py-2.5 text-[9px] leading-4 text-[#84684f]" role="status">Import finished with gaps. Review saved records and issue counts before relying on this date.</p>}
            {job.status === 'failed' && <p className="mt-3 rounded-lg bg-[#fff2ed] px-3 py-2.5 text-[9px] leading-4 text-[#9c5949]" role="status">The job did not complete. Its reported counts are retained for inspection.</p>}
          </div> : null}
        </section>

        <section className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_16px_50px_rgba(47,59,64,.055)]" aria-labelledby="date-results-heading" data-testid="section-date-results">
          <div className="flex items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><Archive size={16} /></span><div><h2 id="date-results-heading" className="text-[14px] font-extrabold text-[#344550]">Saved for this date</h2><p className="mt-0.5 text-[10px] text-[#858982]">{date} · archive records</p></div></div><Link href={`/database?date=${date}`} className="text-[9px] font-extrabold text-[#668074] hover:text-[#d06c4f]" data-testid="link-open-date-database">Open archive</Link></div>
          {resultsQuery.isLoading ? <div className="space-y-3 p-4" role="status" aria-label="Loading saved date results">{[0,1,2,3].map(i=><div key={i} className="h-[54px] animate-pulse rounded-lg bg-[#eeede6]" />)}</div>
          : resultsQuery.isError ? <div className="m-4 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-4 text-[10px] text-[#8c6b5e]" role="alert"><p className="font-bold">Saved results unavailable.</p><p className="mt-1">{readableError(resultsQuery.error)}</p><button onClick={() => void resultsQuery.refetch()} className="mt-2 font-extrabold">Retry</button></div>
          : resultsQuery.data?.matches.length ? <div className="divide-y divide-[#e8e6de]" data-testid="list-date-results">{resultsQuery.data.matches.slice(0, 8).map((match) => <Link key={match.fixtureId} href={`/database?date=${date}&fixture=${match.fixtureId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-[#fbfaf6]" data-testid={`row-date-result-${match.fixtureId}`}><span className="min-w-0"><span className="block truncate text-[10px] font-bold text-[#455951]">{match.homeTeamName} <span className="font-medium text-[#9a9a90]">vs</span> {match.awayTeamName}</span><span className="mt-1 block truncate text-[8px] text-[#92958c]">{match.competition} · #{match.fixtureId}</span></span><span className="mono text-[13px] font-medium text-[#344c43]">{match.homeScore ?? '–'} : {match.awayScore ?? '–'}</span></Link>)}<div className="px-4 py-3 text-[9px] text-[#858982]">{resultsQuery.data.total} saved record{resultsQuery.data.total === 1 ? '' : 's'} for this date</div></div>
          : <div className="flex min-h-[230px] flex-col items-center justify-center px-6 py-10 text-center" data-testid="status-date-results-empty"><span className="grid size-11 place-items-center rounded-xl bg-[#edf2ec] text-[#718879]"><Archive size={18} /></span><h3 className="mt-3 text-[13px] font-extrabold text-[#354750]">Nothing archived yet</h3><p className="mt-1.5 max-w-[270px] text-[9px] leading-5 text-[#858982]">Completed match summaries saved for this date will appear here.</p></div>}
        </section>
      </div>
      <footer className="mt-5 flex items-center gap-2 px-1 text-[9px] text-[#8b8d84]"><Database size={12} /> Job state is persistent; only completed matches are saved with scores and outcomes.</footer>
    </div>
  </main>;
}
