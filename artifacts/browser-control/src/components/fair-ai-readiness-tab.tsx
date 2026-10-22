import type { FootballModelTrainingDashboard } from '@workspace/api-client-react';
import FairAiSourceDataPanel from '@/components/fair-ai-source-data-panel';
import {
  AlertTriangle,
  ArrowRight,
  CircleAlert,
  Database,
  Footprints,
  GitBranch,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Target,
} from 'lucide-react';

type FairAiReadinessTabProps = {
  dashboard: FootballModelTrainingDashboard | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onViewPredictions: () => void;
};

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
}

function Status({
  kind,
  children,
}: {
  kind: 'available' | 'partial' | 'missing' | 'unused' | 'not-explicit';
  children: string;
}) {
  const styles = {
    available: 'border-[#c9d9ca] bg-[#eaf1e9] text-[#4e755c]',
    partial: 'border-[#e2d5b9] bg-[#f7f0df] text-[#927447]',
    missing: 'border-[#e5c9bd] bg-[#f8ebe5] text-[#a35f4d]',
    unused: 'border-[#deddd3] bg-[#f1f0e9] text-[#777d76]',
    'not-explicit': 'border-[#d8d7ce] bg-[#f5f4ed] text-[#6f7770]',
  }[kind];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[8px] font-extrabold uppercase tracking-[.08em] ${styles}`}>
      {children}
    </span>
  );
}

function InventoryRow({
  label,
  detail,
  status,
  statusKind,
}: {
  label: string;
  detail: string;
  status: string;
  statusKind: 'available' | 'partial' | 'missing' | 'unused' | 'not-explicit';
}) {
  return (
    <div className="grid gap-2 border-b border-[#e9e7df] px-3 py-3 last:border-0 sm:grid-cols-[minmax(120px,.7fr)_minmax(0,1.5fr)_auto] sm:items-center sm:px-4">
      <p className="text-[9px] font-extrabold text-[#465951]">{label}</p>
      <p className="text-[9px] leading-[1.65] text-[#777f77]">{detail}</p>
      <Status kind={statusKind}>{status}</Status>
    </div>
  );
}

export default function FairAiReadinessTab({
  dashboard,
  loading,
  error,
  onRetry,
  onViewPredictions,
}: FairAiReadinessTabProps) {
  const matchCount = dashboard?.matchCount;
  const oddsCount = dashboard?.verifiedOddsFixtureCount;
  const oddsCoverage =
    matchCount !== undefined && oddsCount !== undefined && matchCount > 0
      ? `${((oddsCount / matchCount) * 100).toFixed(1)}%`
      : null;
  const archiveEmpty = Boolean(dashboard && dashboard.matchCount === 0);
  const oddsStatus =
    oddsCount === undefined || matchCount === undefined
      ? 'Coverage pending'
      : oddsCount === 0
        ? 'No verified odds'
        : oddsCount < matchCount
          ? 'Partial coverage'
          : 'Full coverage';
  const oddsStatusKind =
    oddsCount === undefined || matchCount === undefined || oddsCount === 0 || oddsCount < matchCount
      ? 'partial'
      : 'available';

  return (
    <section
      className="overflow-hidden rounded-[16px] border border-[#d6d5cc] bg-[#f9f8f3] text-[#344550] shadow-[0_12px_36px_rgba(47,59,64,.045)]"
      aria-labelledby="fair-readiness-title"
      data-testid="section-fair-ai-readiness"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f4f3ed] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#e6eee8] text-[#537867]" aria-hidden="true">
            <ShieldCheck size={16} />
          </span>
          <div>
            <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">FAIR AI / readiness</p>
            <h2 id="fair-readiness-title" className="mt-0.5 text-[13px] font-extrabold text-[#344550]">
              Evidence before claims
            </h2>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#deddd3] bg-[#fbfaf6] px-2.5 py-1 text-[8px] font-bold text-[#68756e]">
          <ShieldCheck size={11} aria-hidden="true" />
          Scope and data limitations
        </span>
      </div>

      <div className="p-3 sm:p-5">
        {loading ? (
          <div className="space-y-4" role="status" aria-label="Loading archive readiness">
            <span className="sr-only">Loading the archive summary and coverage.</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-[76px] animate-pulse rounded-xl bg-[#eeede6]" />
              ))}
            </div>
            <div className="h-40 animate-pulse rounded-xl bg-[#eeede6]" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4 sm:flex-row sm:items-center" role="alert" data-testid="status-fair-readiness-error">
            <div className="flex items-start gap-2.5 text-[10px] leading-5 text-[#784b3e]">
              <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span><strong className="block">Archive readiness could not be loaded.</strong>{error}</span>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[9px] font-extrabold text-[#855542] transition hover:bg-[#f6e8df] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d96f51]"
              data-testid="button-retry-fair-readiness"
            >
              <RefreshCw size={12} aria-hidden="true" /> Retry
            </button>
          </div>
        ) : !dashboard ? (
          <div className="rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-4 py-8 text-center" role="status" data-testid="status-fair-readiness-unavailable">
            <Database size={20} className="mx-auto text-[#8b9488]" aria-hidden="true" />
            <h3 className="mt-3 text-[11px] font-extrabold text-[#485b55]">Archive summary unavailable</h3>
            <p className="mx-auto mt-1 max-w-[430px] text-[9px] leading-5 text-[#858982]">
              No readiness figures are shown until the dashboard summary is available. No coverage is inferred.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#deddd3] bg-[#fbfaf6] px-3 text-[9px] font-extrabold text-[#64716d] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d96f51]"
              data-testid="button-retry-fair-readiness-empty"
            >
              <RefreshCw size={11} aria-hidden="true" /> Retry summary
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Archive coverage summary">
              {[
                { label: 'Completed matches', value: dashboard.matchCount.toLocaleString(), note: 'historical records' },
                { label: 'Teams', value: dashboard.teamCount.toLocaleString(), note: 'distinct archive teams' },
                { label: 'Verified odds', value: dashboard.verifiedOddsFixtureCount.toLocaleString(), note: oddsCoverage ? `${oddsCoverage} of matches` : 'no match denominator' },
                { label: 'Archive span', value: dashboard.firstMatchDate || dashboard.lastMatchDate ? `${dateLabel(dashboard.firstMatchDate)} – ${dateLabel(dashboard.lastMatchDate)}` : 'Not recorded', note: 'first to latest match' },
              ].map((metric) => (
                <div key={metric.label} className="min-w-0 rounded-xl border border-[#e3e2d9] bg-[#f5f4ed] px-3 py-3">
                  <p className="text-[7px] font-extrabold uppercase tracking-[.1em] text-[#90938a]">{metric.label}</p>
                  <p className="mono mt-1 truncate text-[14px] font-medium leading-tight tracking-[-.04em] text-[#344c43]" data-testid={`text-fair-${metric.label.toLowerCase().replaceAll(' ', '-')}`}>{metric.value}</p>
                  <p className="mt-1 text-[8px] text-[#92948b]">{metric.note}</p>
                </div>
              ))}
            </div>

            {archiveEmpty && (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-3 py-3 text-[9px] leading-5 text-[#858982]" role="status" data-testid="status-fair-empty-archive">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[#a2814b]" aria-hidden="true" />
                <p><strong className="text-[#65716b]">The completed-match archive is empty.</strong> Training inputs and verified-odds coverage cannot be assessed from match records yet.</p>
              </div>
            )}

            <section className="mt-4 overflow-hidden rounded-xl border border-[#e1dfd7] bg-[#fbfaf6]" aria-labelledby="fair-inventory-title">
              <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#e8e6de] bg-[#f5f4ed] px-3 py-3 sm:px-4">
                <div>
                  <p className="mono text-[8px] uppercase tracking-[.13em] text-[#9b7160]">01 / Input inventory</p>
                  <h3 id="fair-inventory-title" className="mt-0.5 text-[11px] font-extrabold text-[#43575a]">What current models actually use</h3>
                </div>
                <p className="text-[8px] text-[#858982]">Availability is not the same as model use.</p>
              </div>
              <InventoryRow
                label="Match outcomes"
                detail="Chronological completed-match results provide the target history used for training and evaluation."
                status={archiveEmpty ? 'No records' : 'Available'}
                statusKind={archiveEmpty ? 'partial' : 'available'}
              />
              <InventoryRow
                label="Recent team form"
                detail="Up to 15 prior matches per team are used where that chronological history exists."
                status={archiveEmpty ? 'No records' : 'History-dependent'}
                statusKind={archiveEmpty ? 'partial' : 'partial'}
              />
              <InventoryRow
                label="League context"
                detail="League averages and standings inform features where archived context is available."
                status={archiveEmpty ? 'No records' : 'When available'}
                statusKind="partial"
              />
              <InventoryRow
                label="Verified prior odds"
                detail={oddsCount === 0 ? 'No fixtures in the current summary have verified odds.' : `${dashboard.verifiedOddsFixtureCount.toLocaleString()} fixtures with verified odds in the archive summary; missing quotes are not treated as verified.`}
                status={oddsStatus}
                statusKind={oddsStatusKind}
              />
              <InventoryRow
                label="Player / coach profiles & availability"
                detail="These are not inputs to current trained models. Archived lineups or player aggregates do not make them model features."
                status="Not used"
                statusKind="unused"
              />
              <InventoryRow
                label="Action positions & tracking"
                detail="No tracked player/pitch coordinates or action trajectories are model inputs."
                status="Missing"
                statusKind="missing"
              />
              <InventoryRow
                label="Coach tactical modifiers"
                detail="Coach-specific tactical adjustments are not present as model inputs."
                status="Missing"
                statusKind="missing"
              />
              <InventoryRow
                label="H2H / clashes"
                detail="Head-to-head is not an explicit manager/player clash data source for the current models."
                status="Not explicit"
                statusKind="not-explicit"
              />
            </section>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(250px,.8fr)]">
              <section className="rounded-xl border border-[#d9e0d6] bg-[#f0f4ed] p-3.5 sm:p-4" aria-labelledby="fair-scope-title">
                <div className="flex items-start gap-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#e0eade] text-[#5d806a]" aria-hidden="true"><Target size={14} /></span>
                  <div className="min-w-0">
                    <h3 id="fair-scope-title" className="text-[10px] font-extrabold text-[#4f6e5a]">Current engine scope</h3>
                    <p className="mt-1 text-[9px] leading-[1.7] text-[#6f7e70]">
                      Trained outputs cover 1X2, both teams to score (BTTS), over/under 2.5 and 3.5 goals, and top correct scores. The FAIR AI tab now runs a 10,000-sample archive simulation using available player match statistics and team performance metrics. It is <strong>not a trained reinforcement-learning policy</strong> and does not calculate measured spatial xT/EVA because the source has no continuous player tracking or per-action start/end locations.
                    </p>
                  </div>
                </div>
              </section>
              <section className="rounded-xl border border-[#e3dfd3] bg-[#f7f5ed] p-3.5 sm:p-4" aria-labelledby="archive-vs-features-title">
                <div className="flex items-start gap-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#eeece2] text-[#8b785d]" aria-hidden="true"><Layers3 size={14} /></span>
                  <div>
                    <h3 id="archive-vs-features-title" className="text-[10px] font-extrabold text-[#5c6158]">Archived is not modeled</h3>
                    <p className="mt-1 text-[9px] leading-[1.7] text-[#7c8077]">
                      The archive may store lineups, match events, and aggregate player statistics. Those records are distinct from the active feature set; their presence alone does not mean models consume them.
                    </p>
                  </div>
                </div>
              </section>
            </div>

            <FairAiSourceDataPanel />

            <section className="mt-4 overflow-hidden rounded-xl border border-[#e1dfd7] bg-[#fbfaf6]" aria-labelledby="fair-next-data-title">
              <div className="border-b border-[#e8e6de] bg-[#f5f4ed] px-3 py-3 sm:px-4">
                <p className="mono text-[8px] uppercase tracking-[.13em] text-[#9b7160]">02 / Build readiness</p>
                <h3 id="fair-next-data-title" className="mt-0.5 text-[11px] font-extrabold text-[#43575a]">Practical next data requirements</h3>
              </div>
              <ol className="grid gap-0 sm:grid-cols-2">
                {[
                  ['01', 'Stable player and coach identifiers', 'Link profiles, registrations, and match participation across seasons.'],
                  ['02', 'Time-stamped availability', 'Capture injuries, suspensions, expected status, and when each report became known.'],
                  ['03', 'Player/action event records', 'For spatial xT/EVA, collect pitch coordinates plus action outcomes (for example pass, carry, shot, and result); coordinates without outcomes are insufficient.'],
                  ['04', 'Tracking and tactical context', 'Capture tracked player/pitch positions and action trajectories, plus explicit coach tactical features with provenance.'],
                ].map(([number, title, detail]) => (
                  <li key={number} className="flex gap-2.5 border-b border-[#e9e7df] px-3 py-3 last:border-0 sm:px-4 [&:nth-child(odd)]:sm:border-r">
                    <span className="mono pt-0.5 text-[8px] text-[#a17b67]">{number}</span>
                    <p className="text-[9px] leading-[1.65] text-[#777f77]"><strong className="text-[#4d5f58]">{title}.</strong> {detail}</p>
                  </li>
                ))}
              </ol>
              <div className="flex items-start gap-2.5 border-t border-[#e8e6de] bg-[#f7f6f0] px-3 py-3 text-[9px] leading-[1.65] text-[#777f77] sm:px-4">
                <GitBranch size={13} className="mt-0.5 shrink-0 text-[#75847a]" aria-hidden="true" />
                <p><strong className="text-[#53645b]">Before an RL simulator:</strong> player, action, and coach features must be collected and validated. Spatial xT/EVA requires coordinates paired with action outcomes; the simulator is not currently implemented.</p>
              </div>
            </section>

            <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-xl border border-[#deddd3] bg-[#f4f3ed] px-3.5 py-3 sm:flex-row sm:items-center sm:px-4">
              <p className="flex items-start gap-2 text-[9px] leading-5 text-[#778078]">
                <Footprints size={13} className="mt-1 shrink-0 text-[#7c897d]" aria-hidden="true" />
                Readiness reflects the current archive summary and documented model inputs; it does not certify model fairness or predictive performance.
              </p>
              <button
                type="button"
                onClick={onViewPredictions}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#253746] px-3.5 text-[9px] font-extrabold text-[#f8f2e7] transition hover:bg-[#344b5a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d96f51]"
                data-testid="button-view-predictions"
              >
                View predictions <ArrowRight size={13} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
