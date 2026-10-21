import { useState } from 'react';
import { Link, useParams } from 'wouter';
import {
  getGetFootballMatchLastFiveQueryKey,
  useGetFootballMatchDetails,
  useGetFootballMatchLastFive,
  useGetFootballMatchTmp,
} from '@workspace/api-client-react';
import type { FootballMatchDetails, FootballMatchLastFive, FootballMatchTmpContext, FootballRecentMatch } from '@workspace/api-client-react';
import { MatchTmpPanel } from '@/components/match-tmp-panel';
import { MatchInsightsPanel } from '@/components/match-insights-panel';
import { MatchupAnalysisPanel } from '@/components/matchup-analysis-panel';
import { PerformanceGraphsPanel } from '@/components/performance-graphs-panel';
import { LastFivePanel } from '@/components/last-five-panel';
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CircleAlert,
  Clock3,
  RefreshCw,
  Scale,
  Shield,
  Trophy,
} from 'lucide-react';

type MatchTab = 'table' | 'odds' | 'form' | 'h2h' | 'tmp' | 'insights' | 'graphs' | 'lastfive';
const tabs: { id: MatchTab; label: string; short: string }[] = [
  { id: 'table', label: 'Table', short: '01' },
  { id: 'odds', label: 'Odds', short: '02' },
  { id: 'form', label: 'Team form', short: '03' },
  { id: 'lastfive', label: 'Last five', short: '04' },
  { id: 'h2h', label: 'Head to head', short: '05' },
  { id: 'tmp', label: 'TMP', short: '06' },
  { id: 'insights', label: 'Matchup analysis', short: '07' },
  { id: 'graphs', label: 'Graph Representations', short: '08' },
];

function readableError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') return error.error;
  return 'The match context could not be loaded. Please try again.';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function fixturesReturnHref() {
  const current = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const date = current.get('date');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) params.set('date', date);
  const competition = current.get('competition')?.trim();
  if (competition) params.set('competition', competition);
  const search = current.get('search')?.trim();
  if (search) params.set('search', search);
  return `/fixtures${params.size ? `?${params.toString()}` : ''}`;
}

function TeamCrest({ name, logo, large = false }: { name: string; logo: string | null; large?: boolean }) {
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-[14px] border border-[#e0dfd6] bg-[#f7f6ef] font-extrabold text-[#65766d] ${large ? 'size-[62px] text-[15px] sm:size-[74px]' : 'size-9 text-[10px]'}`}>
      {logo ? <img src={logo} alt="" loading="lazy" className="size-full object-contain p-1.5" /> : name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function SectionIssue({ details, section }: { details: FootballMatchDetails; section: string }) {
  const issue = details.issues.find((item) => item.section === section);
  if (!issue) return null;
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3.5 py-3 text-[11px] leading-5 text-[#84684f]" role="status" data-testid={`issue-${section}`}>
      <CircleAlert size={14} className="mt-0.5 shrink-0 text-[#bb8755]" />
      <span>{issue.message}</span>
    </div>
  );
}

function EmptySection({ title, detail, testId }: { title: string; detail: string; testId: string }) {
  return (
    <div className="flex min-h-[190px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-6 py-10 text-center" data-testid={testId}>
      <span className="grid size-10 place-items-center rounded-xl bg-[#e9eee8] text-[#708679]"><BarChart3 size={17} /></span>
      <h3 className="mt-3 text-[13px] font-extrabold text-[#3c5058]">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[10px] leading-5 text-[#858982]">{detail}</p>
    </div>
  );
}

function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="mono text-[9px] uppercase tracking-[.17em] text-[#9b7160]">{eyebrow}</p>
        <h2 className="mt-1 text-[20px] font-extrabold tracking-[-.05em] text-[#2b3e49]">{title}</h2>
      </div>
      <p className="max-w-sm text-[10px] leading-5 text-[#858982]">{detail}</p>
    </div>
  );
}

function StandingsPanel({ details }: { details: FootballMatchDetails }) {
  const { match, standings } = details;
  return (
    <section data-testid="panel-table">
      <SectionIssue details={details} section="standings" />
      <SectionHeading eyebrow="League context" title="Competition table" detail="Position and season totals from the match source." />
      {standings.length ? (
        <div className="overflow-x-auto rounded-xl border border-[#deddd4] bg-[#fbfaf6]">
          <table className="w-full min-w-[680px] border-collapse text-left text-[10px]" data-testid="table-standings">
            <thead className="bg-[#f0efe8] text-[9px] font-extrabold uppercase tracking-[.1em] text-[#7b847c]">
              <tr><th className="px-3 py-3 text-center">Pos</th><th className="px-3 py-3">Club</th><th className="px-3 py-3 text-center">P</th><th className="px-3 py-3 text-center">Pts</th><th className="px-3 py-3 text-center">GD</th><th className="px-3 py-3 text-center">Home</th><th className="px-3 py-3 text-center">Away</th><th className="px-3 py-3">Form</th></tr>
            </thead>
            <tbody>
              {standings.map((row) => {
                const featured = row.teamId === match.home.id || row.teamId === match.away.id;
                return (
                  <tr key={row.teamId} className={`border-t border-[#e9e7df] ${featured ? 'bg-[#edf2ec]' : ''}`} data-testid={`row-standing-${row.teamId}`}>
                    <td className="mono px-3 py-3 text-center text-[#81877f]">{row.rank}</td>
                    <td className="px-3 py-3"><div className="flex items-center gap-2.5">{row.teamLogo ? <img src={row.teamLogo} alt="" className="size-6 object-contain" loading="lazy" /> : <span className="grid size-6 place-items-center rounded-md bg-[#efeee7] text-[8px] font-extrabold text-[#75817b]">{row.teamName.slice(0, 2).toUpperCase()}</span>}<span className={`font-bold ${featured ? 'text-[#344c40]' : 'text-[#4e5d5e]'}`}>{row.teamName}{row.teamId === match.home.id ? <span className="ml-1.5 text-[8px] font-bold uppercase text-[#869587]">Home</span> : row.teamId === match.away.id ? <span className="ml-1.5 text-[8px] font-bold uppercase text-[#869587]">Away</span> : null}</span></div></td>
                    <td className="mono px-3 py-3 text-center text-[#68736f]">{row.played}</td>
                    <td className="mono px-3 py-3 text-center font-bold text-[#344c40]">{row.points}</td>
                    <td className="mono px-3 py-3 text-center text-[#68736f]">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                    <td className="mono px-3 py-3 text-center text-[#68736f]">{row.homePoints} pts · {row.homeGoalDifference > 0 ? '+' : ''}{row.homeGoalDifference}</td>
                    <td className="mono px-3 py-3 text-center text-[#68736f]">{row.awayPoints} pts · {row.awayGoalDifference > 0 ? '+' : ''}{row.awayGoalDifference}</td>
                    <td className="px-3 py-3"><div className="flex gap-1">{[...row.form].slice(-5).map((result, index) => <span key={`${row.teamId}-${index}`} className={`grid size-[17px] place-items-center rounded-[5px] text-[8px] font-extrabold ${result.toUpperCase() === 'W' ? 'bg-[#dce9df] text-[#54745e]' : result.toUpperCase() === 'D' ? 'bg-[#efeee5] text-[#86816d]' : 'bg-[#f4e3dc] text-[#ad6955]'}`} title={result}>{result}</span>)}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptySection title="Table unavailable" detail="No standings were returned for this competition." testId="empty-standings" />}
    </section>
  );
}

function OddsPanel({ details }: { details: FootballMatchDetails }) {
  return (
    <section data-testid="panel-odds">
      <SectionIssue details={details} section="odds" />
      <SectionHeading eyebrow="Market board" title="Available odds" detail="Selections and bookmaker coverage as provided by the source." />
      {details.oddsMarkets.length ? (
        <div className="space-y-3">
          {details.oddsMarkets.map((market) => (
            <article key={market.marketId} className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" data-testid={`market-${market.marketId}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3">
                <h3 className="text-[11px] font-extrabold text-[#43575a]">{market.name}</h3>
                <span className="mono rounded-full bg-[#e7ede7] px-2 py-1 text-[8px] uppercase tracking-[.1em] text-[#668071]">{market.category}</span>
              </div>
              {market.selections.length ? (
                <div className="grid gap-px bg-[#e8e6de] sm:grid-cols-2 lg:grid-cols-3">
                  {market.selections.map((selection, index) => (
                    <div key={`${selection.selection}-${index}`} className="flex min-w-0 items-center justify-between gap-3 bg-[#fbfaf6] px-4 py-3.5" data-testid={`selection-${market.marketId}-${index}`}>
                      <div className="min-w-0"><p className="truncate text-[10px] font-bold text-[#52615e]">{selection.selection}</p><p className="mt-1 truncate text-[9px] text-[#96978f]">{selection.bookmaker} · {selection.bookmakerCount} {selection.bookmakerCount === 1 ? 'bookmaker' : 'bookmakers'}</p></div>
                      <span className="mono rounded-lg border border-[#d8e2d8] bg-[#edf2ec] px-2.5 py-1.5 text-[13px] font-medium text-[#456b58]">{selection.odd}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="px-4 py-4 text-[10px] text-[#858982]">No selections were returned for this market.</p>}
            </article>
          ))}
        </div>
      ) : <EmptySection title="No odds markets available" detail="The source did not return odds for this fixture." testId="empty-odds" />}
    </section>
  );
}

function RecentMatchRow({ game, teamId, index }: { game: FootballRecentMatch; teamId: number; index: number }) {
  const isHome = game.homeTeam.id === teamId;
  const scored = isHome ? game.homeScore : game.awayScore;
  const conceded = isHome ? game.awayScore : game.homeScore;
  const outcome = scored === null || conceded === null ? '—' : scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
  const tone = outcome === 'W' ? 'bg-[#dce9df] text-[#54745e]' : outcome === 'L' ? 'bg-[#f4e3dc] text-[#ad6955]' : outcome === 'D' ? 'bg-[#efeee5] text-[#86816d]' : 'bg-[#eeede6] text-[#7f867e]';
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)_auto_30px] items-center gap-2.5 border-b border-[#e9e7df] px-3.5 py-3 last:border-0 sm:grid-cols-[35px_minmax(0,1fr)_auto_34px] sm:px-4" data-testid={`recent-match-${game.fixtureId}-${index}`}>
      <span className={`grid size-6 place-items-center rounded-md text-[9px] font-extrabold ${tone}`}>{outcome}</span>
      <div className="min-w-0"><p className="truncate text-[10px] font-bold text-[#4f5e5d]">{game.homeTeam.name} <span className="font-medium text-[#9a9a90]">vs</span> {game.awayTeam.name}</p><p className="mt-1 truncate text-[8px] text-[#97988f]">{game.competition} · {formatDate(game.date)}</p></div>
      <span className="mono text-[11px] font-medium text-[#47595b]">{game.homeScore ?? '–'} : {game.awayScore ?? '–'}</span>
      <span className="text-right text-[8px] font-bold uppercase text-[#96978f]">{isHome ? 'H' : 'A'}</span>
    </div>
  );
}

function FormList({ title, teamId, games }: { title: string; teamId: number; games: FootballRecentMatch[] }) {
  const rows = games.slice(0, 15);
  return (
    <section className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" data-testid={`form-${teamId}`}>
      <div className="flex items-center justify-between gap-3 border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3">
        <h3 className="truncate text-[11px] font-extrabold text-[#43575a]">{title}</h3>
        <span className="mono shrink-0 text-[9px] text-[#888d84]">{rows.length} / 15</span>
      </div>
      {rows.length ? rows.map((game, index) => <RecentMatchRow key={`${game.fixtureId}-${index}`} game={game} teamId={teamId} index={index} />) : <p className="px-4 py-8 text-center text-[10px] text-[#858982]">No recent results were returned.</p>}
    </section>
  );
}

function FormPanel({ details }: { details: FootballMatchDetails }) {
  return (
    <section data-testid="panel-form">
      <SectionIssue details={details} section="homeRecent" />
      <SectionIssue details={details} section="awayRecent" />
      <SectionHeading eyebrow="Recent results" title="Team form" detail="The latest 15 results for each side, with the outcome shown from that team’s perspective." />
      <div className="grid gap-4 lg:grid-cols-2">
        <FormList title={details.match.home.name} teamId={details.match.home.id} games={details.homeRecent} />
        <FormList title={details.match.away.name} teamId={details.match.away.id} games={details.awayRecent} />
      </div>
    </section>
  );
}

function HeadToHeadPanel({ details }: { details: FootballMatchDetails }) {
  return (
    <section data-testid="panel-h2h">
      <SectionIssue details={details} section="headToHead" />
      <SectionHeading eyebrow="Shared history" title="Head to head" detail={`Previous meetings between ${details.match.home.name} and ${details.match.away.name}.`} />
      {details.headToHead.length ? (
        <div className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3 text-[9px] font-extrabold uppercase tracking-[.1em] text-[#81877f]"><span>Fixture</span><span>Score</span></div>
          {details.headToHead.map((game, index) => (
            <div key={`${game.fixtureId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#e9e7df] px-4 py-3.5 last:border-0" data-testid={`h2h-match-${game.fixtureId}-${index}`}>
              <div className="min-w-0"><p className="truncate text-[10px] font-bold text-[#4f5e5d]">{game.homeTeam.name} <span className="font-medium text-[#9a9a90]">vs</span> {game.awayTeam.name}</p><p className="mt-1 truncate text-[9px] text-[#97988f]">{game.competition} · {formatDate(game.date)}</p></div>
              <span className="mono rounded-md bg-[#f0efe8] px-2.5 py-1.5 text-[11px] text-[#47595b]">{game.homeScore ?? '–'} : {game.awayScore ?? '–'}</span>
            </div>
          ))}
        </div>
      ) : <EmptySection title="No previous meetings listed" detail="The source returned no head-to-head results for these teams." testId="empty-h2h" />}
    </section>
  );
}

export default function MatchDetailsPage() {
  const params = useParams<{ fixtureId: string }>();
  const fixtureId = Number(params.fixtureId);
  const validId = Number.isSafeInteger(fixtureId) && fixtureId > 0;
  const fixturesHref = fixturesReturnHref();
  const detailsQuery = useGetFootballMatchDetails(validId ? fixtureId : 0, {
    query: { enabled: validId, queryKey: ['/api/football/matches', fixtureId, 'details'] },
  });
  const [activeTab, setActiveTab] = useState<MatchTab>('table');
  const tmpQuery = useGetFootballMatchTmp(validId ? fixtureId : 0, {
    query: { enabled: validId && (activeTab === 'tmp' || activeTab === 'insights' || activeTab === 'graphs'), queryKey: ['/api/football/matches', fixtureId, 'tmp'] },
  });
  const lastFiveQuery = useGetFootballMatchLastFive(validId ? fixtureId : 0, {
    query: { enabled: validId && (activeTab === 'lastfive' || activeTab === 'insights' || activeTab === 'graphs'), queryKey: getGetFootballMatchLastFiveQueryKey(fixtureId) },
  });
  const details = detailsQuery.data as FootballMatchDetails | undefined;
  const match = details?.match;
  const isLive = match?.status.toLowerCase().includes('live') || match?.status.toLowerCase().includes('in play');
  const isComplete = match?.status.toLowerCase().includes('finished') || match?.status.toLowerCase().includes('full time') || match?.status.toLowerCase() === 'ft';

  return (
    <main className="screen-noise min-h-[100dvh] bg-[#f2f0e8] text-[#243443]">
      <header className="relative z-10 border-b border-[#d9d8cf] bg-[#f7f5ef]">
        <div className="mx-auto flex min-h-[72px] max-w-[1260px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-7 lg:px-10">
          <div className="flex items-center gap-3.5">
            <div className="grid size-10 place-items-center rounded-[13px] bg-[#253746] text-[#f8f2e7]"><Trophy size={19} strokeWidth={1.8} /></div>
            <div><div className="flex items-center gap-2.5"><span className="text-[15px] font-extrabold tracking-[-.04em]">Browser Control</span><span className="rounded-full border border-[#deddd3] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.16em] text-[#7e827d]">Match centre</span></div><p className="mt-0.5 hidden text-[11px] text-[#858780] sm:block">Context behind the fixture.</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/processing" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9d8cf] bg-[#f1f0e9] px-3 text-[10px] font-extrabold text-[#60716a] transition hover:bg-white" data-testid="link-processing">Processing</Link>
            <Link href="/database" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9d8cf] bg-[#f1f0e9] px-3 text-[10px] font-extrabold text-[#60716a] transition hover:bg-white" data-testid="link-database">Database</Link>
            <Link href="/model-training" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9d8cf] bg-[#f1f0e9] px-3 text-[10px] font-extrabold text-[#60716a] transition hover:bg-white" data-testid="link-model-training">Model training</Link>
            <Link href={fixturesHref} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9d8cf] bg-[#f1f0e9] px-3 text-[10px] font-extrabold text-[#60716a] transition hover:bg-white" data-testid="link-back-fixtures"><ArrowLeft size={14} /> All fixtures</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1260px] px-4 pb-12 pt-6 sm:px-7 sm:pt-9 lg:px-10">
        <div className="mb-5 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.13em] text-[#93958b]"><Link href={fixturesHref} className="hover:text-[#d06c4f]" data-testid="link-breadcrumb-fixtures">Fixtures</Link><span>/</span><span className="text-[#9b7160]">Match detail</span></div>

        {detailsQuery.isLoading ? (
          <section className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]" role="status" aria-label="Loading match details" data-testid="status-match-loading">
            <div className="h-2 bg-[#e5e8df]"><div className="h-full w-1/3 animate-pulse bg-[#d9a080]" /></div>
            <div className="p-6 sm:p-9"><div className="mb-7 h-3 w-36 animate-pulse rounded-full bg-[#e6e4dc]" /><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 sm:gap-10"><div className="flex items-center gap-3"><div className="size-14 animate-pulse rounded-2xl bg-[#e8e7df]" /><div className="h-4 w-28 animate-pulse rounded bg-[#e8e7df]" /></div><div className="h-10 w-24 animate-pulse rounded-lg bg-[#e8e7df]" /><div className="flex items-center justify-end gap-3"><div className="h-4 w-28 animate-pulse rounded bg-[#e8e7df]" /><div className="size-14 animate-pulse rounded-2xl bg-[#e8e7df]" /></div></div></div>
            <div className="border-t border-[#e1dfd7] p-5"><div className="mb-5 h-10 animate-pulse rounded-lg bg-[#eeede6]" /><div className="h-56 animate-pulse rounded-xl bg-[#eeede6]" /></div>
          </section>
        ) : detailsQuery.isError || !validId ? (
          <section className="flex min-h-[330px] flex-col items-center justify-center rounded-[17px] border border-[#e3c3b6] bg-[#fff6f0] px-6 py-12 text-center" role="alert" data-testid="status-match-error">
            <span className="grid size-12 place-items-center rounded-2xl bg-[#f6e2d8] text-[#b85b46]"><CircleAlert size={20} /></span>
            <h1 className="mt-4 text-[19px] font-extrabold tracking-[-.04em] text-[#784b3e]">{validId ? 'Match details unavailable' : 'Invalid fixture reference'}</h1>
            <p className="mt-2 max-w-md text-[11px] leading-5 text-[#8c6b5e]">{validId ? readableError(detailsQuery.error) : 'This fixture link does not contain a valid match identifier.'}</p>
            {validId && <button type="button" onClick={() => detailsQuery.refetch()} className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-3 text-[10px] font-extrabold text-[#855542] hover:bg-white" data-testid="button-retry-match"><RefreshCw size={13} /> Try again</button>}
            <Link href={fixturesHref} className="mt-4 inline-flex items-center gap-2 text-[10px] font-extrabold text-[#668074] hover:text-[#d06c4f]" data-testid="link-error-back"><ArrowLeft size={13} /> Return to fixtures</Link>
          </section>
        ) : match ? (
          <div className="animate-rise">
            <section className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_20px_60px_rgba(47,59,64,.065)]" data-testid="section-match-overview">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-3.5 sm:px-6">
                <div className="flex min-w-0 items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-[#e6eee8] text-[#537867]"><Trophy size={13} /></span><div className="min-w-0"><p className="truncate text-[10px] font-extrabold text-[#485a5c]" data-testid="text-match-competition">{match.competition}</p><p className="mono mt-0.5 text-[8px] text-[#97988f]">FIXTURE {match.fixtureId}{match.season ? ` · ${match.season} SEASON` : ''}</p></div></div>
                <span className={`rounded-full px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.12em] ${isLive ? 'bg-[#f8e7de] text-[#b65c42]' : isComplete ? 'bg-[#e9eee8] text-[#64806d]' : 'bg-[#efeee8] text-[#7d837b]'}`} data-testid="status-match-detail">{match.status}</span>
              </div>
              <div className="grid items-center gap-5 px-5 py-7 sm:grid-cols-[1fr_auto_1fr] sm:gap-8 sm:px-8 sm:py-9">
                <div className="flex min-w-0 items-center gap-3 sm:gap-4"><TeamCrest name={match.home.name} logo={match.home.logo} large /><div className="min-w-0"><p className="text-[8px] font-extrabold uppercase tracking-[.15em] text-[#92958c]">Home</p><h1 className="mt-1 truncate text-[17px] font-extrabold leading-tight tracking-[-.045em] text-[#2e424b] sm:text-[22px]" data-testid="text-match-home">{match.home.name}</h1></div></div>
                <div className="flex items-center justify-center gap-3 text-center sm:flex-col sm:gap-1"><div className="mono flex items-center gap-2 text-[23px] font-medium tracking-[-.07em] text-[#2b3e49]" data-testid="text-match-score">{match.home.score !== null && match.away.score !== null ? <>{match.home.score}<span className="text-[#a2a69c]">:</span>{match.away.score}</> : <span className="text-[15px] text-[#9b9d95]">VS</span>}</div>{match.home.halfTimeScore !== null && match.away.halfTimeScore !== null && <span className="mono text-[8px] text-[#92958c]" data-testid="text-halftime-score">HT {match.home.halfTimeScore} : {match.away.halfTimeScore}</span>}</div>
                <div className="flex min-w-0 items-center justify-end gap-3 text-right sm:gap-4"><div className="min-w-0"><p className="text-[8px] font-extrabold uppercase tracking-[.15em] text-[#92958c]">Away</p><h2 className="mt-1 truncate text-[17px] font-extrabold leading-tight tracking-[-.045em] text-[#2e424b] sm:text-[22px]" data-testid="text-match-away">{match.away.name}</h2></div><TeamCrest name={match.away.name} logo={match.away.logo} large /></div>
              </div>
              <div className="grid gap-2 border-t border-[#e8e6de] bg-[#f6f5ef] px-4 py-3.5 text-[9px] text-[#737d76] sm:grid-cols-3 sm:px-6">
                <div className="flex items-center gap-2"><CalendarDays size={13} className="text-[#9b7160]" /><span data-testid="text-match-date">{formatDate(match.date)}</span></div>
                <div className="flex items-center gap-2"><Clock3 size={13} className="text-[#9b7160]" /><span data-testid="text-match-venue">{match.venue || 'Venue not listed'}</span></div>
                <div className="flex items-center gap-2"><Shield size={13} className="text-[#9b7160]" /><span>{match.leagueId ? `League ${match.leagueId}` : match.competition}</span></div>
              </div>
            </section>

            <section className="mt-5 overflow-hidden rounded-[16px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_12px_40px_rgba(47,59,64,.04)]">
              <div role="tablist" aria-label="Match details sections" className="flex gap-1 overflow-x-auto border-b border-[#deddd4] bg-[#f4f3ed] p-2 sm:p-2.5" data-testid="tabs-match-details">
                {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold transition sm:px-4 ${activeTab === tab.id ? 'bg-[#253746] text-[#f8f2e7] shadow-sm' : 'text-[#718079] hover:bg-[#e9eee8] hover:text-[#344550]'}`} data-testid={`tab-${tab.id}`}><span className={`mono text-[8px] ${activeTab === tab.id ? 'text-[#d8a08a]' : 'text-[#a7a99f]'}`}>{tab.short}</span>{tab.label}</button>)}
              </div>
              <div className="p-4 sm:p-6">
                {activeTab === 'table' && <StandingsPanel details={details} />}
                {activeTab === 'odds' && <OddsPanel details={details} />}
                {activeTab === 'form' && <FormPanel details={details} />}
                {activeTab === 'h2h' && <HeadToHeadPanel details={details} />}
                {activeTab === 'tmp' && <MatchTmpPanel details={details} context={tmpQuery.data} isLoading={tmpQuery.isLoading} isError={tmpQuery.isError} error={tmpQuery.error} onRetry={() => { void tmpQuery.refetch(); }} />}
                {activeTab === 'insights' && <div className="space-y-7">
                  <MatchInsightsPanel details={details} lastFive={lastFiveQuery.data} lastFiveLoading={lastFiveQuery.isLoading} lastFiveError={lastFiveQuery.isError} context={tmpQuery.data} isLoading={tmpQuery.isLoading} isError={tmpQuery.isError} error={tmpQuery.error} onRetry={() => { void tmpQuery.refetch(); }} />
                  <MatchupAnalysisPanel data={lastFiveQuery.data} matchDate={match.date} isLoading={lastFiveQuery.isLoading} isError={lastFiveQuery.isError} error={lastFiveQuery.error} onRetry={() => { void lastFiveQuery.refetch(); }} />
                </div>}
                {activeTab === 'graphs' && <PerformanceGraphsPanel fixtureId={fixtureId} details={details} lastFive={lastFiveQuery.data as FootballMatchLastFive | undefined} lastFiveLoading={lastFiveQuery.isLoading} context={tmpQuery.data as FootballMatchTmpContext | undefined} isLoading={tmpQuery.isLoading} isError={tmpQuery.isError} error={tmpQuery.error} onRetry={() => { void tmpQuery.refetch(); }} />}
                {activeTab === 'lastfive' && <LastFivePanel data={lastFiveQuery.data} isLoading={lastFiveQuery.isLoading} isError={lastFiveQuery.isError} error={lastFiveQuery.error} onRetry={() => { void lastFiveQuery.refetch(); }} />}
              </div>
            </section>
            <footer className="mt-4 flex flex-col justify-between gap-2 px-1 text-[9px] leading-5 text-[#8b8d84] sm:flex-row sm:items-center">
              <p className="flex items-start gap-2"><Scale size={12} className="mt-0.5 shrink-0" /> Match information and context are provided by KickoffScore.</p>
              <a href={details.sourceUrl} target="_blank" rel="noreferrer" className="mono inline-flex shrink-0 items-center gap-1.5 tracking-wide text-[#758078] hover:text-[#d06c4f]" data-testid="link-match-source">OPEN SOURCE <ArrowUpRight size={11} /></a>
            </footer>
          </div>
        ) : (
          <EmptySection title="No match details returned" detail="The source returned an empty response for this fixture." testId="status-match-empty" />
        )}
      </div>
    </main>
  );
}
