import { useEffect, useState } from 'react';
import { CircleAlert, GitBranch, LoaderCircle, MinusCircle } from 'lucide-react';
import {
  boardAgreementPercent,
  boardSharePercent,
  loadDecisionTree,
  type DecisionMarket,
  type DecisionNode,
  type DecisionTier,
  type DecisionTree,
} from '@/lib/decision-tree';

// The match page's Decision tree tab. Every other tab answers one question; this
// one reads all of them and settles the market card, with the path it took shown
// above the calls so a reader can argue with the branch rather than the answer.

const TIER_STYLE: Record<DecisionTier, string> = {
  firm: 'border-[#c6d8c9] bg-[#e6efe4] text-[#41694f]',
  leaning: 'border-[#e2d6bd] bg-[#f6efdf] text-[#8a6a38]',
  'knife-edge': 'border-[#e0d3cd] bg-[#f7ece7] text-[#9a5c46]',
};

function TierChip({ tier, label }: { tier: DecisionTier; label: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[.12em] ${TIER_STYLE[tier]}`}
      data-testid={`tier-${tier}`}
    >
      {label}
    </span>
  );
}

function NodeRow({ node }: { node: DecisionNode }) {
  return (
    <li
      className="relative border-l border-[#dcdad0] pl-4 last:border-l-transparent"
      style={{ marginLeft: `${node.depth * 18}px` }}
      data-testid={`node-${node.id}`}
    >
      <span className="absolute -left-[3.5px] top-2 size-[7px] rounded-full border border-[#c9c7bb] bg-[#f9f8f3]" />
      <div className="pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-[8px] uppercase tracking-[.14em] text-[#a48c7c]">{node.branch}</span>
          <p className="text-[11px] font-extrabold text-[#3a4d57]">{node.question}</p>
          {node.settles.length > 0 && (
            <span className="mono rounded-full bg-[#eceee5] px-1.5 py-0.5 text-[7.5px] uppercase tracking-[.1em] text-[#7d8579]">
              settles {node.settles.length}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[9.5px] leading-[1.7] text-[#84887f]">{node.reads}</p>
        <p className="mt-1 text-[10px] leading-[1.7] text-[#57675f]">{node.answer}</p>
      </div>
    </li>
  );
}

function MarketRow({ market }: { market: DecisionMarket }) {
  return (
    <div
      className="grid gap-2 border-b border-[#e9e7df] px-4 py-3 last:border-0 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] sm:items-start sm:gap-4"
      data-testid={`market-${market.id}`}
    >
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-[.1em] text-[#9a9d94]">{market.label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="mono text-[12px] font-medium text-[#2f4a3f]" data-testid={`call-${market.id}`}>
            {market.call}
          </p>
          <TierChip tier={market.tier} label={market.tierLabel} />
          {boardSharePercent(market) !== null && (
            <span
              className={`mono rounded-full border px-1.5 py-0.5 text-[7.5px] font-extrabold uppercase tracking-[.1em] ${
                market.agrees
                  ? 'border-[#cdd9cd] bg-[#eef3ea] text-[#5b7a63]'
                  : 'border-[#e4d2c6] bg-[#f9efea] text-[#a1654e]'
              }`}
              title={`The market board puts ${boardSharePercent(market)}% of this line's weight on the side the card called, so it ${
                market.agrees ? 'agrees' : 'disagrees'
              }. Shown for comparison; the board is not an input to the call.`}
              data-testid={`agree-${market.id}`}
            >
              board {boardSharePercent(market)}%
            </span>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[9.5px] leading-[1.65] text-[#6d7873]">{market.why}</p>
        <p className="mt-1 text-[8.5px] leading-[1.6] text-[#9b9d94]">{market.reads}</p>
      </div>
    </div>
  );
}

function Group({ title, markets }: { title: string; markets: DecisionMarket[] }) {
  if (!markets.length) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" data-testid={`group-${title}`}>
      <div className="flex items-center justify-between gap-3 border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-2.5">
        <h3 className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#43575a]">{title}</h3>
        <span className="mono text-[8.5px] text-[#8d9087]">{markets.length} lines</span>
      </div>
      {markets.map((market) => (
        <MarketRow key={market.id} market={market} />
      ))}
    </section>
  );
}

export function DecisionTreePanel({ fixtureId }: { fixtureId: number }) {
  const [tree, setTree] = useState<DecisionTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setTree(null);
    loadDecisionTree(fixtureId, controller.signal)
      .then((next) => setTree(next))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'The markets could not be settled.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [fixtureId]);

  if (loading) {
    return (
      <section
        className="flex min-h-[240px] flex-col items-center justify-center rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]"
        role="status"
        data-testid="status-decision-loading"
      >
        <LoaderCircle size={20} className="animate-spin text-[#b09a8c]" />
        <p className="mt-3 text-[11px] font-bold text-[#6b7772]">Reading the board, then settling the card</p>
        <p className="mt-1 max-w-sm text-center text-[10px] leading-5 text-[#93958b]">
          One read of the two squads, then the form, table and injury readings laid over it. Usually 8–30 seconds
          the first time a fixture is opened.
        </p>
      </section>
    );
  }

  if (error || !tree) {
    return (
      <section
        className="flex items-start gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] px-4 py-3.5"
        role="alert"
        data-testid="status-decision-error"
      >
        <CircleAlert size={16} className="mt-0.5 shrink-0 text-[#b85b46]" />
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-[#784b3e]">The markets could not be settled.</p>
          <p className="mt-1 text-[10px] leading-5 text-[#8c6b5e]">
            {error || 'The squads returned no board to read.'}
          </p>
        </div>
      </section>
    );
  }

  const groups: DecisionMarket['group'][] = ['Result', 'Goals', 'Both sides', 'Score'];
  const compared = tree.markets.filter((market) => market.boardShare !== null);
  const agreed = compared.filter((market) => (market.boardShare ?? 0) > 0.5).length;
  const boardWeight = compared.length
    ? compared.reduce((sum, market) => sum + (market.boardShare ?? 0), 0) / compared.length
    : null;
  const boardPercent = boardAgreementPercent({ boardWeight });

  return (
    <section className="space-y-5" data-testid="panel-decision-tree">
      <header className="overflow-hidden rounded-xl border border-[#d9e0d6] bg-[#f0f4ed]">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">
              Decision tree · one board, every market
            </p>
            <h2 className="mt-1 text-[15px] font-extrabold tracking-[-.04em] text-[#2f4438]">
              {tree.teams[0]} vs {tree.teams[1]}
            </h2>
            <p className="mono mt-1 text-[10px] text-[#5c6f63]" data-testid="text-decision-scoreline">
              {tree.scoreline}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono rounded-lg border border-[#ccd7cb] bg-[#f8faf4] px-2.5 py-1.5 text-[9px] text-[#4d6a55]">
              worth {tree.worth.home.toFixed(2)} – {tree.worth.away.toFixed(2)}
            </span>
            <span className="mono rounded-lg border border-[#ccd7cb] bg-[#f8faf4] px-2.5 py-1.5 text-[9px] text-[#4d6a55]">
              total {tree.total.toFixed(2)}
            </span>
            <span className="mono rounded-lg border border-[#ccd7cb] bg-[#f8faf4] px-2.5 py-1.5 text-[9px] text-[#4d6a55]">
              {tree.separation.toFixed(2)} apart
            </span>
            <span
              className="mono rounded-lg border border-[#ccd7cb] bg-[#f8faf4] px-2.5 py-1.5 text-[9px] text-[#4d6a55]"
              title={`Across the ${compared.length} lines the board priced, it puts ${boardPercent ?? 0}% of the weight on the sides the card called, and is on the card's side on ${agreed} of them. Shown for comparison; the board is not an input to any call.`}
              data-testid="text-decision-board-agreement"
            >
              {boardPercent === null
                ? 'board not priced'
                : `board ${boardPercent}% · ${agreed}/${compared.length} lines`}
            </span>
          </div>
        </div>
        <p className="border-t border-[#dde3d6] px-4 py-2.5 text-[9px] leading-[1.7] text-[#6f7d71]">{tree.note}</p>
      </header>

      <section>
        <div className="mb-2.5 flex items-center gap-2">
          <GitBranch size={13} className="text-[#9b7160]" />
          <h3 className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[#4a5c5e]">The path it took</h3>
          <span className="mono text-[8.5px] text-[#9a9d94]">{tree.nodes.length} questions</span>
        </div>
        <ol className="rounded-xl border border-[#deddd4] bg-[#fbfaf6] px-4 py-4" data-testid="decision-nodes">
          {tree.nodes.map((node) => (
            <NodeRow key={node.id} node={node} />
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[#4a5c5e]">The card</h3>
          <p className="text-[9px] text-[#9a9d94]">
            {tree.markets.length} lines settled
            {tree.referenceSource ? ` · board shown from ${tree.referenceSource}` : ''}
          </p>
        </div>
        {groups.map((group) => (
          <Group key={group} title={group} markets={tree.markets.filter((market) => market.group === group)} />
        ))}
      </section>

      {tree.withheld.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-[#e5dccd] bg-[#fbf7ef]" data-testid="decision-withheld">
          <div className="flex items-center gap-2 border-b border-[#ebe2d3] px-4 py-2.5">
            <MinusCircle size={12} className="text-[#a98b62]" />
            <h3 className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#7d6a4f]">
              Left off the card
            </h3>
            <span className="mono text-[8.5px] text-[#a99a80]">{tree.withheld.length}</span>
          </div>
          <ul className="divide-y divide-[#efe7d9]">
            {tree.withheld.map((item) => (
              <li key={item.label} className="px-4 py-2.5" data-testid="withheld-line">
                <p className="text-[9.5px] font-bold text-[#6f5f47]">{item.label}</p>
                <p className="mt-0.5 text-[9px] leading-[1.65] text-[#9a8c74]">{item.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#4a5c5e]">Trace</h3>
        <ol className="space-y-1.5 rounded-xl border border-[#deddd4] bg-[#f7f6f0] px-4 py-3.5" data-testid="decision-trace">
          {tree.trace.map((line, index) => (
            <li key={`${index}-${line.slice(0, 16)}`} className="flex gap-2 text-[9px] leading-[1.7] text-[#6d7873]">
              <span className="mono shrink-0 text-[8px] text-[#b0a598]">{String(index + 1).padStart(2, '0')}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
