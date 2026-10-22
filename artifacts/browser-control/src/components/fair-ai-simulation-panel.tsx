import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFootballFairAiDataQueryKey,
  getGetFootballFairAiTeamsQueryKey,
  useGetFootballFairAiTeams,
  useRunFootballFairAiSimulation,
  type FootballFairAiTeam,
} from '@workspace/api-client-react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CircleAlert,
  CornerDownRight,
  Crosshair,
  Footprints,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  Target,
} from 'lucide-react';

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
          <div className="space-y-1.5 px-2 py-2" role="status" aria-label={`Loading ${side} teams`}>
            {[0, 1, 2].map((row) => <div key={row} className="h-7 animate-pulse rounded-md bg-[#eeede6]" />)}
          </div>
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

function metricValue(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function pct(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`;
}

function probability(value: number) {
  const percent = value * 100;
  const digits = percent > 0 && percent < 0.1
    ? percent < 0.01 ? 3 : 2
    : percent > 99.9 && percent < 100 ? 2 : 1;
  return `${percent.toFixed(digits)}%`;
}

function simulationError(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'The simulation could not be completed. Try again.';
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function PitchGrid({
  team,
  columns,
  rows,
  accent,
  title,
}: {
  team: NonNullable<NonNullable<ReturnType<typeof useRunFootballFairAiSimulation>['data']>['possessionModel']>['home'];
  columns: number;
  rows: number;
  accent: string;
  title: string;
}) {
  const cells = team.gridCells ?? [];
  const maxTouches = Math.max(1, ...cells.map((cell) => cell.touches));
  const safeColumns = Math.max(1, columns);
  const safeRows = Math.max(1, rows);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="truncate text-[9px] font-extrabold text-[#4b5d56]">{title}</h4>
        <span className="mono text-[7px] text-[#858982]">{safeColumns} × {safeRows} zones</span>
      </div>
      <svg viewBox="0 0 100 64" className="w-full overflow-hidden rounded-lg border border-[#cdd9cc] bg-[#e9f0e5]" role="img" aria-label={`${title} simulated touch and action grid`}>
        <defs>
          <pattern id={`pitch-lines-${title.replace(/[^a-z0-9]/gi, '')}`} width="10" height="64" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 10 64" fill="none" stroke="#dce7d8" strokeWidth=".35" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="100" height="64" fill={`url(#pitch-lines-${title.replace(/[^a-z0-9]/gi, '')})`} />
        <rect x="1.2" y="1.2" width="97.6" height="61.6" fill="none" stroke="#a9bba9" strokeWidth=".55" />
        <line x1="50" y1="1.2" x2="50" y2="62.8" stroke="#a9bba9" strokeWidth=".45" />
        <circle cx="50" cy="32" r="8" fill="none" stroke="#a9bba9" strokeWidth=".45" />
        <circle cx="50" cy="32" r=".55" fill="#a9bba9" />
        <rect x="1.2" y="19" width="13" height="26" fill="none" stroke="#a9bba9" strokeWidth=".45" />
        <rect x="85.8" y="19" width="13" height="26" fill="none" stroke="#a9bba9" strokeWidth=".45" />
        {cells.map((cell, index) => {
          const x = ((cell.x + 0.5) / safeColumns) * 100;
          const y = ((cell.y + 0.5) / safeRows) * 64;
          const radius = 2.4 + (Math.min(cell.touches, maxTouches) / maxTouches) * 4.2;
          const alpha = 0.12 + (Math.min(cell.touches, maxTouches) / maxTouches) * 0.58;
          return (
            <g key={`${cell.x}-${cell.y}-${index}`}>
              <circle cx={x} cy={y} r={radius} fill={accent} opacity={alpha} />
              {cell.touches > 0 && <circle cx={x} cy={y} r=".8" fill="#f9faf4" opacity=".9" />}
            </g>
          );
        })}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[7px] text-[#7e877e]">
        <span>Touches {numberFormat.format(cells.reduce((sum, cell) => sum + cell.touches, 0))}</span>
        <span>Passes {numberFormat.format(cells.reduce((sum, cell) => sum + cell.passes, 0))}</span>
        <span>Shots {numberFormat.format(cells.reduce((sum, cell) => sum + cell.shots, 0))}</span>
      </div>
    </div>
  );
}

function SampledPossession({
  possession,
  active,
  onSelect,
}: {
  possession: NonNullable<NonNullable<ReturnType<typeof useRunFootballFairAiSimulation>['data']>['possessionModel']>['sampledPossessions'][number];
  active: boolean;
  onSelect: () => void;
}) {
  const tone = possession.outcome === 'goal'
    ? 'bg-[#e8f0e6] text-[#4d7558]'
    : possession.outcome === 'turnover'
      ? 'bg-[#f7eae3] text-[#a35f4d]'
      : possession.outcome === 'shot'
        ? 'bg-[#f7f0df] text-[#927447]'
        : 'bg-[#edf0e9] text-[#68786e]';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`w-full rounded-xl border p-3 text-left transition ${active ? 'border-[#789a7f] bg-[#f3f7f0] shadow-[0_4px_12px_rgba(47,59,64,.06)]' : 'border-[#e3e3d9] bg-white hover:border-[#bdcdbd]'}`}
      data-testid={`button-possession-${possession.possessionNumber}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[9px] font-extrabold text-[#465a52]">{possession.teamName}</p>
          <p className="mono mt-1 text-[7px] text-[#858982]">Possession {possession.possessionNumber} · {possession.minute}&apos;</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[7px] font-extrabold uppercase tracking-[.08em] ${tone}`}>{possession.outcome.replace('_', ' ')}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[8px] text-[#7c847c]">{possession.actions.length} actions</span>
        <span className="mono text-[8px] font-bold text-[#567d69]">EVA-style proxy {possession.estimatedValueAdded >= 0 ? '+' : ''}{metricValue(possession.estimatedValueAdded, 3)}</span>
      </div>
    </button>
  );
}

export default function FairAiSimulationPanel() {
  const queryClient = useQueryClient();
  const [homeSearch, setHomeSearch] = useState('');
  const [awaySearch, setAwaySearch] = useState('');
  const [home, setHome] = useState<FootballFairAiTeam | null>(null);
  const [away, setAway] = useState<FootballFairAiTeam | null>(null);
  const [selectedPossession, setSelectedPossession] = useState(0);
  const simulation = useRunFootballFairAiSimulation();
  const canRun = Boolean(home && away && home.teamKey !== away.teamKey && !simulation.isPending);

  const runSimulation = () => {
    if (!home || !away || home.teamKey === away.teamKey || simulation.isPending) return;
    setSelectedPossession(0);
    simulation.mutate(
      { data: { homeTeamKey: home.teamKey, awayTeamKey: away.teamKey, iterations: 10_000 } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: getGetFootballFairAiDataQueryKey(),
          });
          void queryClient.invalidateQueries({
            queryKey: getGetFootballFairAiTeamsQueryKey(),
          });
        },
      },
    );
  };

  const result = simulation.data;
  const model = result?.possessionModel;
  const samples = model?.sampledPossessions ?? [];
  const activeSample = samples[selectedPossession] ?? samples[0];
  const outcomeRows = result ? [
    { label: `${result.home.name} win`, value: result.probabilities.home, count: result.outcomes.home, tone: 'text-[#4e755c]' },
    { label: 'Draw', value: result.probabilities.draw, count: result.outcomes.draw, tone: 'text-[#927447]' },
    { label: `${result.away.name} win`, value: result.probabilities.away, count: result.outcomes.away, tone: 'text-[#a35f4d]' },
  ] : [];
  const teams = result ? [result.home, result.away] : [];
  const possessionTeams = model ? [model.home, model.away] : [];

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
            <h2 id="fair-simulation-title" className="mt-0.5 text-[13px] font-extrabold text-[#344550]">Possession flow &amp; player action profiles</h2>
          </div>
        </div>
        <span className="rounded-full border border-[#e2d5b9] bg-[#f7f0df] px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.08em] text-[#927447]">
          Experimental · 10,000 runs
        </span>
      </div>

      <div className="space-y-3 p-3 sm:p-5">
        <div className="flex max-w-[920px] items-start gap-2 rounded-lg border border-[#e8dfca] bg-[#faf5e9] px-3 py-2.5 text-[8px] leading-[1.65] text-[#7d6c4d]" role="note">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <p>Possession paths, pitch coordinates and EVA-style values are generated simulation proxies—not observed player tracking or measured FAIR EVA/xT. This is a simulation, not a trained RL policy.</p>
        </div>
        <p className="max-w-[820px] text-[9px] leading-[1.7] text-[#737c73]">
          Each run first fetches the selected teams&apos; five latest completed match records directly from KickoffScore. It then estimates match outcomes and shows example possession sequences, player actions and a model-generated pitch activity grid. If fresh source data is unavailable, the run stops rather than using stale records.
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
            {simulation.isPending ? <><RefreshCw size={12} className="animate-spin" /> Refreshing source &amp; running…</> : <><Play size={12} /> Run simulation</>}
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
        {simulation.isPending && (
          <div className="grid gap-3 border-t border-[#e4e5da] pt-4 md:grid-cols-[.8fr_1.2fr]" role="status" aria-label="Simulation in progress">
            <div className="h-28 animate-pulse rounded-xl bg-[#eeede6]" />
            <div className="h-28 animate-pulse rounded-xl bg-[#eeede6]" />
          </div>
        )}

        {result && (
          <div className="space-y-4 border-t border-[#e4e5da] pt-4" data-testid="result-fair-ai-simulation">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(240px,.8fr)]">
              <section className="overflow-hidden rounded-xl border border-[#e2e2d8] bg-white" aria-labelledby="possession-summary-title">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e9e7df] bg-[#f5f4ed] px-3 py-3">
                  <div>
                    <p className="mono text-[7px] uppercase tracking-[.13em] text-[#9b7160]">Match flow / simulated averages</p>
                    <h3 id="possession-summary-title" className="mt-1 text-[11px] font-extrabold text-[#40534b]">Possession profile</h3>
                  </div>
                  <div className="mono text-[8px] text-[#81877e]">xG {result.expectedHomeGoals.toFixed(2)} — {result.expectedAwayGoals.toFixed(2)} · {result.iterations.toLocaleString()} iterations</div>
                </div>
                {model ? (
                  <div className="p-3">
                    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] items-center gap-2">
                      {[model.home, model.away].map((team, index) => (
                        <div key={team.teamKey} className={`min-w-0 ${index ? 'text-right' : ''}`}>
                          <p className="truncate text-[9px] font-extrabold text-[#4d5f58]">{team.teamName}</p>
                          <p className="mono mt-1 text-[15px] font-semibold tracking-[-.04em] text-[#476d56]">{pct(team.possessionSharePct)}</p>
                        </div>
                      ))}
                      <span className="text-center text-[7px] font-extrabold uppercase tracking-[.1em] text-[#9a9b91]">Ball</span>
                    </div>
                    <div className="mb-4 flex h-2 overflow-hidden rounded-full bg-[#f0eee6]" aria-label="Possession share comparison">
                      <div className="rounded-l-full bg-[#638a6b] transition-[width]" style={{ width: `${Math.max(0, Math.min(100, model.home.possessionSharePct))}%` }} />
                      <div className="rounded-r-full bg-[#cf8268] transition-[width]" style={{ width: `${Math.max(0, Math.min(100, model.away.possessionSharePct))}%` }} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { label: 'Possessions / match', home: model.home.possessionsPerMatch, away: model.away.possessionsPerMatch, icon: Activity },
                        { label: 'Actions / possession', home: model.home.averageActionsPerPossession, away: model.away.averageActionsPerPossession, icon: Footprints },
                        { label: 'Shots / match', home: model.home.shotsPerMatch, away: model.away.shotsPerMatch, icon: Crosshair },
                        { label: 'Turnovers / match', home: model.home.turnoversPerMatch, away: model.away.turnoversPerMatch, icon: Shield },
                      ].map((metric) => {
                        const Icon = metric.icon;
                        return (
                          <div key={metric.label} className="rounded-lg bg-[#f7f7f1] px-2.5 py-2">
                            <p className="flex items-center gap-1 text-[7px] font-bold text-[#81877e]"><Icon size={10} />{metric.label}</p>
                            <p className="mono mt-1 truncate text-[9px] font-semibold text-[#4d6555]">{metricValue(metric.home)} <span className="text-[#b0afa4]">/</span> {metricValue(metric.away)}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {possessionTeams.map((team) => (
                        <div key={team.teamKey} className="rounded-lg border border-[#ecebe3] px-2.5 py-2">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="truncate text-[8px] font-extrabold text-[#52615e]">{team.teamName}</span>
                            <span className="mono text-[7px] text-[#7c847c]">{numberFormat.format(team.actionsPerMatch)} actions</span>
                          </div>
                          <div className="flex h-1.5 overflow-hidden rounded-full bg-[#efeee7]" aria-label={`${team.teamName} action composition`}>
                            <span className="bg-[#77977b]" style={{ width: `${(team.passesPerMatch / Math.max(1, team.actionsPerMatch)) * 100}%` }} />
                            <span className="bg-[#d4a266]" style={{ width: `${(team.carriesPerMatch / Math.max(1, team.actionsPerMatch)) * 100}%` }} />
                            <span className="bg-[#cf8268]" style={{ width: `${(team.shotsPerMatch / Math.max(1, team.actionsPerMatch)) * 100}%` }} />
                          </div>
                          <p className="mono mt-1.5 text-[7px] text-[#858982]">Pass {metricValue(team.passesPerMatch)} · carry {metricValue(team.carriesPerMatch)} · shot {metricValue(team.shotsPerMatch)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-[9px] text-[#858982]">Possession summary is not available in this response.</div>
                )}
              </section>
              <section className="rounded-xl border border-[#e2e2d8] bg-white p-3" aria-labelledby="outcome-summary-title">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="mono text-[7px] uppercase tracking-[.13em] text-[#9b7160]">Monte Carlo / outcome</p>
                    <h3 id="outcome-summary-title" className="mt-1 text-[10px] font-extrabold text-[#40534b]">Result distribution</h3>
                  </div>
                  <Target size={14} className="text-[#79927c]" />
                </div>
                <div className="mt-3 space-y-2">
                  {outcomeRows.map((outcome) => (
                    <div key={outcome.label} className="rounded-lg bg-[#f7f7f1] px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[8px] font-extrabold text-[#788078]">{outcome.label}</span>
                        <span className={`mono text-[12px] font-semibold ${outcome.tone}`}>{probability(outcome.value)}</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#e8e7df]"><div className="h-full rounded-full bg-[#79947d]" style={{ width: `${Math.min(100, outcome.value * 100)}%` }} /></div>
                      <p className="mono mt-1 text-[7px] text-[#92948b]">{outcome.count.toLocaleString()} of {result.iterations.toLocaleString()} runs</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-[#ecebe3] pt-2.5">
                  <p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#858982]">Frequent scorelines</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {result.topScorelines.map((score) => (
                      <span key={`${score.homeGoals}-${score.awayGoals}`} className="mono rounded-md bg-[#f2f3ec] px-2 py-1 text-[7px] font-bold text-[#506357]">
                        {score.homeGoals}–{score.awayGoals} · {probability(score.probability)}
                      </span>
                    ))}
                    {!result.topScorelines.length && <span className="text-[8px] text-[#858982]">No scorelines reported.</span>}
                  </div>
                </div>
              </section>
            </div>

            <section className="rounded-xl border border-[#e2e2d8] bg-white p-3" aria-labelledby="simulation-diagnostics-title" data-testid="fair-ai-simulation-diagnostics">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="mono text-[7px] uppercase tracking-[.13em] text-[#9b7160]">Run integrity / counters</p>
                  <h3 id="simulation-diagnostics-title" className="mt-1 text-[10px] font-extrabold text-[#40534b]">Simulation diagnostics</h3>
                </div>
                <span className="mono text-[7px] text-[#858982]">{result.iterations.toLocaleString()} simulated matches</span>
              </div>
              {result.diagnostics.shots === 0 && (
                <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-2 text-[8px] leading-4 text-[#784b3e]" role="alert">
                  <CircleAlert size={12} className="mt-0.5 shrink-0" />
                  No shots were generated. Treat the result distribution as invalid.
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Possessions', result.diagnostics.possessions],
                  ['Actions', result.diagnostics.actions],
                  ['Dangerous-area entries', result.diagnostics.dangerousAreaEntries],
                  ['Turnovers', result.diagnostics.turnovers],
                  ['Shots', result.diagnostics.shots],
                  ['On target', result.diagnostics.shotsOnTarget],
                  ['Goals', result.diagnostics.goals],
                ].map(([label, count]) => (
                  <div key={label} className="rounded-lg bg-[#f7f7f1] px-2.5 py-2">
                    <p className="text-[7px] font-bold text-[#81877e]">{label}</p>
                    <p className="mono mt-1 text-[10px] font-semibold text-[#4d6555]">{numberFormat.format(Number(count))}</p>
                  </div>
                ))}
              </div>
              <p className="mono mt-2 text-[7px] leading-4 text-[#858982]">
                Terminal states: {numberFormat.format(result.diagnostics.terminalStates.goals)} goals · {numberFormat.format(result.diagnostics.terminalStates.shots)} non-goal shots · {numberFormat.format(result.diagnostics.terminalStates.turnovers)} turnovers · {numberFormat.format(result.diagnostics.terminalStates.retained)} retained
              </p>
            </section>

            {model && (
              <section className="overflow-hidden rounded-xl border border-[#d6e0d4] bg-[#f2f6ee]" aria-labelledby="pitch-grid-title">
                <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#dfe7db] px-3 py-3">
                  <div>
                    <p className="mono text-[7px] uppercase tracking-[.13em] text-[#9b7160]">Spatial proxy / aggregate activity</p>
                    <h3 id="pitch-grid-title" className="mt-1 text-[11px] font-extrabold text-[#40534b]">Model-generated pitch grid</h3>
                  </div>
                  <span className="text-[7px] text-[#7f897d]">Heat indicates simulated touches · {model.coordinateBasis}</span>
                </div>
                <div className="grid gap-4 p-3 md:grid-cols-2">
                  <PitchGrid team={model.home} columns={model.gridColumns} rows={model.gridRows} accent="#5b8666" title={model.home.teamName} />
                  <PitchGrid team={model.away} columns={model.gridColumns} rows={model.gridRows} accent="#c7785d" title={model.away.teamName} />
                </div>
                <div className="grid gap-2 border-t border-[#dfe7db] px-3 py-2.5 sm:grid-cols-2">
                  {possessionTeams.map((team) => (
                    <div key={team.teamKey} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[8px]">
                      <span className="truncate font-extrabold text-[#52615e]">{team.teamName}</span>
                      <span className="mono text-[#718172]">{metricValue(team.expectedGoalsPerMatch, 2)} xG · proxy EVA/90 {team.estimatedValueAddedPer90 >= 0 ? '+' : ''}{metricValue(team.estimatedValueAddedPer90, 3)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(260px,.8fr)]" aria-labelledby="possession-examples-title">
              <div className="overflow-hidden rounded-xl border border-[#e2e2d8] bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e9e7df] bg-[#f5f4ed] px-3 py-3">
                  <div>
                    <p className="mono text-[7px] uppercase tracking-[.13em] text-[#9b7160]">Up to four / sampled sequences</p>
                    <h3 id="possession-examples-title" className="mt-1 text-[10px] font-extrabold text-[#40534b]">Possession-by-possession examples</h3>
                  </div>
                  <span className="text-[7px] text-[#858982]">Select a sequence to inspect its actions</span>
                </div>
                {samples.length ? (
                  <div className="grid gap-3 p-3 lg:grid-cols-[minmax(180px,.65fr)_minmax(0,1.35fr)]">
                    <div className="space-y-1.5">
                      {samples.map((possession, index) => (
                        <SampledPossession key={`${possession.possessionNumber}-${possession.minute}`} possession={possession} active={index === selectedPossession} onSelect={() => setSelectedPossession(index)} />
                      ))}
                    </div>
                    {activeSample ? (
                      <div className="min-w-0 rounded-xl border border-[#e7e6dd] bg-[#fafaf6] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-[9px] font-extrabold text-[#4d5f58]">{activeSample.teamName} possession</p>
                            <p className="mono mt-1 text-[7px] text-[#858982]">Sequence {activeSample.possessionNumber} · {activeSample.minute}&apos; · {activeSample.outcome.replace('_', ' ')}</p>
                          </div>
                          <span className="mono rounded-md bg-[#eaf1e9] px-2 py-1 text-[8px] font-bold text-[#567d69]">EVA-style proxy {activeSample.estimatedValueAdded >= 0 ? '+' : ''}{metricValue(activeSample.estimatedValueAdded, 3)}</span>
                        </div>
                        <div className="mt-3 overflow-x-auto">
                          <svg viewBox="0 0 100 64" className="min-w-[300px] w-full rounded-lg border border-[#cdd9cc] bg-[#e9f0e5]" role="img" aria-label={`Simulated actions in possession ${activeSample.possessionNumber}`}>
                            <rect x="1" y="1" width="98" height="62" fill="none" stroke="#a9bba9" strokeWidth=".6" />
                            <line x1="50" y1="1" x2="50" y2="63" stroke="#a9bba9" strokeWidth=".5" />
                            <circle cx="50" cy="32" r="8" fill="none" stroke="#a9bba9" strokeWidth=".5" />
                            <rect x="1" y="19" width="13" height="26" fill="none" stroke="#a9bba9" strokeWidth=".5" />
                            <rect x="86" y="19" width="13" height="26" fill="none" stroke="#a9bba9" strokeWidth=".5" />
                            {activeSample.actions.map((action, index) => {
                              const startX = Math.max(0, Math.min(100, action.startX));
                              const startY = Math.max(0, Math.min(100, action.startY)) * 0.64;
                              const endX = Math.max(0, Math.min(100, action.endX));
                              const endY = Math.max(0, Math.min(100, action.endY)) * 0.64;
                              const bad = action.outcome === 'intercepted' || action.outcome === 'out_of_play' || action.outcome === 'blocked' || action.outcome === 'missed';
                              const color = action.action === 'shot' ? '#c7785d' : bad ? '#a35f4d' : '#5b8666';
                              return (
                                <g key={`${action.minute}-${index}`}>
                                  <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={color} strokeWidth="1.1" strokeDasharray={action.action === 'carry' ? '2 1' : undefined} markerEnd="url(#action-arrow)" />
                                  <circle cx={startX} cy={startY} r="1.35" fill="#f9faf4" stroke={color} strokeWidth=".8" />
                                  <circle cx={endX} cy={endY} r="1.5" fill={color} />
                                </g>
                              );
                            })}
                            <defs><marker id="action-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5" fill="none" stroke="#6f8b72" strokeWidth="1" /></marker></defs>
                          </svg>
                        </div>
                        <div className="mt-3 divide-y divide-[#e9e8e0]">
                          {activeSample.actions.map((action, index) => (
                            <div key={`${action.minute}-${index}`} className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 py-2">
                              <span className="mono text-[7px] text-[#92948b]">{action.minute}&apos;</span>
                              <div className="min-w-0">
                                <p className="truncate text-[8px] font-bold text-[#52615e]">{action.actorName}{action.targetName ? <span className="font-normal text-[#848a80]"> → {action.targetName}</span> : ''}</p>
                                <p className="mt-0.5 text-[7px] capitalize text-[#858982]">{action.action} · {action.outcome.replace('_', ' ')}</p>
                              </div>
                              <span className={`mono text-[7px] font-bold ${action.estimatedValueAdded >= 0 ? 'text-[#567d69]' : 'text-[#a35f4d]'}`}>{action.estimatedValueAdded >= 0 ? '+' : ''}{metricValue(action.estimatedValueAdded, 3)}</span>
                            </div>
                          ))}
                          {!activeSample.actions.length && <p className="py-3 text-[8px] text-[#858982]">No action detail was sampled for this possession.</p>}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid min-h-[110px] place-items-center px-4 text-center text-[9px] text-[#858982]">No sample possessions were returned for this run.</div>
                )}
              </div>
              <section className="rounded-xl border border-[#e2e2d8] bg-white p-3" aria-labelledby="sampled-outcomes-title">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="mono text-[7px] uppercase tracking-[.13em] text-[#9b7160]">Action value / selected sample</p>
                    <h3 id="sampled-outcomes-title" className="mt-1 text-[10px] font-extrabold text-[#40534b]">Decision trace</h3>
                  </div>
                  <CornerDownRight size={14} className="text-[#79927c]" />
                </div>
                {activeSample ? (
                  <div className="mt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-[#f7f7f1] p-2.5"><p className="text-[7px] text-[#858982]">Actions</p><p className="mono mt-1 text-[14px] font-semibold text-[#4d6555]">{activeSample.actions.length}</p></div>
                      <div className="rounded-lg bg-[#f7f7f1] p-2.5"><p className="text-[7px] text-[#858982]">Net EVA-style proxy</p><p className="mono mt-1 text-[14px] font-semibold text-[#4d6555]">{activeSample.estimatedValueAdded >= 0 ? '+' : ''}{metricValue(activeSample.estimatedValueAdded, 3)}</p></div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {activeSample.actions.map((action, index) => (
                        <div key={`${action.minute}-${index}-value`} className="flex items-center gap-2">
                          <span className={`grid size-6 shrink-0 place-items-center rounded-md ${action.action === 'shot' ? 'bg-[#f8e9e1] text-[#a35f4d]' : action.action === 'carry' ? 'bg-[#f7f0df] text-[#927447]' : 'bg-[#eaf1e9] text-[#557b63]'}`}>
                            {action.action === 'shot' ? <Crosshair size={11} /> : action.action === 'carry' ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex justify-between gap-1 text-[7px]"><span className="truncate font-bold capitalize text-[#59675f]">{action.action} · {action.actorName}</span><span className="mono text-[#92948b]">{metricValue(action.valueBefore, 3)} → {metricValue(action.valueAfter, 3)}</span></div>
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#eeede6]"><div className={`h-full rounded-full ${action.estimatedValueAdded >= 0 ? 'bg-[#77977b]' : 'bg-[#cf8268]'}`} style={{ width: `${Math.min(100, Math.abs(action.estimatedValueAdded) * 100)}%` }} /></div>
                          </div>
                          <span className={`mono w-12 shrink-0 text-right text-[7px] font-bold ${action.estimatedValueAdded >= 0 ? 'text-[#567d69]' : 'text-[#a35f4d]'}`}>{action.estimatedValueAdded >= 0 ? '+' : ''}{metricValue(action.estimatedValueAdded, 3)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-[#deddd3] p-4 text-center text-[8px] text-[#858982]">Choose a returned possession sample to inspect its decision trace.</div>
                )}
              </section>
            </section>

            <section className="overflow-hidden rounded-xl border border-[#e2e2d8] bg-white" aria-labelledby="player-profile-title">
              <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#e9e7df] bg-[#f5f4ed] px-3 py-3">
                <div>
                  <p className="mono text-[7px] uppercase tracking-[.13em] text-[#9b7160]">Roster evidence / rates per 90 where applicable</p>
                  <h3 id="player-profile-title" className="mt-1 text-[10px] font-extrabold text-[#40534b]">Player decision &amp; action profiles</h3>
                </div>
                <span className="text-[7px] text-[#858982]">Recent archive profiles, not live player tracking</span>
              </div>
              <div className="grid gap-3 p-3 xl:grid-cols-2">
                {teams.map((team, teamIndex) => {
                  const players = team.players ?? [];
                  return (
                    <div key={team.teamKey} className="min-w-0 overflow-hidden rounded-lg border border-[#e8e7df]">
                      <div className="flex items-center justify-between gap-2 bg-[#fafaf6] px-3 py-2">
                        <span className="truncate text-[9px] font-extrabold text-[#4d5f58]">{team.name}</span>
                        <span className="mono text-[7px] text-[#92948b]">{players.length} profiles · {team.formation ?? 'formation n/a'}</span>
                      </div>
                      {players.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[680px] text-left" aria-label={`${team.name} player action profiles`}>
                            <thead className="border-y border-[#ecebe3] text-[7px] uppercase tracking-[.06em] text-[#8a8d83]">
                              <tr>
                                <th className="px-2.5 py-2">Player</th><th className="px-2 py-2">Apps / rated / min</th><th className="px-2 py-2">Rating</th><th className="px-2 py-2">Pass</th><th className="px-2 py-2">Shot rate / acc.</th><th className="px-2 py-2">xG · G · A /90</th><th className="px-2 py-2">Duels / tackles + int.</th><th className="px-2 py-2">Saves /90</th>
                              </tr>
                            </thead>
                            <tbody>
                              {players.slice(0, 22).map((player) => (
                                <tr key={player.playerKey} className="border-b border-[#efeee7] last:border-0">
                                  <th scope="row" className="max-w-[140px] px-2.5 py-2 text-left">
                                    <span className="block truncate text-[8px] font-bold text-[#52615e]">{player.name}</span>
                                    <span className="mt-0.5 block truncate text-[7px] font-normal text-[#92948b]">{player.position ?? 'Position n/a'} · {player.starter ? 'starter' : 'rotation'}</span>
                                    {player.shirtNumber !== null || player.age !== null || player.height || player.weight || player.nationality || player.preferredFoot || player.marketValue || player.contractUntil ? (
                                      <span className="mt-0.5 block truncate text-[6px] font-normal text-[#a0a198]">
                                        {[
                                          player.shirtNumber === null ? null : `#${player.shirtNumber}`,
                                          player.age === null ? null : `${player.age} yrs`,
                                          player.height,
                                          player.weight,
                                          player.nationality,
                                          player.preferredFoot,
                                          player.marketValue,
                                          player.contractUntil,
                                        ].filter(Boolean).join(' · ')}
                                      </span>
                                    ) : null}
                                  </th>
                                   <td className="mono px-2 py-2 text-[7px] text-[#6e7b72]">{player.appearances} / {player.ratedAppearances} / {numberFormat.format(player.minutesPlayed)}</td>
                                  <td className="mono px-2 py-2 text-[7px] text-[#6e7b72]">{metricValue(player.averageRating, 2)}</td>
                                  <td className="mono px-2 py-2 text-[7px] text-[#6e7b72]">{pct(player.passCompletionPct)}</td>
                                  <td className="mono px-2 py-2 text-[7px] text-[#6e7b72]">{metricValue(player.shotsPer90, 2)} / {pct(player.shotAccuracyPct)}</td>
                                  <td className="mono px-2 py-2 text-[7px] text-[#6e7b72]">{metricValue(player.expectedGoalsPer90, 2)} · {metricValue(player.goalsPer90, 2)} · {metricValue(player.assistsPer90, 2)}</td>
                                  <td className="mono px-2 py-2 text-[7px] text-[#6e7b72]">{pct(player.duelsWonPct)} / {metricValue(player.tacklesPer90 + player.interceptionsPer90, 2)}</td>
                                  <td className="mono px-2 py-2 text-[7px] text-[#6e7b72]">{metricValue(player.savesPer90, 2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="px-3 py-4 text-[8px] text-[#858982]">No player profiles were returned for this team.</p>
                      )}
                       <div className="grid grid-cols-4 gap-px border-t border-[#ecebe3] bg-[#ecebe3]">
                        {[
                          ['Clean sheets', team.players?.reduce((sum, player) => sum + player.cleanSheets, 0) ?? 0],
                          ['Goals conceded', team.players?.reduce((sum, player) => sum + player.goalsConceded, 0) ?? 0],
                           ['Saves', team.players?.reduce((sum, player) => sum + player.totalSaves, 0) ?? 0],
                          ['Archive matches', team.matchCount],
                        ].map(([label, value]) => (
                          <div key={String(label)} className="bg-white px-2.5 py-2"><p className="text-[7px] text-[#858982]">{label}</p><p className="mono mt-0.5 text-[8px] font-bold text-[#52615e]">{numberFormat.format(Number(value))}</p></div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-[#e2e2d8] bg-white p-3" aria-labelledby="contributions-title">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="mono text-[7px] uppercase tracking-[.13em] text-[#9b7160]">Simulation ledger / player credits</p>
                  <h3 id="contributions-title" className="mt-1 text-[10px] font-extrabold text-[#40534b]">Player contribution totals</h3>
                </div>
                <span className="mono text-[7px] text-[#92948b]">Across {result.iterations.toLocaleString()} iterations</span>
              </div>
              {result.playerContributions.length ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {result.playerContributions.slice(0, 12).map((player) => {
                    const teamIndex = teams.findIndex((team) => team.name === player.teamName);
                    return (
                      <div key={`${player.teamName}-${player.playerKey}`} className="rounded-lg border border-[#ecebe3] bg-[#fafaf6] px-2.5 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[8px] font-extrabold text-[#52615e]">{player.playerName}</p>
                            <p className="mt-0.5 truncate text-[7px] text-[#858982]">{player.teamName}</p>
                          </div>
                         <span className="mono shrink-0 text-[8px] font-bold text-[#567d69]">{player.estimatedValueAdded >= 0 ? '+' : ''}{metricValue(player.estimatedValueAdded, 2)} EVA-style proxy</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 text-[7px] text-[#79837a]">
                          <span>{player.simulatedGoals.toLocaleString()} G</span><span>{player.simulatedAssists.toLocaleString()} A</span><span>{player.simulatedPasses.toLocaleString()} P</span><span>{player.simulatedCarries.toLocaleString()} C</span><span>{player.simulatedShots.toLocaleString()} S</span><span>{player.simulatedDefensiveActions.toLocaleString()} DA</span>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#eeede6]"><div className={`h-full rounded-full ${teamIndex === 1 ? 'bg-[#cf8268]' : 'bg-[#77977b]'}`} style={{ width: `${Math.min(100, Math.max(0, player.contributionScore * 100))}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-[#deddd3] px-3 py-5 text-center text-[8px] text-[#858982]">No player contribution totals were included in this simulation.</div>
              )}
            </section>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(260px,.8fr)]">
              <section className="rounded-xl border border-[#e2e2d8] bg-white p-3" aria-labelledby="team-inputs-title">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="mono text-[7px] uppercase tracking-[.13em] text-[#9b7160]">Archive context / source statistics</p>
                    <h3 id="team-inputs-title" className="mt-1 text-[10px] font-extrabold text-[#40534b]">Team summaries</h3>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {teams.map((team) => {
                    const stats = team.teamStats;
                    return (
                      <div key={team.teamKey} className="overflow-hidden rounded-lg border border-[#e8e7df]">
                        <div className="flex items-center justify-between gap-2 bg-[#fafaf6] px-2.5 py-2">
                          <span className="truncate text-[8px] font-extrabold text-[#4d5f58]">{team.name}</span>
                          <span className="mono text-[7px] text-[#858982]">{stats?.matchStatSampleCount ?? 0} samples</span>
                        </div>
                        <div className="grid grid-cols-3 gap-px bg-[#ecebe3]">
                          {[
                            ['xG', stats?.expectedGoalsFor],
                            ['xGA', stats?.expectedGoalsAgainst],
                            ['Poss.', stats?.possessionPct, '%'],
                            ['Shots', stats?.shotsPerMatch],
                            ['On target', stats?.shotsOnTargetPerMatch],
                            ['Passes', stats?.passesPerMatch],
                            ['Inside box', stats?.shotsInsideBoxPerMatch],
                            ['Box touches', stats?.boxTouchesPerMatch],
                            ['Big chances', stats?.bigChancesPerMatch],
                            ['Missed big chances', stats?.bigChancesMissedPerMatch],
                            ['Pass acc.', stats?.passCompletionPct, '%'],
                            ['Long ball acc.', stats?.longBallCompletionPct, '%'],
                            ['Final-third pass acc.', stats?.finalThirdPassCompletionPct, '%'],
                            ['Duels won', stats?.duelWinPct, '%'],
                            ['Def. actions', stats?.defensiveActionsPerMatch],
                            ['Recoveries', stats?.recoveriesPerMatch],
                            ['Yellow cards', stats?.yellowCardsPerMatch],
                            ['Red cards', stats?.redCardsPerMatch],
                          ].map(([label, value, suffix]) => (
                            <div key={String(label)} className="bg-white px-2 py-1.5">
                              <p className="text-[6px] font-bold text-[#858982]">{label}</p>
                              <p className="mono mt-0.5 text-[8px] font-semibold text-[#4d6555]">{metricValue(typeof value === 'number' ? value : null)}{suffix && value !== null && value !== undefined ? suffix : ''}</p>
                            </div>
                          ))}
                        </div>
                        <p className="px-2.5 py-2 text-[7px] leading-4 text-[#858982]">
                          {stats?.coachName ?? 'Coach unavailable'} · coach {stats?.coachMatches ?? 0} matches ({stats?.coachWins ?? 0}-{stats?.coachDraws ?? 0}-{stats?.coachLosses ?? 0}, {pct(stats?.coachWinPct)}) · league {stats?.leagueRank ?? '—'} / {stats?.leaguePlayed ?? '—'} played · {stats?.leaguePoints ?? '—'} pts · GD {stats?.goalDifference ?? '—'} · form {stats?.leagueForm ?? '—'}.
                          <br />
                          {team.recentMatchCount} recent matches · {team.avgGoalsFor.toFixed(2)} GF / {team.avgGoalsAgainst.toFixed(2)} GA · {stats?.daysSinceLastMatch == null ? 'last match age unavailable' : `${metricValue(stats.daysSinceLastMatch, 0)} days since last match`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="rounded-xl border border-[#e2e2d8] bg-white p-3" aria-labelledby="method-title">
                <p className="mono text-[7px] uppercase tracking-[.13em] text-[#9b7160]">Method / boundaries</p>
                <h3 id="method-title" className="mt-1 text-[10px] font-extrabold text-[#40534b]">{result.method}</h3>
                <p className="mt-2 text-[8px] leading-4 text-[#777f77]">Expected goals and result probabilities remain match-level estimates. Possession and action details are sampled model outputs; their coordinates and EVA-style numbers are illustrative proxies rather than measured spatial or value data.</p>
                {result.limitations.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-[#ecebe3] pt-2 text-[7px] leading-4 text-[#7c847c]">
                    {result.limitations.map((limitation) => <li key={limitation} className="flex gap-1.5"><span className="mt-1 size-1 shrink-0 rounded-full bg-[#c7a773]" />{limitation}</li>)}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
