import type { FootballOddsMarket } from '@workspace/api-client-react';
import {
  compareOddsWithModel,
  potentialOddsEdges,
  type OddsModelInput,
  type OddsComparedSelection,
} from '@/lib/odds-edge-analysis';

function percent(value: number | null, digits = 1) {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`;
}

function gap(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} pp`;
}

function labelFor(assessment: OddsComparedSelection['assessment']) {
  switch (assessment) {
    case 'potential-edge': return 'Potential price edge';
    case 'small-upside': return 'Small positive gap';
    case 'below-price': return 'Model below price';
    case 'aligned': return 'No clear gap';
    case 'limited-evidence': return 'Limited evidence';
    case 'not-screened': return 'Modelled · high variance';
    default: return 'Not modelled';
  }
}

function toneFor(assessment: OddsComparedSelection['assessment']) {
  switch (assessment) {
    case 'potential-edge': return 'border-[#b8cfbd] bg-[#eaf2eb] text-[#426b51]';
    case 'small-upside': return 'border-[#e1d6bd] bg-[#f6f0e4] text-[#82714d]';
    case 'below-price': return 'border-[#e4d0c8] bg-[#f8ece8] text-[#995f50]';
    case 'limited-evidence':
    case 'not-screened': return 'border-[#e2e0d7] bg-[#f1f0e9] text-[#7e8075]';
    default: return 'border-[#e2e0d7] bg-[#f6f5ef] text-[#858982]';
  }
}

function QuoteRow({ selection, marketId, index }: {
  selection: OddsComparedSelection;
  marketId: string;
  index: number;
}) {
  const marketProbability = selection.fairProbability ?? selection.rawImpliedProbability;
  return <tr className="border-t border-[#eceae2] align-top" data-testid={`bookmaker-quote-${marketId}-${index}`}>
    <td className="py-2.5 pr-3">
      <p className="font-bold text-[#52615e]">{selection.selection}</p>
      <p className="mt-1 text-[7px] leading-3 text-[#92958b]">{selection.bookmaker || 'Bookmaker not named'} · best returned quote · {selection.bookmakerCount} {selection.bookmakerCount === 1 ? 'book' : 'books'}</p>
    </td>
    <td className="mono py-2.5 text-center text-[#43575a]">{selection.odd.toFixed(2)}</td>
    <td className="mono py-2.5 text-center text-[#68756d]" data-testid={`bookmaker-raw-implied-${marketId}-${index}`}>{percent(selection.rawImpliedProbability)}</td>
    <td className="mono py-2.5 text-center text-[#526d5c]" data-testid={`bookmaker-market-probability-${marketId}-${index}`}>
      {percent(marketProbability)}
      <span className="mt-0.5 block text-[6px] text-[#92958b]">{selection.fairProbability !== null ? 'de-vig' : 'raw · no full book'}</span>
    </td>
    <td className="mono py-2.5 text-center text-[#526d5c]" data-testid={`bookmaker-model-probability-${marketId}-${index}`}>{percent(selection.modelProbability)}</td>
    <td className="mono py-2.5 text-center text-[#526d5c]" data-testid={`bookmaker-gap-${marketId}-${index}`}>{gap(selection.probabilityGap)}</td>
    <td className="mono py-2.5 text-center text-[#526d5c]" data-testid={`bookmaker-ev-${marketId}-${index}`}>{percent(selection.expectedValue)}</td>
    <td className="py-2.5 pl-2 text-right">
      <span className={`inline-block max-w-[112px] rounded-md border px-1.5 py-1 text-[6px] font-bold leading-3 ${toneFor(selection.assessment)}`} data-testid={`bookmaker-assessment-${marketId}-${index}`}>
        {labelFor(selection.assessment)}
      </span>
    </td>
  </tr>;
}

export function BookmakerComparisonPanel({ markets, homeName, awayName, model, evidenceReason }: {
  markets: FootballOddsMarket[];
  homeName: string;
  awayName: string;
  model: OddsModelInput;
  evidenceReason: string;
}) {
  const comparisons = compareOddsWithModel(markets, homeName, awayName, model);
  const potential = potentialOddsEdges(comparisons);
  const strongest = potential[0];

  return <section className="overflow-hidden rounded-xl border border-[#d8ded5] bg-[#fbfaf6]" data-testid="insight-bookmaker-comparison">
    <header className="border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Start with the price</p>
          <h3 className="mt-1 text-[12px] font-extrabold text-[#43575a]">Bookmaker probability vs our model</h3>
        </div>
        <span className="mono rounded-md border border-[#deded4] bg-[#f9f8f3] px-2 py-1 text-[7px] text-[#7c857c]" data-testid="insight-edge-evidence-status">
          {model.evidenceSufficient ? 'Evidence screen passed' : 'Evidence screen limited'}
        </span>
      </div>
      <p className="mt-2 max-w-4xl text-[8px] leading-4 text-[#82877f]">
        These are probabilities implied by prices, not the bookmaker's internal model. The feed returns the best quote per outcome, may mix books, and supplies no timestamp. Raw implied probability is 1 ÷ decimal odds; a margin-adjusted figure is shown only when all outcomes come from the same bookmaker. Expected value is a model estimate, not a promise of return.
      </p>
    </header>

    <div className="p-3.5 sm:p-4">
      {!markets.length ? <div className="rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-4 py-5" data-testid="insight-no-bookmaker-prices">
        <p className="text-[10px] font-extrabold text-[#52635a]">No bookmaker prices returned</p>
        <p className="mt-1.5 text-[8px] leading-4 text-[#858982]">Without a current price there is no implied probability to compare and no edge can be identified. The model outputs below are estimates only.</p>
      </div> : <>
        <div className={`rounded-lg border px-3.5 py-3 ${strongest ? 'border-[#b8cfbd] bg-[#edf3ed]' : 'border-[#e2e0d7] bg-[#f6f5ef]'}`} data-testid="insight-edge-summary">
          {strongest ? <>
            <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#54745e]">Potential price discrepancy · not a recommendation</p>
            <p className="mt-1 text-[9px] leading-4 text-[#53675a]">
              {strongest.selection.selection} · {strongest.market.name}: model {percent(strongest.selection.modelProbability)} vs {strongest.selection.referenceType === 'de-vig' ? 'margin-adjusted market' : 'raw price-implied'} {percent(strongest.selection.fairProbability ?? strongest.selection.rawImpliedProbability)}; {gap(strongest.selection.probabilityGap)} and estimated EV {percent(strongest.selection.expectedValue)} at {strongest.selection.odd.toFixed(2)} ({strongest.selection.bookmaker || 'bookmaker not named'}).
            </p>
          </> : <>
            <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#68746a]">No clear edge identified</p>
            <p className="mt-1 text-[8px] leading-4 text-[#858982]">
              {model.evidenceSufficient
                ? 'No supported outcome cleared both the minimum 3 percentage-point probability gap and 5% estimated-value thresholds.'
                : `${evidenceReason} Model probabilities are shown for context, but the edge screen is held back.`}
            </p>
          </>}
        </div>

        <div className="mt-3 space-y-3">
          {comparisons.map((market) => {
            const margin = market.selections.find((selection) => selection.marginPercent !== null)?.marginPercent;
            const modelledSelections = market.selections.filter((selection) => selection.modelProbability !== null).length;
            return <article key={market.marketId} className="overflow-hidden rounded-lg border border-[#e4e2d9] bg-[#fcfbf7]" data-testid={`bookmaker-market-comparison-${market.marketId}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eceae2] bg-[#f8f7f1] px-3 py-2.5">
                <div><h4 className="text-[9px] font-extrabold text-[#52615e]">{market.name}</h4><p className="mono mt-0.5 text-[7px] uppercase text-[#999a91]">{market.category} · {market.kind === 'correct-score' ? 'exact score · raw implied only' : modelledSelections ? 'model-comparable market' : 'price only · no model estimate'}</p></div>
                {margin !== null && margin !== undefined && <span className="mono rounded bg-[#efeee7] px-2 py-1 text-[7px] text-[#777e76]" data-testid={`bookmaker-overround-${market.marketId}`}>same-book margin {percent(margin)}</span>}
              </div>
              {market.selections.length ? <div className="overflow-x-auto px-3">
                <table className="w-full min-w-[790px] text-left text-[7px]">
                  <thead className="text-[6px] font-bold uppercase tracking-[.06em] text-[#92968d]"><tr>
                    <th className="py-2 pr-3">Outcome / source</th><th className="py-2 text-center">Odds</th><th className="py-2 text-center">Raw implied</th><th className="py-2 text-center">Market baseline</th><th className="py-2 text-center">Model</th><th className="py-2 text-center">Gap</th><th className="py-2 text-center">Est. EV</th><th className="py-2 text-right">Screen</th>
                  </tr></thead>
                  <tbody>{market.selections.map((selection, index) => <QuoteRow key={`${selection.selection}-${index}`} selection={selection} marketId={market.marketId} index={index} />)}</tbody>
                </table>
              </div> : <p className="px-3 py-3 text-[8px] text-[#858982]">No odds selections were returned.</p>}
            </article>;
          })}
        </div>
        {!model.evidenceSufficient && <p className="mt-3 rounded-md border border-[#e6e4dc] bg-[#f7f6f0] px-3 py-2 text-[7px] leading-4 text-[#858982]" data-testid="insight-edge-evidence-reason">{evidenceReason}</p>}
      </>}
      <p className="mt-3 border-t border-[#eceae2] pt-2.5 text-[7px] leading-4 text-[#92958b]">
        Edge screen: at least +3 percentage points versus the available market baseline and +5% modelled expected value, with adequate recent-result and five-match xG coverage. “Potential” means a model/price discrepancy worth checking; it is not a proven, backtested advantage and does not account for every bookmaker input or guarantee a profitable result.
      </p>
    </div>
  </section>;
}
