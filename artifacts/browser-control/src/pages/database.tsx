import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFootballProcessedMatchPayloadQueryKey,
  getGetFootballProcessedMatchQueryKey,
  getGetFootballProcessedMatchesQueryKey,
  getGetFootballTesterMatchPayloadQueryKey,
  getGetFootballTesterMatchQueryKey,
  getGetFootballTesterMatchesQueryKey,
  useDeleteAllFootballProcessedMatches,
  useDeleteAllFootballTesterMatches,
  useGetFootballProcessedMatch,
  useGetFootballProcessedMatchPayload,
  useGetFootballProcessedMatches,
  useGetFootballTesterMatch,
  useGetFootballTesterMatchPayload,
  useGetFootballTesterMatches,
} from '@workspace/api-client-react';
import type { FootballProcessedMatchSummary, FootballTesterMatchSummary } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { Archive, Braces, CalendarDays, Check, ChevronRight, CircleAlert, Database, FileJson2, FlaskConical, RefreshCw, Search, Trash2, Trophy, X } from 'lucide-react';

type ArchiveKind = 'database' | 'tester';
type ArchiveRecord = FootballProcessedMatchSummary | FootballTesterMatchSummary;

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
  }
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'The archive could not be reached. Please try again.';
}
function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
function score(summary: FootballProcessedMatchSummary) {
  return summary.homeScore === null || summary.awayScore === null ? '— : —' : `${summary.homeScore} : ${summary.awayScore}`;
}
function Header({ kind }: { kind: ArchiveKind }) {
  const activeClass = 'inline-flex h-8 items-center gap-2 rounded-lg bg-[#253746] px-3 text-[10px] font-extrabold text-[#f8f2e7]';
  const idleClass = 'inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]';
  return <header className="border-b border-[#d9d8cf] bg-[#f7f5ef]"><div className="mx-auto flex min-h-[68px] max-w-[1420px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7">
    <Link href="/" className="flex items-center gap-3" data-testid="link-brand-home"><span className="grid size-10 place-items-center rounded-[13px] bg-[#253746] text-[#f8f2e7]"><Trophy size={19} /></span><span><strong className="block text-[14px] tracking-[-.04em] text-[#2b3e49]">Browser Control</strong><span className="text-[10px] text-[#858780]">Football research archive</span></span></Link>
    <nav aria-label="Main navigation" className="flex items-center gap-1 rounded-xl border border-[#deddd3] bg-[#efeee7] p-1">
      <Link href="/processing" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]" data-testid="link-processing"><RefreshCw size={13} /> Processing</Link>
      <Link href="/database" aria-current={kind === 'database' ? 'page' : undefined} className={kind === 'database' ? activeClass : idleClass} data-testid="link-database"><Database size={13} /> Database</Link>
      <Link href="/tester" aria-current={kind === 'tester' ? 'page' : undefined} className={kind === 'tester' ? activeClass : idleClass} data-testid="link-tester"><FlaskConical size={13} /> Tester</Link>
      <Link href="/fixtures" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]" data-testid="link-fixtures"><CalendarDays size={13} /> Fixtures</Link>
    </nav>
  </div></header>;
}
function DataBlock({
  fixtureId,
  section,
  title,
  kind,
}: {
  fixtureId: number;
  section: 'details' | 'lastFive' | 'tmp';
  title: string;
  kind: ArchiveKind;
}) {
  const [open, setOpen] = useState(false);
  const params = { fixtureId, section };
  const archiveQuery = useGetFootballProcessedMatchPayload(params, {
    query: {
      enabled: open && kind === 'database',
      queryKey: getGetFootballProcessedMatchPayloadQueryKey(params),
      staleTime: Number.POSITIVE_INFINITY,
    },
  });
  const testerQuery = useGetFootballTesterMatchPayload(params, {
    query: {
      enabled: open && kind === 'tester',
      queryKey: getGetFootballTesterMatchPayloadQueryKey(params),
      staleTime: Number.POSITIVE_INFINITY,
    },
  });
  const payloadQuery = kind === 'database' ? archiveQuery : testerQuery;
  const text = payloadQuery.data ? JSON.stringify(payloadQuery.data.payload, null, 2) : '';
  return <details className="group overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3 outline-none hover:bg-[#eeeee6]">
      <span className="flex items-center gap-2 text-[10px] font-extrabold text-[#43575a]"><Braces size={14} className="text-[#9b7160]" />{title}</span><ChevronRight size={14} className="text-[#92958c] transition-transform group-open:rotate-90" />
    </summary>
    {open && (payloadQuery.isLoading ? <div className="p-4 text-[10px] text-[#858982]" role="status">Loading compressed payload…</div>
      : payloadQuery.isError ? <div className="p-4 text-[10px] text-[#8c6b5e]" role="alert"><p>{errorText(payloadQuery.error)}</p><button type="button" onClick={() => void payloadQuery.refetch()} className="mt-2 font-extrabold text-[#855542]">Retry</button></div>
        : <pre className="max-h-[440px] overflow-auto whitespace-pre-wrap break-words p-4 text-[9px] leading-[1.7] text-[#52615e]">{text}</pre>)}
  </details>;
}
function DetailPanel({ fixtureId, kind }: { fixtureId: number | null; kind: ArchiveKind }) {
  const valid = fixtureId !== null && Number.isSafeInteger(fixtureId) && fixtureId > 0;
  const archiveQuery = useGetFootballProcessedMatch(valid ? fixtureId : 0, {
    query: { enabled: valid && kind === 'database', queryKey: getGetFootballProcessedMatchQueryKey(valid ? fixtureId : 0) },
  });
  const testerQuery = useGetFootballTesterMatch(valid ? fixtureId : 0, {
    query: { enabled: valid && kind === 'tester', queryKey: getGetFootballTesterMatchQueryKey(valid ? fixtureId : 0) },
  });
  const recordQuery = kind === 'database' ? archiveQuery : testerQuery;
  const record = recordQuery.data;
  if (!valid) return <section className="flex min-h-[460px] flex-col items-center justify-center rounded-[16px] border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-6 py-12 text-center" data-testid="status-record-unselected"><span className="grid size-12 place-items-center rounded-2xl bg-[#e8eee8] text-[#6b8375]"><FileJson2 size={20} /></span><h2 className="mt-4 text-[15px] font-extrabold text-[#354750]">Select a saved {kind === 'tester' ? 'tester match' : 'match'}</h2><p className="mt-2 max-w-[300px] text-[10px] leading-5 text-[#858982]">Its stored pre-match features and context will be shown here without recomputation.</p></section>;
  if (recordQuery.isLoading) return <section className="space-y-3 rounded-[16px] border border-[#deddd4] bg-[#f9f8f3] p-5" role="status" aria-label="Loading stored record" data-testid="status-record-loading"><div className="h-3 w-40 animate-pulse rounded bg-[#e6e4dc]" /><div className="h-20 animate-pulse rounded-xl bg-[#eeede6]" />{[0,1,2].map((i)=><div key={i} className="h-16 animate-pulse rounded-xl bg-[#eeede6]" />)}</section>;
  if (recordQuery.isError) return <section className="flex min-h-[300px] flex-col items-center justify-center rounded-[16px] border border-[#e3c3b6] bg-[#fff6f0] p-6 text-center" role="alert" data-testid="status-record-error"><CircleAlert size={22} className="text-[#b85b46]" /><h2 className="mt-3 text-[14px] font-extrabold text-[#784b3e]">Record unavailable</h2><p className="mt-2 text-[10px] text-[#8c6b5e]">{errorText(recordQuery.error)}</p><button type="button" onClick={() => void recordQuery.refetch()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-3 py-2 text-[10px] font-extrabold text-[#855542]" data-testid="button-retry-record"><RefreshCw size={12} /> Retry</button></section>;
  if (!record) return <section className="rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] p-8 text-center text-[10px] text-[#858982]" data-testid="status-record-empty">No stored payload was returned for this fixture.</section>;
  const displayRecord = record as ArchiveRecord;
  return <section className="animate-rise space-y-3" data-testid="panel-stored-record">
    <article className="overflow-hidden rounded-[16px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_10px_34px_rgba(47,59,64,.045)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4"><div className="min-w-0"><p className="mono text-[9px] uppercase tracking-[.14em] text-[#9b7160]">{displayRecord.competition} · {dateLabel(displayRecord.date)}</p><h2 className="mt-1 truncate text-[17px] font-extrabold tracking-[-.04em] text-[#344550]">{displayRecord.homeTeamName} <span className="font-medium text-[#9a9a90]">vs</span> {displayRecord.awayTeamName}</h2><p className="mono mt-1 text-[8px] text-[#92958c]">FIXTURE {displayRecord.fixtureId} · {displayRecord.season ?? 'Season unavailable'}</p></div><div className="text-right"><p className="mono text-[17px] font-extrabold tracking-[-.04em] text-[#2f4a42]">{kind === 'database' ? score(record as FootballProcessedMatchSummary) : 'PRE-MATCH'}</p><span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[8px] font-extrabold uppercase tracking-[.1em] ${displayRecord.completeness === 'complete' ? 'bg-[#e5eee7] text-[#4e755c]' : 'bg-[#fbf1df] text-[#986b32]'}`}>{displayRecord.completeness}</span></div></div>
      <div className="grid grid-cols-2 gap-px bg-[#e8e6de] sm:grid-cols-4">
        {(kind === 'database'
          ? [['Outcome', (record as FootballProcessedMatchSummary).actualOutcome ?? 'Unavailable'], ['Total goals', (record as FootballProcessedMatchSummary).totalGoals ?? '—'], ['League avg. at import', displayRecord.leagueAverageGoals === null ? '—' : displayRecord.leagueAverageGoals.toFixed(2)], ['Issues', displayRecord.issueCount]]
          : [['League avg. at import', displayRecord.leagueAverageGoals === null ? '—' : displayRecord.leagueAverageGoals.toFixed(2)], ['Standings source', displayRecord.averageSource === 'unavailable' ? 'Unavailable' : 'Latest available'], ['Coverage', displayRecord.completeness], ['Issues', displayRecord.issueCount]]
        ).map(([label, value])=><div key={label} className="bg-[#fbfaf6] px-3 py-3"><p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#92958c]">{label}</p><p className="mono mt-1 text-[11px] font-medium text-[#4b6256]">{value}</p></div>)}
      </div>
      <p className="border-t border-[#e8e6de] bg-[#fbfaf6] px-4 py-2.5 text-[9px] leading-4 text-[#858982]">{kind === 'tester' ? 'The target match score and outcome are not stored. Recent form and H2H use only matches before kickoff; league standings are the latest available, not a historical match-day snapshot.' : 'League goal average uses the season standings available at import time; it is not a historical match-day snapshot.'}</p>
      {record.completeness === 'partial' && <p role="status" className="border-t border-[#ead9c4] bg-[#fbf3e9] px-4 py-2.5 text-[9px] text-[#84684f]">Partial analysis record · {record.issueCount} issue{record.issueCount === 1 ? '' : 's'} recorded. The stored payload may contain unavailable sections.</p>}
    </article>
      <p className="px-1 text-[9px] leading-4 text-[#858982]">Large stored payloads load on demand. Open a section to fetch its compressed archive data.</p>
      <DataBlock fixtureId={displayRecord.fixtureId} section="details" kind={kind} title={kind === 'tester' ? 'Pre-match metadata and standings' : 'Match details payload'} />
      <DataBlock fixtureId={displayRecord.fixtureId} section="lastFive" kind={kind} title={kind === 'tester' ? 'Last-five and H2H pre-match payload' : 'Last five payload'} />
      <DataBlock fixtureId={displayRecord.fixtureId} section="tmp" kind={kind} title="TMP context payload" />
  </section>;
}

function ArchivePage({ kind }: { kind: ArchiveKind }) {
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const [routeSearch, setRouteSearch] = useState(() => new URLSearchParams(window.location.search));
  const [searchText, setSearchText] = useState('');
  const [offset, setOffset] = useState(0);
  const [date, setDate] = useState(() => new URLSearchParams(window.location.search).get('date') ?? '');
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState('');
  const detailRef = useRef<HTMLDivElement>(null);
  const deleteArchive = useDeleteAllFootballProcessedMatches();
  const deleteTester = useDeleteAllFootballTesterMatches();
  const limit = 50;
  const params = useMemo(() => ({ limit, offset, ...(date ? { date } : {}) }), [date, offset]);
  const archiveQuery = useGetFootballProcessedMatches(params, {
    query: { enabled: kind === 'database', queryKey: getGetFootballProcessedMatchesQueryKey(params) },
  });
  const testerQuery = useGetFootballTesterMatches(params, {
    query: { enabled: kind === 'tester', queryKey: getGetFootballTesterMatchesQueryKey(params) },
  });
  const listQuery = kind === 'database' ? archiveQuery : testerQuery;
  const data = listQuery.data;
  const normalized = searchText.trim().toLocaleLowerCase();
  const rows = (data?.matches ?? []).filter((match) => `${match.homeTeamName} ${match.awayTeamName} ${match.competition} ${match.fixtureId}`.toLocaleLowerCase().includes(normalized));
  const selectedFromUrl = Number(routeSearch.get('fixture'));
  const selectedId = Number.isSafeInteger(selectedFromUrl) && selectedFromUrl > 0 ? selectedFromUrl : null;
  const totalSaved = data?.total ?? 0;
  const deletePending = deleteArchive.isPending || deleteTester.isPending;

  useEffect(() => {
    const syncRouteSearch = () => {
      const next = new URLSearchParams(window.location.search);
      setRouteSearch(next);
      setDate(next.get('date') ?? '');
      setOffset(0);
    };
    window.addEventListener('popstate', syncRouteSearch);
    return () => window.removeEventListener('popstate', syncRouteSearch);
  }, []);

  useEffect(() => {
    if (!selectedId || window.matchMedia('(min-width: 1280px)').matches) return;
    const frame = window.requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId]);

  const selectRecord = (id: number | null) => {
    const query = new URLSearchParams();
    if (date) query.set('date', date);
    if (id) query.set('fixture', String(id));
    setRouteSearch(query);
    setLocation(`/${kind}${query.size ? `?${query.toString()}` : ''}`);
  };
  const changeDate = (value: string) => {
    setDate(value);
    setOffset(0);
    const query = new URLSearchParams();
    if (value) query.set('date', value);
    if (selectedId) query.set('fixture', String(selectedId));
    setRouteSearch(query);
    setLocation(`/${kind}${query.size ? `?${query.toString()}` : ''}`);
  };
  const clearArchive = () => {
    const onSuccess = () => {
      setConfirmClear(false);
      setClearError('');
      setSearchText('');
      setOffset(0);
      selectRecord(null);
      if (kind === 'database') {
        void client.invalidateQueries({ queryKey: getGetFootballProcessedMatchesQueryKey() });
      } else {
        void client.invalidateQueries({ queryKey: getGetFootballTesterMatchesQueryKey() });
      }
    };
    const onError = (error: unknown) => setClearError(errorText(error));
    if (kind === 'database') deleteArchive.mutate(undefined, { onSuccess, onError });
    else deleteTester.mutate(undefined, { onSuccess, onError });
  };

  return <main className="screen-noise min-h-[100dvh] bg-[#f2f0e8] text-[#243443]">
    <Header kind={kind} />
    <div className="mx-auto max-w-[1420px] px-4 pb-12 pt-7 sm:px-7 sm:pt-10">
      <div className="animate-rise mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div><p className="mono mb-2 text-[10px] uppercase tracking-[.19em] text-[#9b7160]">Research archive / 02</p><h1 className="text-[32px] font-extrabold leading-[1.04] tracking-[-.06em] text-[#263746] sm:text-[46px]">A record you can <span className="text-[#d96f51]">inspect.</span></h1><p className="mt-3 max-w-[560px] text-[12px] leading-6 text-[#727973]">Search saved match summaries by date, then inspect the exact analysis payloads stored for each fixture.</p></div>
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          <button type="button" onClick={() => { setClearError(''); setConfirmClear(true); }} disabled={totalSaved === 0 || listQuery.isLoading || deletePending} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#e5c7ba] bg-[#fff8f3] px-3.5 text-[10px] font-extrabold text-[#a45340] hover:bg-white disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-clear-archive"><Trash2 size={13} /> Delete all matches</button>
          <Link href={date ? `/processing?date=${date}` : '/processing'} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d9d8cf] bg-[#f9f8f3] px-3.5 text-[10px] font-extrabold text-[#60716a] hover:bg-white" data-testid="link-start-processing"><RefreshCw size={13} /> Start an import</Link>
        </div>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(430px,.88fr)]">
        <section className={`overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_16px_50px_rgba(47,59,64,.055)] ${selectedId ? 'order-2 xl:order-1' : 'order-1'}`} aria-labelledby="archive-heading" data-testid="section-archive-list">
          <div className="border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><Archive size={16} /></span><div><h2 id="archive-heading" className="text-[14px] font-extrabold text-[#344550]">Saved match summaries</h2><p className="mt-0.5 text-[10px] text-[#858982]" aria-live="polite" data-testid="text-archive-count">{data ? `${data.total} records · ${data.date ?? 'all dates'}` : 'Local analysis archive'}</p></div></div></div>
          <div className="grid gap-2 border-b border-[#e8e6de] p-3 sm:grid-cols-[minmax(150px,.75fr)_minmax(0,1.25fr)]">
            <label className="relative"><span className="sr-only">Filter archive by date</span><CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9a7867]" /><input type="date" value={date} onChange={(e)=>changeDate(e.target.value)} className="h-10 w-full rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] pl-9 pr-2 text-[10px] font-bold text-[#47595b]" aria-label="Filter saved matches by date" data-testid="input-database-date" /></label>
            <label className="relative"><span className="sr-only">Search teams, competitions or fixture ID</span><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b928a]" /><input value={searchText} onChange={(e)=>setSearchText(e.target.value)} placeholder="Search teams, competitions, fixture ID" className="h-10 w-full rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] pl-9 pr-9 text-[10px] text-[#47595b] placeholder:text-[#9a9b93]" data-testid="input-database-search" />{searchText && <button type="button" onClick={()=>setSearchText('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-[#78817b] hover:bg-[#efeee8]" data-testid="button-clear-search"><X size={13} /></button>}</label>
          </div>
          {listQuery.isLoading ? <div className="space-y-2 p-3" role="status" aria-label="Loading archive" data-testid="status-archive-loading">{[0,1,2,3,4,5].map(i=><div key={i} className="h-[66px] animate-pulse rounded-lg bg-[#eeede6]" />)}</div>
          : listQuery.isError ? <div className="m-4 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-5" role="alert" data-testid="status-archive-error"><div className="flex gap-2 text-[11px] font-bold text-[#784b3e]"><CircleAlert size={15} /> Archive unavailable</div><p className="mt-2 text-[10px] text-[#8c6b5e]">{errorText(listQuery.error)}</p><button onClick={()=>void listQuery.refetch()} className="mt-3 inline-flex items-center gap-2 text-[10px] font-extrabold text-[#855542]" data-testid="button-retry-archive"><RefreshCw size={12} /> Retry</button></div>
          : rows.length ? <><div className="divide-y divide-[#e8e6de]" data-testid="list-processed-matches">{rows.map((match)=> <button key={match.fixtureId} type="button" onClick={()=>selectRecord(match.fixtureId)} className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-[#fbfaf6] ${selectedId === match.fixtureId ? 'bg-[#edf2ec]' : ''}`} data-testid={`row-processed-match-${match.fixtureId}`} aria-pressed={selectedId === match.fixtureId}>
            <span className="min-w-0"><span className="flex flex-wrap items-center gap-1.5"><span className="truncate text-[10px] font-extrabold text-[#455951]">{match.homeTeamName} <span className="font-medium text-[#9a9a90]">vs</span> {match.awayTeamName}</span><span className={`rounded-full px-1.5 py-0.5 text-[7px] font-extrabold uppercase ${match.completeness === 'complete' ? 'bg-[#e5eee7] text-[#4e755c]' : 'bg-[#fbf1df] text-[#986b32]'}`}>{match.completeness}</span></span><span className="mt-1 block truncate text-[8px] text-[#92958c]">{dateLabel(match.date)} · {match.competition} · #{match.fixtureId}</span><span className="mt-1 block text-[8px] text-[#899087]">{match.issueCount} issues · league avg {match.leagueAverageGoals === null ? 'unavailable' : match.leagueAverageGoals.toFixed(2)}</span></span>
            <span className="flex items-center gap-2"><span className="mono text-[13px] font-medium text-[#344c43]">{kind === 'database' ? score(match as FootballProcessedMatchSummary) : 'PRE-MATCH'}</span><ChevronRight size={14} className="text-[#9a9c92]" /></span>
          </button>)}</div>
          <div className="flex items-center justify-between gap-3 border-t border-[#e8e6de] bg-[#f5f4ed] px-4 py-3"><span className="text-[9px] text-[#858982]">Showing {offset + 1}–{Math.min(offset + limit, data?.total ?? 0)} of {data?.total ?? 0}{normalized ? ' on this page' : ''}</span><div className="flex gap-1"><button type="button" onClick={()=>setOffset((value)=>Math.max(0,value-limit))} disabled={offset===0} className="rounded-md border border-[#d8d7ce] bg-[#fbfaf6] px-2.5 py-1.5 text-[9px] font-bold disabled:opacity-40" data-testid="button-previous-page">Previous</button><button type="button" onClick={()=>setOffset((value)=>value+limit)} disabled={offset+limit >= (data?.total ?? 0)} className="rounded-md border border-[#d8d7ce] bg-[#fbfaf6] px-2.5 py-1.5 text-[9px] font-bold disabled:opacity-40" data-testid="button-next-page">Next</button></div></div></>
          : <div className="flex min-h-[290px] flex-col items-center justify-center px-6 py-12 text-center" data-testid="status-archive-empty"><span className="grid size-12 place-items-center rounded-2xl border border-[#dfe4dc] bg-[#edf2ec] text-[#718879]"><Database size={20} /></span><h3 className="mt-4 text-[15px] font-extrabold text-[#354750]">{normalized ? 'No matching records' : date ? 'No saved matches for this date' : 'Archive is empty'}</h3><p className="mt-2 max-w-[320px] text-[10px] leading-5 text-[#858982]">{normalized ? 'Try a different team, competition or fixture ID.' : 'Completed match days imported through Processing will appear here. No records are fabricated or inferred.'}</p>{normalized && <button type="button" onClick={()=>setSearchText('')} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#253746] px-3 py-2 text-[9px] font-extrabold text-[#f8f2e7]" data-testid="button-reset-search"><X size={12} /> Clear search</button>}</div>}
        </section>
        <div ref={detailRef} className={`min-w-0 scroll-mt-4 ${selectedId ? 'order-1 xl:order-2' : 'order-2'}`}><DetailPanel fixtureId={selectedId} kind={kind} /></div>
      </div>
      {confirmClear && <div className="fixed inset-0 z-50 grid place-items-center bg-[#17232c]/45 p-4" role="presentation">
        <section className="w-full max-w-md rounded-2xl border border-[#deddd4] bg-[#fbfaf6] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="clear-archive-title" aria-describedby="clear-archive-description" data-testid="dialog-clear-archive">
          <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#fbede6] text-[#a45340]"><Trash2 size={17} /></span><div><h2 id="clear-archive-title" className="text-[15px] font-extrabold text-[#344550]">Delete all archived matches?</h2><p id="clear-archive-description" className="mt-2 text-[11px] leading-5 text-[#727973]">This permanently deletes {totalSaved} saved match records. Processing job history stays. If any import is running, the archive will not be cleared until it finishes. This cannot be undone.</p></div></div>
          {clearError && <p className="mt-4 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-3 py-2 text-[10px] text-[#8c5144]" role="alert" data-testid="error-clear-archive">{clearError}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmClear(false)} disabled={deletePending} className="h-10 rounded-lg border border-[#d8d7ce] bg-white px-4 text-[10px] font-extrabold text-[#64716d] disabled:opacity-50" data-testid="button-cancel-clear">Cancel</button>
            <button type="button" onClick={clearArchive} disabled={deletePending} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#aa513e] px-4 text-[10px] font-extrabold text-white hover:bg-[#923f2f] disabled:opacity-50" data-testid="button-confirm-clear">{deletePending && <RefreshCw size={13} className="animate-spin" />}{deletePending ? 'Deleting…' : 'Delete all matches'}</button>
          </div>
        </section>
      </div>}
      <footer className="mt-5 flex flex-wrap items-center gap-2 px-1 text-[9px] text-[#8b8d84]"><Check size={12} /> Stored payloads are displayed as received; unavailable fields remain unavailable. <span className="text-[#9b7160]">Published deployments reset local files on restart or republication, so this SQLite archive is not production-durable.</span></footer>
    </div>
  </main>;
}

export default function DatabasePage() {
  return <ArchivePage kind="database" />;
}

export function TesterPage() {
  return <ArchivePage kind="tester" />;
}
