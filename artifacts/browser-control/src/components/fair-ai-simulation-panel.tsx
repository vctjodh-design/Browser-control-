import { useState } from 'react';
import {
  getGetFootballFairAiTeamsQueryKey,
  useGetFootballFairAiTeams,
  useRunFootballFairAiSimulation,
  type FootballFairAiTeam,
} from '@workspace/api-client-react';
import { AlertTriangle, CircleAlert, Play, RefreshCw, Sparkles } from 'lucide-react';

function TeamPicker({
  side,
  search,
  onSearch,
  selected,
  onSelect,
}: {
  side: 'home' | 'away';
  search: string;
  onSearch: (value: string) => void;
  selected: FootballFairAiTeam | null;
  onSelect: (team: FootballFairAiTeam) => void;
}) {
  const query = search.trim().length >= 2 ? search.trim() : undefined;
  const queryKey = getGetFootballFairAiTeamsQueryKey({ search: query });
  const teamsQuery = useGetFootballFairAiTeams(
    { search: query },
    { query: { queryKey, staleTime: 30_000 } },
  );
  const teams = teamsQuery.data?.teams ?? [];

  return (
    <div className="rounded-xl border border-[#e2e2d8] bg-[#fbfaf6] p-3">
      <label htmlFor={`fair-team-search-${side}`} className="text-[8px] font-extrabold uppercase tracking-[.12em] text-[#78837a]">
        {side === 'home' ? 'Home team' : 'Away team'}
      </label>
      <input
        id={`fair-team-search-${side}`}
        type="search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search imported teams"
        className="mt-2 h-9 w-full rounded-lg border border-[#d8d7ce] bg-white px-3 text-[10px] text-[#344550] outline-none transition focus:border-[#6e927b] focus:ring-2 focus:ring-[#6e927b]/15"
        data-testid={`input-simulation-${side}-search`}
      />
      {selected && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-[#eaf1e9] px-2.5 py-2">
          <span className="min-w-0 truncate text-[9px] font-extrabold text-[#4e755c]">{selected.name}</span>
          <span className="mono shrink-0 text-[8px] text-[#718172]">{selected.formation ?? 'Formation n/a'}</span>
        </div>
      )}
      <div className="mt-2 max-h-[148px] space-y-1 overflow-y-auto" aria-label={`${side} team search results`}>
        {teamsQuery.isLoading ? (
          <div className="px-2 py-3 text-[8px] text-[#858982]" role="status">Loading teams…</div>
        ) : teamsQuery.isError ? (
          <div className="flex items-start gap-1.5 px-2 py-2 text-[8px] leading-4 text-[#a35f4d]" role="alert">
            <CircleAlert size={12} className="mt-0.5 shrink-0" />
            Could not load teams. Try again.
          </div>
        ) : teams.length ? (
          teams.slice(0, 8).map((team) => (
            <button
              key={team.teamKey}
              type="button"
              onClick={() => onSelect(team)}
              aria-pressed={selected?.teamKey === team.teamKey}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                selected?.teamKey === team.teamKey
                  ? 'bg-[#eaf1e9] text-[#4e755c]'
                  : 'bg-[#f5f4ed] text-[#53625d] hover:bg-[#eeefe7]'
              }`}
              data-testid={`button-select-team-${side}`}
            >
              <span className="min-w-0 truncate text-[9px] font-bold">{team.name}</span>
              <span className="mono shrink-0 text-[7px] text-[#81877e]">
                {team.recentMatchCount} recent · {team.avgGoalsFor.toFixed(1)} GF
              </span>
            </button>
          ))
        ) : (
          <div className="px-2 py-3 text-[8px] text-[#858982]" role="status">
            {search.trim().length < 2 ? 'Showing popular archive teams. Type 2+ letters to search.' : 'No matching teams with imported results.'}
          </div>
        )}
      </div>
    </div>
  );
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function metricValue(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toFixed(digits);
}

function simulationError(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'The simulation could not be completed. Try again.';
}

export default function FairAiSimulationPanel() {
  const [homeSearch, setHomeSearch] = useState('');
  const [awaySearch, setAwaySearch] = useState('');
  const [home, setHome] = useState<FootballFairAiTeam | null>(null);
  const [away, setAway] = useState<FootballFairAiTeam | null>(null);
  const simulation = useRunFootballFairAiSimulation();
  const canRun = Boolean(home && away && home.teamKey !== away.teamKey && !simulation.isPending);

  const runSimulation = () => {
    if (!home || !away || home.teamKey === away.teamKey || simulation.isPending) return;
    simulation.mutate({ data: { homeTeamKey: home.teamKey, awayTeamKey: away.teamKey, iterations: 10_000 } });
  };

  const result = simulation.data;

  return (
    <section
      className="mb-4 overflow-hidden rounded-[16px] border border-[#cfdccf] bg-[#f9faf4] text-[#344550] shadow-[0_12px_36px_rgba(47,59,64,.045)]"
      aria-labelledby="fair-simulation-title"
      data-testid="section-fair-ai-simulation"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe7db] bg-[#f0f4ed] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#deeadf] text-[#557b63]" aria-hidden="true"><Sparkles size={16} /></span>
          <div>
            <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">FAIR AI / simulation</p>
            <h2 id="fair-simulation-title" className="mt-0.5 text-[13px] font-extrabold text-[#344550]">Player &amp; team-stat Monte Carlo</h2>
          </div>
        </div>
        <span className="rounded-full border border-[#e2d5b9] bg-[#f7f0df] px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.08em] text-[#927447]">
          Experimental · 10,000 runs
        </span>
      </div>

      <div className="space-y-3 p-3 sm:p-5">
        <p className="max-w-[820px] text-[9px] leading-[1.7] text-[#737c73]">
          Choose two teams with completed archive matches. The 10,000-run forecast uses recent xG, possession, shots, defensive stats, formations, and individual player ratings and action statistics where available.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <TeamPicker side="home" search={homeSearch} onSearch={setHomeSearch} selected={home} onSelect={setHome} />
          <TeamPicker side="away" search={awaySearch} onSearch={setAwaySearch} selected={away} onSelect={setAway} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runSimulation}
            disabled={!canRun}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#253746] px-4 text-[9px] font-extrabold text-[#f8f2e7] transition hover:bg-[#344b5a] disabled:cursor-not-allowed disabled:opacity-45"
            data-testid="button-run-fair-ai-simulation"
          >
            {simulation.isPending ? <><RefreshCw size={12} className="animate-spin" /> Running 10,000 runs…</> : <><Play size={12} /> Run simulation</>}
          </button>
          {home && away && home.teamKey === away.teamKey && (
            <span className="text-[8px] text-[#a35f4d]" role="status">Select two different teams.</span>
          )}
        </div>

        {simulation.isError && (
          <div className="flex items-start gap-2 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-3 text-[9px] leading-5 text-[#784b3e]" role="alert" data-testid="status-fair-simulation-error">
            <CircleAlert size={13} className="mt-0.5 shrink-0" />{simulationError(simulation.error)}
          </div>
        )}

        {result && (
          <div className="space-y-3 border-t border-[#e4e5da] pt-4" data-testid="result-fair-ai-simulation">
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { label: `${result.home.name} win`, value: result.probabilities.home, count: result.outcomes.home },
                { label: 'Draw', value: result.probabilities.draw, count: result.outcomes.draw },
                { label: `${result.away.name} win`, value: result.probabilities.away, count: result.outcomes.away },
              ].map((outcome, index) => (
                <div key={outcome.label} className="rounded-xl border border-[#e2e2d8] bg-white px-3 py-3">
                  <p className="truncate text-[8px] font-extrabold uppercase tracking-[.08em] text-[#858982]">{outcome.label}</p>
                  <p className={`mono mt-1 text-[21px] font-semibold tracking-[-.05em] ${index === 1 ? 'text-[#8e784d]' : 'text-[#466d56]'}`}>{percent(outcome.value)}</p>
                  <p className="mono mt-0.5 text-[7px] text-[#92948b]">{outcome.count.toLocaleString()} / {result.iterations.toLocaleString()} runs</p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
              <div className="rounded-xl border border-[#e2e2d8] bg-white p-3">
                <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#858982]">Expected goals · team stats + player profile</p>
                <p className="mono mt-2 text-[16px] font-semibold text-[#344c43]">
                  {result.expectedHomeGoals.toFixed(2)} <span className="px-1 text-[#a5a69d]">—</span> {result.expectedAwayGoals.toFixed(2)}
                </p>
                <p className="mt-1 truncate text-[8px] text-[#858982]">{result.home.name} · {result.away.name}</p>
                <p className="mt-2 text-[8px] leading-4 text-[#777f77]">
                  Inputs: {result.home.teamStats?.matchStatSampleCount ?? 0} home and {result.away.teamStats?.matchStatSampleCount ?? 0} away team-stat samples; player inputs use up to 10 recent archived matches.
                </p>
              </div>
              <div className="rounded-xl border border-[#e2e2d8] bg-white p-3">
                <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#858982]">Most sampled scorelines</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.topScorelines.map((score) => (
                    <span key={`${score.homeGoals}-${score.awayGoals}`} className="mono rounded-md bg-[#f2f3ec] px-2 py-1 text-[8px] font-bold text-[#506357]">
                      {score.homeGoals}–{score.awayGoals} · {percent(score.probability)}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[8px] leading-4 text-[#777f77]">
                  Source averages: {result.home.avgGoalsFor.toFixed(2)} GF / {result.home.avgGoalsAgainst.toFixed(2)} GA and {result.away.avgGoalsFor.toFixed(2)} GF / {result.away.avgGoalsAgainst.toFixed(2)} GA per recent match.
                </p>
              </div>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {[result.home, result.away].map((team) => {
                const stats = team.teamStats;
                const players = team.players ?? [];
                return (
                  <section key={team.teamKey} className="overflow-hidden rounded-xl border border-[#e2e2d8] bg-white" aria-label={`${team.name} simulation inputs`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e9e7df] bg-[#f5f4ed] px-3 py-2.5">
                      <div>
                        <h3 className="text-[9px] font-extrabold text-[#4d5f58]">{team.name}</h3>
                        <p className="mt-0.5 text-[7px] text-[#858982]">{team.formation ?? 'Formation unavailable'} · {stats?.coachName ?? 'Coach unavailable'}</p>
                      </div>
                      <span className="mono text-[7px] text-[#81877e]">{players.length} player profiles</span>
                    </div>
                    <div className="grid grid-cols-3 gap-px bg-[#e9e7df]">
                      {[
                        ['xG / match', stats?.expectedGoalsFor],
                        ['xGA / match', stats?.expectedGoalsAgainst],
                        ['Possession', stats?.possessionPct, '%'],
                        ['Shots', stats?.shotsPerMatch],
                        ['On target', stats?.shotsOnTargetPerMatch],
                        ['Box touches', stats?.boxTouchesPerMatch],
                        ['Big chances', stats?.bigChancesPerMatch],
                        ['Pass accuracy', stats?.passCompletionPct, '%'],
                        ['Defensive actions', stats?.defensiveActionsPerMatch],
                      ].map(([label, value, suffix]) => (
                        <div key={String(label)} className="bg-white px-2.5 py-2">
                          <p className="text-[7px] font-bold text-[#858982]">{label}</p>
                          <p className="mono mt-0.5 text-[9px] font-semibold text-[#4d6555]">
                            {metricValue(typeof value === 'number' ? value : null)}{suffix && value !== null && value !== undefined ? suffix : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-[#e9e7df] px-3 py-2.5">
                      <p className="mb-1.5 text-[7px] font-extrabold uppercase tracking-[.1em] text-[#858982]">Latest observed XI · recent player rates</p>
                      {players.length ? (
                        <div className="space-y-1">
                          {players.slice(0, 6).map((player) => (
                            <div key={player.playerKey} className="rounded-md bg-[#f8f8f2] px-2 py-1.5">
                              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3">
                                <span className="min-w-0 truncate text-[8px] font-bold text-[#52615e]">{player.name}<span className="ml-1 font-normal text-[#92948b]">{player.position ?? '—'} · {player.starter ? 'XI' : 'sub'}</span></span>
                                <span className="mono text-[7px] text-[#778078]">R {metricValue(player.averageRating, 2)}</span>
                                <span className="mono text-[7px] text-[#778078]">xG {metricValue(player.expectedGoalsPer90, 2)}/90</span>
                                <span className="mono text-[7px] text-[#778078]">KP {metricValue(player.keyPassesPer90, 2)}/90</span>
                              </div>
                              <p className="mono mt-0.5 pl-1 text-[7px] text-[#899087]">
                                Pass {metricValue(player.passCompletionPct, 1)}% · D+I {metricValue(player.tacklesPer90 + player.interceptionsPer90, 2)}/90 · Saves {metricValue(player.savesPer90, 2)}/90
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[8px] text-[#858982]">No rated player-match profiles are available for this team yet.</p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
            {result.playerContributions.length > 0 && (
              <section className="rounded-xl border border-[#e2e2d8] bg-white p-3" aria-labelledby="fair-simulation-contributions-title">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id="fair-simulation-contributions-title" className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#68756e]">Sampled player goal / assist credits</h3>
                  <span className="mono text-[7px] text-[#92948b]">Across {result.iterations.toLocaleString()} runs · credits sampled from individual rates</span>
                </div>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {result.playerContributions.slice(0, 8).map((player) => (
                    <div key={`${player.teamName}-${player.playerKey}`} className="flex items-center justify-between gap-3 rounded-md bg-[#f5f4ed] px-2.5 py-2">
                      <span className="min-w-0 truncate text-[8px] font-bold text-[#52615e]">{player.playerName}<span className="ml-1 font-normal text-[#858982]">· {player.teamName}</span></span>
                      <span className="mono shrink-0 text-[7px] text-[#718172]">{player.simulatedGoals.toLocaleString()} G · {player.simulatedAssists.toLocaleString()} A</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <div className="flex items-start gap-2 rounded-lg border border-[#e8dfca] bg-[#faf5e9] px-3 py-2.5 text-[8px] leading-[1.6] text-[#7d6c4d]" role="note">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <div>
                <strong>Model scope:</strong>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
