import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import FairAiReadinessTab from '@/components/fair-ai-readiness-tab';
import ModelPredictionsTab from '@/components/model-predictions-tab';
import {
  getGetFootballModelTrainingDashboardQueryKey,
  getGetFootballModelTrainingRunQueryKey,
  useGetFootballModelTrainingDashboard,
  useGetFootballModelTrainingRun,
  useStartFootballModelTraining,
  type FootballModelTrainingRun,
  type FootballModelType,
} from '@workspace/api-client-react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CircleAlert,
  Database,
  CalendarDays,
  Clock3,
  GitBranch,
  Layers3,
  Network,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Trophy,
  Waves,
} from 'lucide-react';

const MODELS: Array<{
  id: FootballModelType;
  name: string;
  method: string;
  detail: string;
  icon: typeof Activity;
}> = [
  { id: 'lstm', name: 'LSTM', method: 'Sequential form', detail: 'Carries longer patterns across a team’s recent results.', icon: Waves },
  { id: 'gru', name: 'GRU', method: 'Sequential form', detail: 'A compact recurrent read on recent match sequences.', icon: Activity },
  { id: 'transformer', name: 'Transformer', method: 'Temporal attention', detail: 'Weights earlier and later signals by relevance.', icon: ScanLine },
  { id: 'gnn', name: 'GNN', method: 'Team relationships', detail: 'Learns links between teams and shared fixtures.', icon: Network },
  { id: 'dynamic-graph', name: 'Dynamic Graph', method: 'Chronological graph', detail: 'Tracks relationships as they change over time.', icon: GitBranch },
  { id: 'catboost', name: 'CatBoost', method: 'Boosted decision trees', detail: 'Learns nonlinear patterns from the shared sequence, league-context, and graph feature vector.', icon: Layers3 },
  { id: 'xgboost', name: 'XGBoost', method: 'Gradient-boosted trees', detail: 'Builds an independent tree ensemble over the same time-ordered match features as CatBoost.', icon: Network },
];

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'The training service could not be reached. Try again.';
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function metric(value: number | null | undefined, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function statusStyle(status: FootballModelTrainingRun['status']) {
  if (status === 'completed') return 'border-[#c8d9ca] bg-[#e7efe7] text-[#4e755c]';
  if (status === 'failed') return 'border-[#e7c9bc] bg-[#f8e9e1] text-[#a85d48]';
  if (status === 'training') return 'border-[#cbd9d3] bg-[#e7efeb] text-[#4e7868]';
  return 'border-[#e5dcc6] bg-[#f7f0df] text-[#937647]';
}

function LossChart({ run }: { run: FootballModelTrainingRun }) {
  const points = run.trainingLoss.map((training, index) => ({
    index,
    training,
    validation: run.validationLoss[index],
  }));
  const all = points.flatMap((point) => [point.training, point.validation].filter((value): value is number => Number.isFinite(value)));
  if (!points.length || !all.length) {
    return <div className="grid min-h-[145px] place-items-center rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-4 text-center text-[10px] leading-5 text-[#858982]">Loss curves will appear as epochs are recorded.</div>;
  }
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const width = 560;
  const height = 140;
  const coords = (values: number[]) => values.map((value, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - 12 - ((value - min) / range) * (height - 24);
    return `${x},${y}`;
  }).join(' ');
  const training = points.map((point) => point.training).filter(Number.isFinite);
  const validation = points.map((point) => point.validation).filter((value): value is number => Number.isFinite(value));
  return (
    <div className="rounded-lg border border-[#e6e5dc] bg-[#f8f8f2] p-3">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-2 text-[9px] font-bold text-[#727973]">
        <span className="inline-flex items-center gap-1.5"><i className="h-[2px] w-4 bg-[#567d69]" /> Training loss</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-[2px] w-4 bg-[#d96f51]" /> Validation loss</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[138px] w-full overflow-visible" role="img" aria-label="Training and validation loss by epoch">
        {[0, 1, 2, 3].map((line) => <line key={line} x1="0" x2={width} y1={12 + line * 38} y2={12 + line * 38} stroke="#e6e5dc" strokeDasharray="3 5" />)}
        {training.length > 1 && <polyline points={coords(training)} fill="none" stroke="#567d69" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {validation.length > 1 && <polyline points={coords(validation)} fill="none" stroke="#d96f51" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
      </svg>
      <div className="mono flex justify-between text-[8px] text-[#92948b]"><span>Epoch 1</span><span>Epoch {run.completedEpochs || run.epochs}</span></div>
    </div>
  );
}

function ConfusionMatrix({ matrix }: { matrix: number[][] }) {
  const labels = ['Home', 'Draw', 'Away'];
  const rows = matrix.slice(0, 3);
  if (!rows.length || rows.every((row) => !row.length)) {
    return <div className="grid min-h-[118px] place-items-center rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-4 text-center text-[10px] text-[#858982]">Confusion matrix is not available yet.</div>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[#e6e5dc]">
      <table className="w-full min-w-[310px] text-center text-[9px]" aria-label="Confusion matrix, actual outcomes by predicted outcomes">
        <thead className="bg-[#f2f1ea] text-[#858982]">
          <tr><th className="px-2 py-2 text-left font-bold">Actual ↓ / Predicted →</th>{labels.map((label) => <th key={label} className="px-2 py-2 font-extrabold">{label}</th>)}</tr>
        </thead>
        <tbody>{rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-t border-[#ebe9e1]">
            <th scope="row" className="bg-[#f7f6f0] px-3 py-2 text-left font-extrabold text-[#65716b]">{labels[rowIndex]}</th>
            {labels.map((label, columnIndex) => {
              const value = row[columnIndex];
              const diagonal = rowIndex === columnIndex;
              return <td key={label} className={`mono px-2 py-2.5 ${diagonal ? 'bg-[#e9f0e8] font-bold text-[#4e755c]' : 'text-[#66716d]'}`}>{value ?? '—'}</td>;
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function ModelTrainingPage() {
  const client = useQueryClient();
  const [activeTab, setActiveTab] = useState<'training' | 'predictions' | 'fair-ai'>('training');
  const dashboardQuery = useGetFootballModelTrainingDashboard({
    query: { queryKey: getGetFootballModelTrainingDashboardQueryKey() },
  });
  const startTraining = useStartFootballModelTraining();
  const dashboard = dashboardQuery.data;
  const [modelType, setModelType] = useState<FootballModelType>('lstm');
  const [epochs, setEpochs] = useState(30);
  const [sequenceLength, setSequenceLength] = useState(5);
  const [hiddenUnits, setHiddenUnits] = useState(32);
  const [activeRunId, setActiveRunId] = useState('');
  const runId = activeRunId || dashboard?.runs[0]?.id || '';
  const runQuery = useGetFootballModelTrainingRun(runId, {
    query: {
      enabled: Boolean(runId),
      queryKey: getGetFootballModelTrainingRunQueryKey(runId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'completed' || status === 'failed' ? false : 1400;
      },
    },
  });
  const run = runQuery.data;
  const canTrain = (dashboard?.matchCount ?? 0) >= 30;
  const boostedTreeModel = modelType === 'catboost' || modelType === 'xgboost';
  const activeTraining = dashboard?.runs.find(
    (item) => item.status === 'queued' || item.status === 'training',
  );
  const progress = run && run.epochs > 0 ? Math.min(100, (run.completedEpochs / run.epochs) * 100) : 0;
  const verifiedOdds = dashboard?.verifiedOddsFixtureCount ?? 0;
  const missingOdds = dashboard ? Math.max(0, dashboard.matchCount - verifiedOdds) : 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canTrain || activeTraining || startTraining.isPending) return;
    startTraining.mutate({ data: { modelType, epochs, sequenceLength, hiddenUnits: boostedTreeModel ? 16 : hiddenUnits } }, {
      onSuccess: (created) => {
        setActiveRunId(created.id);
        client.setQueryData(getGetFootballModelTrainingRunQueryKey(created.id), created);
        void client.invalidateQueries({ queryKey: getGetFootballModelTrainingDashboardQueryKey() });
      },
    });
  };

  return (
    <main className="screen-noise min-h-[100dvh] bg-[#f2f0e8] text-[#243443]">
      <header className="border-b border-[#d9d8cf] bg-[#f7f5ef]">
        <div className="mx-auto flex min-h-[68px] max-w-[1380px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7 lg:px-10">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand-home">
            <span className="grid size-10 place-items-center rounded-[13px] bg-[#253746] text-[#f8f2e7]"><Trophy size={18} /></span>
            <span><strong className="block text-[14px] tracking-[-.04em] text-[#2b3e49]">Browser Control</strong><span className="text-[10px] text-[#858780]">Football research archive</span></span>
          </Link>
          <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-1 rounded-xl border border-[#deddd3] bg-[#efeee7] p-1">
            <Link href="/fixtures" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]" data-testid="link-fixtures"><CalendarDays size={13} /> Fixtures</Link>
            <Link href="/processing" className="inline-flex h-8 items-center rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]" data-testid="link-processing">Processing</Link>
            <Link href="/database" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] hover:bg-[#fbfaf6]" data-testid="link-database"><Database size={13} /> Database</Link>
            <Link href="/model-training" aria-current="page" className="inline-flex h-8 items-center rounded-lg bg-[#253746] px-3 text-[10px] font-extrabold text-[#f8f2e7]" data-testid="link-model-training">Model training</Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-[1380px] px-4 pb-12 pt-7 sm:px-7 sm:pt-10 lg:px-10">
        <header className="animate-rise mb-7 flex flex-col justify-between gap-5 border-b border-[#d9d8cf] pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="mono mb-2 text-[9px] uppercase tracking-[.2em] text-[#9b7160]">Research bench / model lab</p>
            <h1 className="max-w-[720px] text-[34px] font-extrabold leading-[1.02] tracking-[-.065em] text-[#263746] sm:text-[48px]">Train on the <span className="text-[#d96f51]">record.</span></h1>
            <p className="mt-3 max-w-[600px] text-[12px] leading-6 text-[#727973]">Train on completed archive matches. New runs learn 1X2, BTTS, over/under 2.5 and 3.5, and correct-score markets, with each target evaluated in time order.</p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-lg border border-[#dcd9d0] bg-[#faf9f5] px-3 py-2 sm:self-auto">
            <span className="grid size-7 place-items-center rounded-lg bg-[#e6eee8] text-[#537867]"><ShieldCheck size={15} /></span>
            <span><span className="block text-[9px] font-extrabold uppercase tracking-[.12em] text-[#52615e]">Chronological holdout</span><span className="mono mt-0.5 block text-[8px] text-[#92948b]">LEAKAGE-AWARE · EXPERIMENTAL</span></span>
          </div>
        </header>

        <div
          className="mb-5 inline-flex rounded-xl border border-[#deddd3] bg-[#efeee7] p-1"
          role="tablist"
          aria-label="Model lab views"
          data-testid="tabs-model-lab"
        >
          {([
            { id: 'training', label: 'Training', icon: Activity },
            { id: 'predictions', label: 'Predictions', icon: BarChart3 },
            { id: 'fair-ai', label: 'FAIR AI', icon: Sparkles },
          ] as const).map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`tab-model-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`panel-model-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const tabOrder = ['training', 'predictions', 'fair-ai'] as const;
                    const currentIndex = tabOrder.indexOf(activeTab);
                    const step = event.key === 'ArrowRight' ? 1 : -1;
                    const nextTab = tabOrder[(currentIndex + step + tabOrder.length) % tabOrder.length];
                    setActiveTab(nextTab);
                    document.getElementById(`tab-model-${nextTab}`)?.focus();
                  }
                }}
                className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[9px] font-extrabold transition ${
                  selected
                    ? 'bg-[#253746] text-[#f8f2e7] shadow-sm'
                    : 'text-[#64716d] hover:bg-[#fbfaf6] hover:text-[#344550]'
                }`}
                data-testid={`tab-model-${tab.id}`}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'training' ? (
          <div id="panel-model-training" role="tabpanel" aria-labelledby="tab-model-training">
        <section aria-labelledby="archive-summary-title" className="mb-6 overflow-hidden rounded-[16px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_12px_36px_rgba(47,59,64,.045)]" data-testid="section-training-dataset">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-[#e6eee8] text-[#537867]"><Layers3 size={15} /></span><div><h2 id="archive-summary-title" className="text-[12px] font-extrabold text-[#344550]">Database archive</h2><p className="text-[9px] text-[#858982]">Training source · completed historical matches only</p></div></div>
            {dashboard && <span className="mono rounded-full border border-[#deddd3] bg-[#fbfaf6] px-2.5 py-1 text-[8px] text-[#707b73]">{dateLabel(dashboard.firstMatchDate)} – {dateLabel(dashboard.lastMatchDate)}</span>}
          </div>
          {dashboardQuery.isLoading ? (
            <div className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6" role="status" aria-label="Loading archived dataset summary" data-testid="status-dataset-loading">
              {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="h-[68px] animate-pulse rounded-lg bg-[#eeede6]" />)}
            </div>
          ) : dashboardQuery.isError ? (
            <div className="m-4 flex flex-col items-start gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="status-dataset-error">
              <div className="flex gap-2 text-[10px] leading-5 text-[#784b3e]"><CircleAlert size={15} className="mt-0.5 shrink-0" /><span><strong className="block">Archive summary unavailable.</strong>{errorText(dashboardQuery.error)}</span></div>
              <button type="button" onClick={() => void dashboardQuery.refetch()} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[9px] font-extrabold text-[#855542] hover:bg-[#f6e8df]" data-testid="button-retry-dataset"><RefreshCw size={12} /> Retry</button>
            </div>
          ) : dashboard ? (
            <>
              <div className="grid grid-cols-2 gap-y-4 px-4 py-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-6">
                {[
                  ['Completed matches', dashboard.matchCount.toLocaleString(), 'historical records'],
                  ['Teams', dashboard.teamCount.toLocaleString(), 'distinct archive teams'],
                  ['Home wins', dashboard.outcomeCounts.home.toLocaleString(), 'target outcome'],
                  ['Draws', dashboard.outcomeCounts.draw.toLocaleString(), 'target outcome'],
                  ['Away wins', dashboard.outcomeCounts.away.toLocaleString(), 'target outcome'],
                  ['Verified odds', `${verifiedOdds.toLocaleString()} / ${dashboard.matchCount.toLocaleString()}`, `${dashboard.matchCount ? ((verifiedOdds / dashboard.matchCount) * 100).toFixed(1) : '0.0'}% fixture coverage`],
                ].map(([label, value, note], index) => <div key={label} className={`min-w-0 border-l border-[#e7e5dc] pl-3 ${index === 0 || index === 3 ? 'border-0 pl-0' : ''} sm:border-l sm:pl-3 lg:first:border-l-0 lg:first:pl-0`} data-testid={`metric-archive-${index}`}>
                  <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#8e9187]">{label}</p><p className="mono mt-1 text-[17px] font-medium leading-none tracking-[-.04em] text-[#34494b]">{value}</p><p className="mt-1 text-[8px] text-[#92948b]">{note}</p>
                </div>)}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#e8e6de] px-4 py-3 text-[9px] leading-4 text-[#747c74] sm:px-5">
                <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#567d69]" /> <strong className="text-[#52615e]">{verifiedOdds.toLocaleString()} verified odds</strong> · confirmed historical coverage</span>
                <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full border border-[#c6bca9] bg-[#f2f0e8]" /> <strong className="text-[#52615e]">{missingOdds.toLocaleString()} without verified odds</strong> · coverage gap, not inferred data</span>
              </div>
              {!canTrain && <div className="flex items-start gap-2.5 border-t border-[#ead9c4] bg-[#fbf3e9] px-4 py-3 text-[9px] leading-5 text-[#84684f] sm:px-5" role="status" data-testid="status-insufficient-data"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><p><strong>Not enough completed matches to train.</strong> At least 30 archived matches are required; the archive currently has {dashboard.matchCount}. Save more completed matches in Database, then return here.</p></div>}
            </>
          ) : null}
        </section>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,.93fr)_minmax(0,1.07fr)]">
          <section className="overflow-hidden rounded-[16px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_12px_36px_rgba(47,59,64,.045)]" aria-labelledby="configure-training-title" data-testid="section-configure-training">
            <div className="border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5">
              <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">01 / Configure</p><h2 id="configure-training-title" className="mt-1 text-[15px] font-extrabold text-[#344550]">Choose a model</h2>
            </div>
            <form onSubmit={submit} className="p-4 sm:p-5">
              <fieldset disabled={!canTrain || dashboardQuery.isLoading || dashboardQuery.isError || startTraining.isPending} className="min-w-0 disabled:opacity-60">
                <legend className="sr-only">Model architecture</legend>
                <div className="grid gap-2">
                  {MODELS.map((model) => {
                    const Icon = model.icon;
                    const selected = modelType === model.id;
                    return <label key={model.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${selected ? 'border-[#a9c6b3] bg-[#edf3ed]' : 'border-[#e1dfd7] bg-[#fbfaf6] hover:border-[#c9d4ca]'}`}>
                      <input type="radio" name="model-type" value={model.id} checked={selected} onChange={() => setModelType(model.id)} className="sr-only" data-testid={`input-model-${model.id}`} />
                      <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${selected ? 'bg-[#dce9de] text-[#4d7865]' : 'bg-[#f0efe8] text-[#839087]'}`}><Icon size={15} /></span>
                      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><strong className="text-[10px] font-extrabold text-[#405451]">{model.name}</strong><span className="mono text-[7px] uppercase tracking-[.1em] text-[#9b7160]">{model.method}</span></span><span className="mt-1 block text-[8px] leading-4 text-[#858982]">{model.detail}</span></span>
                      {selected && <Check size={14} className="mt-1 shrink-0 text-[#567d69]" aria-hidden="true" />}
                    </label>;
                  })}
                </div>
              </fieldset>
              <div className={`mt-5 grid grid-cols-1 gap-3 ${boostedTreeModel ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
                <label className="block"><span className="mb-1.5 block text-[9px] font-extrabold text-[#5f6e69]">{boostedTreeModel ? 'Boosting rounds' : 'Epochs'}</span><input type="number" min={5} max={100} step={1} value={epochs} onChange={(event) => setEpochs(Number(event.target.value))} disabled={!canTrain || dashboardQuery.isLoading || dashboardQuery.isError || startTraining.isPending} className="h-10 w-full rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] px-3 text-[11px] font-bold text-[#354750] focus:border-[#d96f51] focus:outline-none disabled:opacity-50" aria-label={boostedTreeModel ? 'Boosting rounds, from 5 to 100' : 'Training epochs, from 5 to 100'} data-testid="input-training-epochs" /><span className="mt-1 block text-[7px] text-[#92948b]">{boostedTreeModel ? '5–100 tree rounds' : '5–100 epochs'}</span></label>
                <label className="block"><span className="mb-1.5 block text-[9px] font-extrabold text-[#5f6e69]">{boostedTreeModel ? 'Feature history length' : 'Sequence length'}</span><input type="number" min={3} max={15} step={1} value={sequenceLength} onChange={(event) => setSequenceLength(Number(event.target.value))} disabled={!canTrain || dashboardQuery.isLoading || dashboardQuery.isError || startTraining.isPending} className="h-10 w-full rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] px-3 text-[11px] font-bold text-[#354750] focus:border-[#d96f51] focus:outline-none disabled:opacity-50" aria-label={boostedTreeModel ? 'Feature history length, from 3 to 15' : 'Sequence length, from 3 to 15'} data-testid="input-sequence-length" /><span className="mt-1 block text-[7px] text-[#92948b]">{boostedTreeModel ? '3–15 recent matches in features' : '3–15 matches'}</span></label>
                {!boostedTreeModel && <label className="block"><span className="mb-1.5 block text-[9px] font-extrabold text-[#5f6e69]">Hidden units</span><input type="number" min={4} max={64} step={1} value={hiddenUnits} onChange={(event) => setHiddenUnits(Number(event.target.value))} disabled={!canTrain || dashboardQuery.isLoading || dashboardQuery.isError || startTraining.isPending} className="h-10 w-full rounded-lg border border-[#d8d7ce] bg-[#fbfaf6] px-3 text-[11px] font-bold text-[#354750] focus:border-[#d96f51] focus:outline-none disabled:opacity-50" aria-label="Hidden units, from 4 to 64" data-testid="input-hidden-units" /><span className="mt-1 block text-[7px] text-[#92948b]">4–64</span></label>}
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#d9e0d6] bg-[#f0f4ed] px-3 py-2.5 text-[8px] leading-[1.65] text-[#6f7e70]"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-[#5d806a]" /><p><strong className="text-[#4f6e5a]">No future peeking.</strong> For each target match, features are restricted to archived information dated before that match. Odds coverage is reported separately; missing odds are not treated as verified.</p></div>
                <button type="submit" disabled={!canTrain || Boolean(activeTraining) || dashboardQuery.isLoading || dashboardQuery.isError || startTraining.isPending} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#d96f51] px-4 text-[10px] font-extrabold text-white shadow-[0_5px_12px_rgba(173,79,52,.13)] transition hover:bg-[#c95f43] disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-start-training">
                  {startTraining.isPending ? <><RefreshCw size={14} className="animate-spin" /> Queueing training</> : activeTraining ? <><Activity size={14} className="animate-pulse" /> A run is in progress</> : <><Sparkles size={14} /> Start training run</>}
              </button>
              {startTraining.isError && <p className="mt-3 flex items-start gap-2 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-3 py-2.5 text-[9px] leading-4 text-[#8c6b5e]" role="alert" data-testid="status-training-start-error"><CircleAlert size={13} className="mt-0.5 shrink-0" />{errorText(startTraining.error)}</p>}
            </form>
          </section>

          <section className="overflow-hidden rounded-[16px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_12px_36px_rgba(47,59,64,.045)]" aria-labelledby="run-monitor-title" data-testid="section-run-monitor">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5">
              <div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-[#e6eee8] text-[#537867]"><BarChart3 size={15} /></span><div><h2 id="run-monitor-title" className="text-[12px] font-extrabold text-[#344550]">Run monitor</h2><p className="text-[9px] text-[#858982]">Live progress · held-out evaluation</p></div></div>
              {run && <span className={`rounded-full border px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.1em] ${statusStyle(run.status)}`} data-testid="status-training-run">{run.status}</span>}
            </div>
            {!runId ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-10 text-center" data-testid="status-run-empty">
                <span className="grid size-12 place-items-center rounded-2xl border border-[#dfe4dc] bg-[#edf2ec] text-[#718879]"><Clock3 size={20} /></span><h3 className="mt-4 text-[14px] font-extrabold text-[#354750]">No training runs yet</h3><p className="mt-2 max-w-[330px] text-[9px] leading-5 text-[#858982]">Choose an architecture and settings to queue a chronological training run. Results will appear here when available.</p>
              </div>
            ) : runQuery.isLoading ? (
              <div className="space-y-4 p-5" role="status" aria-label="Loading training run" data-testid="status-run-loading"><div className="h-3 w-32 animate-pulse rounded bg-[#e6e4dc]" /><div className="h-16 animate-pulse rounded-lg bg-[#eeede6]" /><div className="grid grid-cols-2 gap-3"><div className="h-20 animate-pulse rounded-lg bg-[#eeede6]" /><div className="h-20 animate-pulse rounded-lg bg-[#eeede6]" /></div></div>
            ) : runQuery.isError ? (
              <div className="m-4 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4" role="alert" data-testid="status-run-error"><div className="flex gap-2 text-[10px] font-bold text-[#784b3e]"><CircleAlert size={14} /> Couldn’t load run status</div><p className="mt-2 text-[9px] text-[#8c6b5e]">{errorText(runQuery.error)}</p><button type="button" onClick={() => void runQuery.refetch()} className="mt-3 inline-flex items-center gap-1.5 text-[9px] font-extrabold text-[#855542]" data-testid="button-retry-run"><RefreshCw size={12} /> Retry</button></div>
            ) : run ? (
              <div className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mono text-[8px] uppercase tracking-[.13em] text-[#9b7160]">{MODELS.find((item) => item.id === run.modelType)?.name ?? run.modelType} · RUN / {run.id.slice(0, 10)}</p><p className="mt-1 text-[8px] text-[#92948b]">Started {dateLabel(run.createdAt)} · {run.sampleCount.toLocaleString()} usable samples</p></div><span className="mono text-[8px] text-[#828980]">{run.status === 'completed' || run.status === 'failed' ? 'Finished' : 'Updated'} · {new Date(run.updatedAt).toLocaleTimeString()}</span></div>
                <div className="mt-5 flex items-end justify-between gap-3"><div><span className="mono text-[27px] font-medium leading-none tracking-[-.07em] text-[#2f4a42]" data-testid="text-run-progress">{run.completedEpochs}</span><span className="mono ml-2 text-[10px] text-[#858982]">/ {run.epochs} epochs</span></div><span className="mono text-[10px] font-bold text-[#567d69]">{progress.toFixed(0)}%</span></div>
                <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[#e7e6dd]" role="progressbar" aria-label="Training epoch progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-[#567d69] transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
                {run.status === 'failed' && <p className="mt-3 flex items-start gap-2 rounded-lg border border-[#e7c9bc] bg-[#fff2ed] px-3 py-2.5 text-[9px] leading-4 text-[#9c5949]" role="alert" data-testid="text-run-failure"><CircleAlert size={13} className="mt-0.5 shrink-0" />{run.error || 'This run failed before evaluation completed.'}</p>}
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[['Training loss', metric(run.trainingLoss.at(-1))], ['Validation loss', metric(run.validationLoss.at(-1))], ['Train samples', run.trainingSampleCount.toLocaleString()], ['Holdout samples', run.validationSampleCount.toLocaleString()]].map(([label, value]) => <div key={label} className="rounded-lg border border-[#e3e2d9] bg-[#f5f4ed] px-3 py-2.5"><p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#90938a]">{label}</p><p className="mono mt-1 text-[15px] font-medium text-[#344c43]">{value}</p></div>)}
                </div>
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between"><div><p className="mono text-[8px] uppercase tracking-[.13em] text-[#9b7160]">Optimization trace</p><h3 className="mt-0.5 text-[10px] font-extrabold text-[#42575a]">Loss by epoch</h3></div><span className="mono text-[8px] text-[#92948b]">TRAIN / VALIDATION</span></div>
                  <LossChart run={run} />
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-[.9fr_1.1fr]">
                  <div>
                    <p className="mono text-[8px] uppercase tracking-[.13em] text-[#9b7160]">Held-out set</p><h3 className="mt-0.5 text-[10px] font-extrabold text-[#42575a]">Evaluation metrics</h3>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-[#e3e2d9] bg-[#f5f4ed] p-3"><p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#90938a]">Accuracy</p><p className="mono mt-1 text-[18px] text-[#344c43]" data-testid="text-run-accuracy">{run.accuracy === null ? '—' : `${(run.accuracy * 100).toFixed(1)}%`}</p><p className="mt-1 text-[7px] text-[#92948b]">Majority baseline {run.baselineAccuracy === null ? '—' : `${(run.baselineAccuracy * 100).toFixed(1)}%`}</p></div>
                      <div className="rounded-lg border border-[#e3e2d9] bg-[#f5f4ed] p-3"><p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#90938a]">Log loss</p><p className="mono mt-1 text-[18px] text-[#344c43]">{metric(run.logLoss)}</p><p className="mt-1 text-[7px] text-[#92948b]">Lower is better</p></div>
                      <div className="rounded-lg border border-[#e3e2d9] bg-[#f5f4ed] p-3"><p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#90938a]">Brier score</p><p className="mono mt-1 text-[18px] text-[#344c43]">{metric(run.brierScore)}</p><p className="mt-1 text-[7px] text-[#92948b]">Lower is better</p></div>
                      <div className="rounded-lg border border-[#e3e2d9] bg-[#f5f4ed] p-3"><p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#90938a]">Verified odds</p><p className="mono mt-1 text-[18px] text-[#344c43]">{run.verifiedOddsFixtureCount.toLocaleString()}</p><p className="mt-1 text-[7px] text-[#92948b]">Fixtures with verified coverage</p></div>
                    </div>
                    {run.accuracy !== null && run.baselineAccuracy !== null && <p className={`mt-2 flex items-center gap-1.5 text-[8px] font-bold ${run.accuracy >= run.baselineAccuracy ? 'text-[#537867]' : 'text-[#9b7160]'}`}>{run.accuracy >= run.baselineAccuracy ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{run.accuracy >= run.baselineAccuracy ? 'Above' : 'Below'} majority-class baseline by {Math.abs((run.accuracy - run.baselineAccuracy) * 100).toFixed(1)} percentage points</p>}
                  </div>
                  <div><p className="mono text-[8px] uppercase tracking-[.13em] text-[#9b7160]">Observed vs predicted</p><h3 className="mt-0.5 mb-2 text-[10px] font-extrabold text-[#42575a]">Confusion matrix</h3><ConfusionMatrix matrix={run.confusionMatrix} /></div>
                </div>
                {run.status === 'completed' && <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#e1dfd7] bg-[#f3f2eb] px-3 py-2.5 text-[8px] leading-4 text-[#858982]" role="note" data-testid="status-model-artifacts"><Check size={12} className="mt-0.5 shrink-0 text-[#68836f]" />Evaluation is complete. This interface does not represent saved model weights as deployable artifacts.</div>}
              </div>
            ) : null}
          </section>
        </div>

        <section className="mt-5 overflow-hidden rounded-[16px] border border-[#d6d5cc] bg-[#f9f8f3]" aria-labelledby="recent-runs-title" data-testid="section-recent-runs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-3.5 sm:px-5"><div><p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">02 / History</p><h2 id="recent-runs-title" className="mt-1 text-[12px] font-extrabold text-[#344550]">Recent training runs</h2></div><span className="mono text-[8px] text-[#92948b]">{dashboard?.runs.length ?? 0} saved</span></div>
          {dashboardQuery.isLoading ? <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading recent runs">{[0, 1, 2].map((item) => <div key={item} className="h-[74px] animate-pulse rounded-lg bg-[#eeede6]" />)}</div>
            : dashboardQuery.isError ? <div className="px-4 py-6 text-[9px] text-[#858982]">Recent runs are unavailable while the archive summary cannot be loaded.</div>
              : dashboard?.runs.length ? <div className="grid gap-2 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3">
                {dashboard.runs.map((item) => <button key={item.id} type="button" onClick={() => setActiveRunId(item.id)} aria-pressed={runId === item.id} className={`flex min-w-0 items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${runId === item.id ? 'border-[#b9cbbd] bg-[#edf3ed]' : 'border-[#e3e2d9] bg-[#fbfaf6] hover:border-[#c8d2c8]'}`} data-testid={`button-select-run-${item.id}`}>
                  <span className="flex min-w-0 items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f0efe8] text-[#6f8177]"><Activity size={14} /></span><span className="min-w-0"><span className="block truncate text-[9px] font-extrabold text-[#455951]">{MODELS.find((model) => model.id === item.modelType)?.name ?? item.modelType}</span><span className="mono mt-1 block truncate text-[7px] text-[#92948b]">{dateLabel(item.createdAt)} · {item.completedEpochs}/{item.epochs} epochs</span></span></span>
                  <span className={`shrink-0 rounded-full border px-2 py-1 text-[7px] font-extrabold uppercase tracking-[.08em] ${statusStyle(item.status)}`}>{item.status}</span>
                </button>)}
              </div> : <div className="flex min-h-[120px] items-center gap-3 px-5 py-6" data-testid="status-recent-runs-empty"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#edf2ec] text-[#718879]"><Clock3 size={16} /></span><div><p className="text-[10px] font-extrabold text-[#52615e]">Your run history will collect here.</p><p className="mt-1 text-[8px] leading-4 text-[#858982]">Completed, queued, and failed experiments stay available for review.</p></div></div>}
        </section>

        <footer className="mt-5 flex items-start gap-2 rounded-lg border border-[#e5dcc6] bg-[#f7f0df] px-3.5 py-3 text-[8px] leading-[1.7] text-[#81745e]" role="note" data-testid="notice-experimental-results"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-[#a2814b]" /><p><strong className="text-[#756341]">Research only.</strong> Model outputs are experimental and may be unstable on small or changing datasets. They are not betting advice, and should not be used as a guarantee of match outcomes.</p></footer>
          </div>
        ) : activeTab === 'predictions' ? (
          <div id="panel-model-predictions" role="tabpanel" aria-labelledby="tab-model-predictions">
            <ModelPredictionsTab />
          </div>
        ) : (
          <div id="panel-model-fair-ai" role="tabpanel" aria-labelledby="tab-model-fair-ai">
            <FairAiReadinessTab
              dashboard={dashboard}
              loading={dashboardQuery.isLoading}
              error={dashboardQuery.isError ? errorText(dashboardQuery.error) : null}
              onRetry={() => void dashboardQuery.refetch()}
              onViewPredictions={() => setActiveTab('predictions')}
            />
          </div>
        )}
      </div>
    </main>
  );
}
