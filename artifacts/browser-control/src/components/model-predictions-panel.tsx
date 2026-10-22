import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetFootballMatchModelPredictionsQueryKey,
  getGetFootballModelTrainingDashboardQueryKey,
  getGetFootballTesterMatchModelPredictionsQueryKey,
  useGetFootballMatchModelPredictions,
  useGetFootballModelTrainingDashboard,
  useGetFootballTesterMatchModelPredictions,
  usePredictFootballMatch,
  usePredictFootballTesterMatch,
  type FootballMatchDetails,
  type FootballMatchLastFive,
  type FootballMatchTmpContext,
  type FootballModelPredictionContextInput,
  type FootballModelPrediction,
  type FootballModelType,
} from '@workspace/api-client-react';
import { AlertTriangle, BarChart3, CircleAlert, RefreshCw, Sparkles } from 'lucide-react';

const MODEL_NAMES: Record<FootballModelType, string> = {
  lstm: 'LSTM',
  gru: 'GRU',
  transformer: 'Transformer',
  gnn: 'GNN',
  'dynamic-graph': 'Dynamic Graph',
  catboost: 'CatBoost',
  xgboost: 'XGBoost',
};

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'The model predictions could not be loaded. Try again.';
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ProbabilityBar({
  label,
  probability,
  color,
  testId,
}: {
  label: string;
  probability: number;
  color: string;
  testId: string;
}) {
  const width = Math.max(0, Math.min(100, probability * 100));
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[8px] font-bold text-[#687570]">
        <span>{label}</span><span className="mono text-[#3e554b]">{percent(probability)}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-[#e7e5dc]"
        role="meter"
        aria-label={`${label} probability`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
      >
        <div className="h-full rounded-full transition-[width]" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function PredictionCards({
  predictions,
  compact = false,
}: {
  predictions: FootballModelPrediction[];
  compact?: boolean;
}) {
  const latestByModel = new Map<FootballModelType, FootballModelPrediction>();
  for (const prediction of predictions) {
    const existing = latestByModel.get(prediction.modelType);
    if (
      !existing ||
      Date.parse(String(prediction.createdAt)) >= Date.parse(String(existing.createdAt))
    ) {
      latestByModel.set(prediction.modelType, prediction);
    }
  }
  const latestPredictions = [...latestByModel.values()].sort(
    (first, second) =>
      Object.keys(MODEL_NAMES).indexOf(first.modelType) -
      Object.keys(MODEL_NAMES).indexOf(second.modelType),
  );

  return (
    <div className="space-y-3" data-testid="list-model-predictions">
      {latestPredictions.map((prediction) => (
        <article
          key={prediction.runId}
          className="overflow-hidden rounded-xl border border-[#e0ded5] bg-[#fbfaf6]"
          data-testid={`card-model-prediction-${prediction.modelType}`}
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e6de] bg-[#f4f3ed] px-3 py-2.5">
            <div>
              <h3 className="text-[10px] font-extrabold text-[#344550]">{MODEL_NAMES[prediction.modelType]}</h3>
              <p className="mono mt-0.5 text-[7px] uppercase tracking-[.1em] text-[#899087]">
                {prediction.historyMatchCount} earlier matches · {prediction.verifiedOddsHistoryCount} with verified odds
              </p>
            </div>
            <span className="mono text-[7px] text-[#9b7160]">Run {prediction.runId.slice(0, 8)}</span>
          </header>
          <div className={`grid gap-3 p-3 ${compact ? 'sm:grid-cols-[1fr_1fr]' : 'md:grid-cols-[1fr_1fr]'}`}>
            <section aria-label={`${MODEL_NAMES[prediction.modelType]} match result probabilities`}>
              <p className="mb-2 text-[8px] font-extrabold uppercase tracking-[.1em] text-[#8a8e85]">1X2 · Match result</p>
              <div className="space-y-2">
                <ProbabilityBar label="Home" probability={prediction.result.home} color="#648775" testId={`prediction-home-${prediction.modelType}`} />
                <ProbabilityBar label="Draw" probability={prediction.result.draw} color="#d7a24f" testId={`prediction-draw-${prediction.modelType}`} />
                <ProbabilityBar label="Away" probability={prediction.result.away} color="#d67457" testId={`prediction-away-${prediction.modelType}`} />
              </div>
            </section>
            <section aria-label={`${MODEL_NAMES[prediction.modelType]} goal market probabilities`}>
              <p className="mb-2 text-[8px] font-extrabold uppercase tracking-[.1em] text-[#8a8e85]">Goal markets</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <ProbabilityBar label="BTTS yes" probability={prediction.bothTeamsToScore.yes} color="#648775" testId={`prediction-btts-${prediction.modelType}`} />
                <ProbabilityBar label="Over 2.5" probability={prediction.overUnder25.over} color="#648775" testId={`prediction-over25-${prediction.modelType}`} />
                <ProbabilityBar label="Over 3.5" probability={prediction.overUnder35.over} color="#d67457" testId={`prediction-over35-${prediction.modelType}`} />
                <ProbabilityBar label="BTTS no" probability={prediction.bothTeamsToScore.no} color="#d7a24f" testId={`prediction-btts-no-${prediction.modelType}`} />
              </div>
              <div className="mt-3 border-t border-[#e8e6de] pt-2">
                <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#8a8e85]">Over / under</p>
                <p className="mono mt-1 text-[8px] text-[#5a6962]">
                  2.5: {percent(prediction.overUnder25.over)} / {percent(prediction.overUnder25.under)}
                  <span className="mx-2 text-[#c1bfb4]">·</span>
                  3.5: {percent(prediction.overUnder35.over)} / {percent(prediction.overUnder35.under)}
                </p>
              </div>
            </section>
          </div>
          <div className="border-t border-[#e8e6de] px-3 py-2.5">
            <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#8a8e85]">Correct score · top model probabilities</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {prediction.correctScoreTop.slice(0, 5).map((scoreline) => (
                <span key={scoreline.scoreline} className="mono rounded-md border border-[#e3e1d8] bg-white px-2 py-1 text-[8px] font-bold text-[#4c6358]" data-testid={`prediction-score-${prediction.modelType}-${scoreline.scoreline}`}>
                  {scoreline.scoreline} · {percent(scoreline.probability)}
                </span>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function TesterModelPredictionsPanel({ fixtureId }: { fixtureId: number }) {
  const queryClient = useQueryClient();
  const dashboardQuery = useGetFootballModelTrainingDashboard({
    query: {
      queryKey: getGetFootballModelTrainingDashboardQueryKey(),
      refetchOnMount: 'always',
    },
  });
  const predictionKey = getGetFootballTesterMatchModelPredictionsQueryKey(fixtureId);
  const predictionsQuery = useGetFootballTesterMatchModelPredictions(fixtureId, {
    query: { enabled: Number.isSafeInteger(fixtureId) && fixtureId > 0, queryKey: predictionKey },
  });
  const predict = usePredictFootballTesterMatch();
  const availableModels = new Set(
    (dashboardQuery.data?.runs ?? [])
      .filter((run) => run.status === 'completed' && run.hasPredictionArtifact)
      .map((run) => run.modelType),
  );
  const predictions = predictionsQuery.data?.predictions ?? [];

  return (
    <section className="overflow-hidden rounded-[16px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_10px_34px_rgba(47,59,64,.045)]" aria-labelledby="tester-model-predictions-title" data-testid="panel-tester-model-predictions">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><Sparkles size={16} /></span>
          <div>
            <h2 id="tester-model-predictions-title" className="text-[12px] font-extrabold text-[#344550]">Model predictions</h2>
            <p className="mt-0.5 text-[9px] text-[#858982]">{availableModels.size} prediction-ready architecture{availableModels.size === 1 ? '' : 's'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => predict.mutate({ fixtureId }, {
            onSuccess: (response) => queryClient.setQueryData(predictionKey, response),
          })}
          disabled={predict.isPending || availableModels.size === 0 || dashboardQuery.isLoading}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#668574] px-3.5 text-[9px] font-extrabold text-white transition hover:bg-[#557460] disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-predict-tester-match"
        >
          {predict.isPending ? <RefreshCw size={12} className="animate-spin" /> : <BarChart3 size={12} />}
          {predict.isPending ? 'Predicting…' : 'Predict with all trained models'}
        </button>
      </div>
      <div className="space-y-3 p-3 sm:p-4">
        <p className="text-[8px] leading-4 text-[#81877f]">
          Uses saved pre-match form, standings and league context, plus earlier archive matches for sequence and graph features. Outputs include 1X2, both teams to score, over/under 2.5 and 3.5, and top correct scores. These are experimental estimates.
        </p>
        {dashboardQuery.isError && <p className="rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-3 py-2 text-[9px] text-[#8c6b5e]" role="alert" data-testid="error-prediction-model-list">{errorMessage(dashboardQuery.error)}</p>}
        {!dashboardQuery.isLoading && availableModels.size === 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2.5 text-[9px] leading-4 text-[#84684f]" role="status" data-testid="empty-prediction-models">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>No compatible trained model is ready yet. Train a fresh model on the Model training page; older 1X2-only runs do not contain these prediction outputs.</span>
          </div>
        )}
        {predict.isError && <p className="rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-3 py-2 text-[9px] text-[#8c6b5e]" role="alert" data-testid="error-predict-tester-match">{errorMessage(predict.error)}</p>}
        {predictionsQuery.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-[#eeede6]" role="status" aria-label="Loading saved predictions" />
          : predictionsQuery.isError ? <div className="flex items-center gap-2 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-3 py-2 text-[9px] text-[#8c6b5e]" role="alert" data-testid="error-load-tester-predictions"><CircleAlert size={13} />{errorMessage(predictionsQuery.error)}</div>
            : predictions.length ? <PredictionCards predictions={predictions} />
              : <p className="rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-3 py-3 text-[9px] text-[#858982]" role="status" data-testid="empty-tester-predictions">No prediction has been generated for this fixture yet.</p>}
      </div>
    </section>
  );
}

function modelPredictionContext(
  details: FootballMatchDetails,
  lastFive: FootballMatchLastFive | undefined,
  context: FootballMatchTmpContext | undefined,
): FootballModelPredictionContextInput {
  const compactMatches = (matches: FootballMatchDetails['homeRecent']) =>
    matches.map((match) => ({
      fixtureId: match.fixtureId,
      date: match.date,
      homeTeamName: match.homeTeam.name,
      awayTeamName: match.awayTeam.name,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    }));
  const compactLastFive = (matches: FootballMatchLastFive['home']['matches']) =>
    compactMatches(matches.map((item) => item.match));
  const homeStanding = context?.seasonStandings.find(
    (standing) =>
      standing.teamId === details.match.home.id &&
      standing.leagueId === details.match.leagueId &&
      standing.season === details.match.season,
  );
  const awayStanding = context?.seasonStandings.find(
    (standing) =>
      standing.teamId === details.match.away.id &&
      standing.leagueId === details.match.leagueId &&
      standing.season === details.match.season,
  );
  return {
    matchDate: details.match.date,
    competition: details.match.competition,
    season: details.match.season,
    homeTeamName: details.match.home.name,
    awayTeamName: details.match.away.name,
    leagueAverageGoals: context?.leagueAverageGoals ?? null,
    homeRecent: compactMatches(details.homeRecent),
    awayRecent: compactMatches(details.awayRecent),
    homeLastFive: compactLastFive(lastFive?.home.matches ?? []),
    awayLastFive: compactLastFive(lastFive?.away.matches ?? []),
    homeStanding: homeStanding
      ? {
          rank: homeStanding.rank,
          played: homeStanding.played,
          points: homeStanding.points,
          goalDifference: homeStanding.goalDifference,
        }
      : null,
    awayStanding: awayStanding
      ? {
          rank: awayStanding.rank,
          played: awayStanding.played,
          points: awayStanding.points,
          goalDifference: awayStanding.goalDifference,
        }
      : null,
    standingTeamCount:
      context?.seasonStandings.filter(
        (standing) =>
          standing.leagueId === details.match.leagueId &&
          standing.season === details.match.season,
      ).length ?? 0,
    oddsHistory: (context?.oddsHistory ?? []).map((odds) => ({
      fixtureId: odds.fixtureId,
      homeProbability: odds.homeProbability,
      drawProbability: odds.drawProbability,
      awayProbability: odds.awayProbability,
      verifiedBookmakerCount: odds.verifiedBookmakerCount,
      quoteSource: odds.quoteSource,
    })),
  };
}

export function ModelPredictionGraphs({
  fixtureId,
  details,
  lastFive,
  context,
  contextLoading,
}: {
  fixtureId: number;
  details: FootballMatchDetails;
  lastFive?: FootballMatchLastFive;
  context?: FootballMatchTmpContext;
  contextLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = getGetFootballMatchModelPredictionsQueryKey(fixtureId);
  const query = useGetFootballMatchModelPredictions(fixtureId, {
    query: { enabled: Number.isSafeInteger(fixtureId) && fixtureId > 0, queryKey },
  });
  const dashboardQuery = useGetFootballModelTrainingDashboard({
    query: {
      queryKey: getGetFootballModelTrainingDashboardQueryKey(),
      refetchOnMount: 'always',
    },
  });
  const predict = usePredictFootballMatch();
  const attemptedFixture = useRef<number | null>(null);
  const predictions = query.data?.predictions ?? [];
  const trainedRuns = (dashboardQuery.data?.runs ?? []).filter(
    (run) => run.status === 'completed' && run.hasPredictionArtifact,
  );
  const contextInput = modelPredictionContext(details, lastFive, context);

  useEffect(() => {
    if (
      contextLoading ||
      !context ||
      !lastFive ||
      query.isFetching ||
      dashboardQuery.isLoading ||
      dashboardQuery.isFetching ||
      dashboardQuery.isError ||
      !trainedRuns.length ||
      predict.isPending ||
      attemptedFixture.current === fixtureId
    ) {
      return;
    }
    attemptedFixture.current = fixtureId;
    predict.mutate(
      { fixtureId, data: contextInput },
      { onSuccess: (response) => queryClient.setQueryData(queryKey, response) },
    );
  }, [
    contextLoading,
    contextInput,
    dashboardQuery.isError,
    dashboardQuery.isLoading,
    fixtureId,
    context,
    dashboardQuery.isFetching,
    lastFive,
    predict,
    query.isFetching,
    queryClient,
    queryKey,
    trainedRuns.length,
  ]);

  const generate = () => {
    if (!context || !lastFive || contextLoading) return;
    attemptedFixture.current = fixtureId;
    predict.mutate(
      { fixtureId, data: contextInput },
      { onSuccess: (response) => queryClient.setQueryData(queryKey, response) },
    );
  };

  return (
    <section className="overflow-hidden rounded-[16px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_10px_34px_rgba(47,59,64,.045)]" aria-labelledby="model-prediction-graph-title" data-testid="panel-model-prediction-graphs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]"><BarChart3 size={16} /></span>
          <div>
            <h2 id="model-prediction-graph-title" className="text-[12px] font-extrabold text-[#344550]">Model predictions</h2>
            <p className="mt-0.5 text-[9px] text-[#858982]">Forecasts from loaded match details, recent form, standings, and TMP context</p>
          </div>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={contextLoading || !context || !lastFive || predict.isPending || trainedRuns.length === 0}
          className="inline-flex min-h-8 items-center gap-2 rounded-lg bg-[#668574] px-3 text-[8px] font-extrabold text-white transition hover:bg-[#557460] disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-generate-graph-predictions"
        >
          {predict.isPending ? <RefreshCw size={11} className="animate-spin" /> : <BarChart3 size={11} />}
          {predict.isPending ? 'Predicting…' : 'Refresh predictions'}
        </button>
      </div>
      <div className="p-3 sm:p-4">
        {contextLoading || query.isLoading || dashboardQuery.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-[#eeede6]" role="status" aria-label="Loading model prediction graph" />
          : query.isError ? <p className="flex items-center gap-2 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-3 py-3 text-[9px] text-[#8c6b5e]" role="alert" data-testid="error-model-prediction-graph"><CircleAlert size={13} />{errorMessage(query.error)}</p>
            : predict.isError ? <p className="flex items-center gap-2 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-3 py-3 text-[9px] text-[#8c6b5e]" role="alert" data-testid="error-predict-model-graph"><CircleAlert size={13} />{errorMessage(predict.error)}</p>
              : predictions.length ? <PredictionCards predictions={predictions} compact />
                : !trainedRuns.length ? <div className="rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-4 py-4 text-[9px] leading-5 text-[#858982]" role="status" data-testid="empty-model-prediction-graph">
                  There are no prediction-ready models in the archive. <Link href="/model-training" className="font-extrabold text-[#557460] underline" data-testid="link-train-from-graph">Train a model</Link>; once it finishes, this graph will score the current match using its loaded context.
                </div>
                : !context || !lastFive ? <div className="rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-4 py-4 text-[9px] leading-5 text-[#858982]" role="status" data-testid="empty-model-prediction-graph">
                  Current match context is incomplete. Load the match’s pre-match form and league context to generate forecasts.
                </div>
                  : <div className="rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-4 py-4 text-[9px] leading-5 text-[#858982]" role="status" data-testid="empty-model-prediction-graph">
                    {predict.isPending ? 'Generating forecasts from the loaded match context…' : 'Predictions will appear here as soon as the trained models finish scoring this fixture.'}
                  </div>}
      </div>
    </section>
  );
}
