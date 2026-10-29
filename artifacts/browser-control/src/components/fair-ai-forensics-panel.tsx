import { useEffect, useState } from 'react';
import {
  getGetFootballFairAiTeamsQueryKey,
  useGetFootballFairAiTeams,
  useRunFootballFairAiForensics,
  type FootballFairAiTacticalTeamProfile,
  type FootballFairAiTeam,
} from '@workspace/api-client-react';
import { Activity, AlertTriangle, RefreshCw, Search, ShieldAlert } from 'lucide-react';

type TeamChoice = Pick<FootballFairAiTeam, 'teamKey' | 'name' | 'recentMatchCount'>;

type FairAiForensicsPanelProps = {
  initialHome?: TeamChoice;
  initialAway?: TeamChoice;
};

function TeamSelector({
  side,
  selected,
  onSelect,
}: {
  side: 'home' | 'away';
  selected: TeamChoice | null;
  onSelect: (team: TeamChoice) => void;
}) {
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim();
  const teamsQuery = useGetFootballFairAiTeams(
    { search: normalizedSearch || undefined },
    {
      query: {
        queryKey: getGetFootballFairAiTeamsQueryKey({
          search: normalizedSearch || undefined,
        }),
        enabled: normalizedSearch.length >= 2,
        staleTime: 30_000,
      },
    },
  );
  const teams = teamsQuery.data?.teams ?? [];

  return (
    <section className="rounded-xl border border-[#e2e2d8] bg-[#fbfaf6] p-3">
      <label
        htmlFor={`forensics-team-${side}`}
        className="text-[8px] font-extrabold uppercase tracking-[.12em] text-[#78837a]"
      >
        {side === 'home' ? 'First team' : 'Second team'}
      </label>
      <div className="relative mt-2">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9b92]" />
        <input
          id={`forensics-team-${side}`}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search teams"
          className="h-9 w-full rounded-lg border border-[#d8d7ce] bg-white pl-9 pr-3 text-[10px] text-[#344550] outline-none transition focus:border-[#6e927b] focus:ring-2 focus:ring-[#6e927b]/15"
          data-testid={`input-forensics-team-${side}`}
        />
      </div>
      {selected && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-[#eaf1e9] px-2.5 py-2" data-testid={`selection-forensics-${side}`}>
          <span className="min-w-0 truncate text-[9px] font-extrabold text-[#4e755c]">{selected.name}</span>
          <span className="mono shrink-0 text-[7px] text-[#718172]">
            {selected.recentMatchCount} recent
          </span>
        </div>
      )}
      <div className="mt-2 max-h-[148px] space-y-1 overflow-y-auto" aria-label={`${side} team search results`}>
        {teamsQuery.isLoading ? (
          <div className="space-y-1.5 px-2 py-2" role="status" aria-label={`Loading ${side} teams`}>
            {[0, 1, 2].map((row) => <div key={row} className="h-7 animate-pulse rounded-md bg-[#eeede6]" />)}
          </div>
        ) : teamsQuery.isError ? (
          <div className="px-2 py-2 text-[8px] leading-4 text-[#a35f4d]" role="alert">
            Could not load teams. Try again.
          </div>
        ) : teams.length ? (
          teams.slice(0, 8).map((team) => (
            <button
              key={team.teamKey}
              type="button"
              onClick={() => onSelect({
                teamKey: team.teamKey,
                name: team.name,
                recentMatchCount: team.recentMatchCount,
              })}
              aria-pressed={selected?.teamKey === team.teamKey}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                selected?.teamKey === team.teamKey
                  ? 'bg-[#eaf1e9] text-[#4e755c]'
                  : 'bg-[#f5f4ed] text-[#53625d] hover:bg-[#eeefe7]'
              }`}
              data-testid={`button-select-forensics-${side}-${team.teamKey}`}
            >
              <span className="min-w-0 truncate text-[9px] font-bold">{team.name}</span>
              <span className="mono shrink-0 text-[7px] text-[#81877e]">
                {team.recentMatchCount} matches
              </span>
            </button>
          ))
        ) : (
          <div className="px-2 py-3 text-[8px] text-[#858982]" role="status">
            {normalizedSearch.length < 2
              ? 'Type at least 2 letters to search teams.'
              : 'No matching teams with imported results.'}
          </div>
        )}
      </div>
    </section>
  );
}

function value(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toFixed(digits);
}

function percentage(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${value.toFixed(1)}%`;
}

function sampleCount(count: number, total: number) {
  return `${count}/${total}`;
}

function dateLabel(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function Metric({
  label,
  value: metric,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-[#f7f7f1] px-2.5 py-2">
      <p className="text-[7px] font-extrabold uppercase tracking-[.08em] text-[#858982]">{label}</p>
      <p className="mono mt-1 text-[9px] font-semibold text-[#4d6555]">{metric}</p>
    </div>
  );
}

function TeamForensics({ profile }: { profile: FootballFairAiTacticalTeamProfile }) {
  const analyzed = profile.matchesAnalyzed;
  const formationText = profile.observedFormations.length
    ? profile.observedFormations.join(' · ')
    : 'No formation records';

  return (
    <article className="min-w-0 rounded-xl border border-[#e4e6dd] bg-white p-3.5" data-testid={`card-forensics-team-${profile.teamName}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-extrabold text-[#40534b]">{profile.teamName}</h3>
          <p className="mono mt-1 text-[7px] uppercase tracking-[.1em] text-[#858982]">
            {profile.matchesAnalyzed} of {profile.matchesExpected} matches analyzed
          </p>
        </div>
        <span className="rounded-full border border-[#e2d5b9] bg-[#f7f0df] px-2 py-1 text-[7px] font-extrabold uppercase text-[#927447]">
          Retrospective
        </span>
      </div>

      <section className="mt-3" aria-label={`${profile.teamName} observed outcomes`}>
        <p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#9b7160]">Observed outcomes · sample counts</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Wins · draws · losses" value={`${profile.results.wins} · ${profile.results.draws} · ${profile.results.losses}`} />
          <Metric label="Goals for / against" value={`${value(profile.averageGoalsFor)} / ${value(profile.averageGoalsAgainst)}`} />
          <Metric label="BTTS yes" value={sampleCount(profile.bttsMatches, analyzed)} />
          <Metric label="Over 2.5 / 3.5" value={`${sampleCount(profile.over25Matches, analyzed)} / ${sampleCount(profile.over35Matches, analyzed)}`} />
        </div>
      </section>

      <section className="mt-3" aria-label={`${profile.teamName} tactical evidence`}>
        <p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#9b7160]">Tactical root-cause framework · evidence check</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-[#e6e9e1] bg-[#fbfaf6] p-2.5">
            <h4 className="text-[8px] font-extrabold text-[#52615e]">1 · Build-up mechanics</h4>
            <p className="mono mt-1.5 text-[8px] leading-4 text-[#4d6555]">
              Possession {percentage(profile.averagePossessionPct)} · pass {percentage(profile.averagePassCompletionPct)} · final third {percentage(profile.averageFinalThirdPassCompletionPct)} · long balls {percentage(profile.averageLongBallCompletionPct)}
            </p>
            <p className="mt-1 text-[7px] leading-4 text-[#788078]">
              {profile.buildupMatchCount}/{profile.matchesExpected} matches have at least one passing indicator. These totals do not show overloads, direction, or confidence.
            </p>
          </div>
          <div className="rounded-lg border border-[#e6e9e1] bg-[#fbfaf6] p-2.5">
            <h4 className="text-[8px] font-extrabold text-[#52615e]">2 · Press efficiency</h4>
            <p className="mono mt-1.5 text-[8px] leading-4 text-[#4d6555]">
              Tackles + interceptions {value(profile.averageDefensiveActions)} · recoveries {value(profile.averageRecoveries)} · shots conceded {value(profile.averageShotsAgainst)}
            </p>
            <p className="mt-1 text-[7px] leading-4 text-[#788078]">
              Defensive activity and shots allowed are only proxies; press intensity, location, and high-ball recoveries are not measured.
            </p>
          </div>
          <div className="rounded-lg border border-[#e6e9e1] bg-[#fbfaf6] p-2.5">
            <h4 className="text-[8px] font-extrabold text-[#52615e]">3 · Rest-defense exposure</h4>
            <p className="mono mt-1.5 text-[8px] leading-4 text-[#4d6555]">
              Goals conceded {value(profile.averageGoalsAgainst)} · shots on target conceded {value(profile.averageShotsOnTargetAgainst)}
            </p>
            <p className="mt-1 text-[7px] leading-4 text-[#788078]">
              Concession volume can be reviewed, but the source does not identify transition attacks, defensive anchors, or shape behind the ball.
            </p>
          </div>
          <div className="rounded-lg border border-[#e6e9e1] bg-[#fbfaf6] p-2.5">
            <h4 className="text-[8px] font-extrabold text-[#52615e]">4 · Structural mismatches</h4>
            <p className="mono mt-1.5 text-[8px] leading-4 text-[#4d6555]">
              Formations observed: {formationText}
            </p>
            <p className="mt-1 text-[7px] leading-4 text-[#788078]">
              {profile.formationSamples}/{profile.matchesExpected} lineups include a formation. Opponent shapes and 1v1 tracking are unavailable, so specific mismatches cannot be confirmed.
            </p>
          </div>
        </div>
      </section>
      <section className="mt-3" aria-label={`${profile.teamName} match-by-match evidence`}>
        <p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#9b7160]">Match-by-match evidence</p>
        <div className="mt-2 space-y-1.5">
          {profile.recentMatches.map((match) => (
            <article
              key={match.fixtureId}
              className="rounded-lg border border-[#e6e9e1] bg-[#fbfaf6] px-2.5 py-2"
              data-testid={`row-forensics-match-${profile.teamName}-${match.fixtureId}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 truncate text-[8px] font-bold text-[#52615e]">
                  {dateLabel(match.matchDate)} · vs {match.opponentName}
                </p>
                <p className="mono text-[9px] font-extrabold text-[#40534b]">
                  {match.goalsFor}–{match.goalsAgainst}
                  <span className="ml-1.5 text-[7px] uppercase text-[#8a785d]">{match.result}</span>
                </p>
              </div>
              <p className="mono mt-1 text-[7px] leading-4 text-[#788078]">
                BTTS {match.bothTeamsScored ? 'yes' : 'no'} · {match.totalGoals > 2.5 ? 'Over' : 'Under'} 2.5 · {match.totalGoals > 3.5 ? 'Over' : 'Under'} 3.5
              </p>
              <p className="mono mt-0.5 text-[7px] leading-4 text-[#788078]">
                Shots {value(match.shotsFor, 0)}–{value(match.shotsAgainst, 0)} · pass {percentage(match.passCompletionPct)} · final third {percentage(match.finalThirdPassCompletionPct)} · def. actions {value(match.defensiveActions, 0)} · {match.formation ?? 'formation n/a'}
              </p>
            </article>
          ))}
          {!profile.recentMatches.length && (
            <p className="rounded-lg bg-[#f7f7f1] px-2.5 py-2 text-[8px] text-[#858982]" role="status">
              No completed match details were available in this refresh.
            </p>
          )}
        </div>
      </section>
      <p className="mt-3 rounded-lg border border-[#e8dfca] bg-[#faf5e9] px-2.5 py-2 text-[7px] leading-4 text-[#7d6c4d]">
        These five-match frequencies describe what happened, not why it happened. They are not forecasts; causal explanations require event-level tactical or positional evidence.
      </p>
    </article>
  );
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'The latest completed match records could not be loaded. Try again.';
}

export default function FairAiForensicsPanel({
  initialHome,
  initialAway,
}: FairAiForensicsPanelProps) {
  const [home, setHome] = useState<TeamChoice | null>(initialHome ?? null);
  const [away, setAway] = useState<TeamChoice | null>(initialAway ?? null);
  const forensics = useRunFootballFairAiForensics();

  useEffect(() => {
    setHome(initialHome ?? null);
    setAway(initialAway ?? null);
  }, [initialHome?.teamKey, initialHome?.name, initialAway?.teamKey, initialAway?.name]);

  const canAnalyze = !!home && !!away &&
    home.teamKey !== away.teamKey && !forensics.isPending;

  return (
    <section
      className="overflow-hidden rounded-[16px] border border-[#cfdccf] bg-[#f9faf4] text-[#344550] shadow-[0_12px_36px_rgba(47,59,64,.045)]"
      aria-labelledby="fair-forensics-title"
      data-testid="section-fair-ai-forensics"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe7db] bg-[#f0f4ed] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#deeadf] text-[#557b63]" aria-hidden="true"><Activity size={16} /></span>
          <div>
            <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">FAIR AI / post-match review</p>
            <h2 id="fair-forensics-title" className="mt-0.5 text-[13px] font-extrabold text-[#344550]">Tactical patterns across the last five</h2>
          </div>
        </div>
        <span className="rounded-full border border-[#d7dfd5] bg-white px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.08em] text-[#627b67]">
          No predictions
        </span>
      </div>

      <div className="space-y-3 p-3 sm:p-5">
        <div className="flex max-w-[1000px] items-start gap-2 rounded-lg border border-[#e8dfca] bg-[#faf5e9] px-3 py-2.5 text-[8px] leading-[1.65] text-[#7d6c4d]" role="note">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <p>This review refreshes up to five completed matches per team and reports observed results and aggregate statistics only. The formula is a framework for checking evidence—not a claim that these inputs prove a tactical cause.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <TeamSelector side="home" selected={home} onSelect={setHome} />
          <TeamSelector side="away" selected={away} onSelect={setAway} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (!canAnalyze || !home || !away) return;
              forensics.mutate({
                data: { homeTeamKey: home.teamKey, awayTeamKey: away.teamKey },
              });
            }}
            disabled={!canAnalyze}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#253746] px-4 text-[9px] font-extrabold text-[#f8f2e7] transition hover:bg-[#344b5a] disabled:cursor-not-allowed disabled:opacity-45"
            data-testid="button-run-forensic-review"
          >
            {forensics.isPending
              ? <><RefreshCw size={12} className="animate-spin" /> Refreshing last five…</>
              : <><ShieldAlert size={12} /> {forensics.data ? 'Refresh forensic review' : 'Analyze last five'}</>}
          </button>
          {home && away && home.teamKey === away.teamKey && (
            <span className="text-[8px] text-[#a35f4d]" role="status">Select two different teams.</span>
          )}
        </div>

        {forensics.isError && (
          <div className="rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-3 text-[9px] leading-5 text-[#784b3e]" role="alert" data-testid="status-forensics-error">
            {errorMessage(forensics.error)}
          </div>
        )}
        {forensics.isPending && (
          <div className="grid gap-3 border-t border-[#e4e5da] pt-4 md:grid-cols-2" role="status" aria-label="Forensic review in progress">
            <div className="h-48 animate-pulse rounded-xl bg-[#eeede6]" />
            <div className="h-48 animate-pulse rounded-xl bg-[#eeede6]" />
          </div>
        )}
        {forensics.data && !forensics.isPending && (
          <div className="space-y-3 border-t border-[#e4e5da] pt-4" data-testid="result-forensic-review">
            <p className="text-[8px] leading-4 text-[#737c73]" data-testid="text-forensics-source">
              Source: {forensics.data.source} {forensics.data.matchupNote}
            </p>
            <div className="grid gap-3 xl:grid-cols-2">
              <TeamForensics profile={forensics.data.home} />
              <TeamForensics profile={forensics.data.away} />
            </div>
            <div className="rounded-lg border border-[#e6e9e1] bg-white px-3 py-2.5">
              <h3 className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#52615e]">Source limits</h3>
              <ul className="mt-1.5 space-y-1 text-[7px] leading-4 text-[#788078]">
                {forensics.data.limitations.map((limitation) => (
                  <li key={limitation} className="flex gap-1.5">
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-[#c7a773]" />
                    {limitation}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
