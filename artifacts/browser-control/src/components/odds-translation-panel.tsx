import type { FootballOddsMarket } from '@workspace/api-client-react';
import { ArrowRightLeft, CircleHelp, Sparkles } from 'lucide-react';
import { compareOddsWithModel } from '@/lib/odds-edge-analysis';

function percentage(value: number | null) {
  return value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
}

function marginLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}% margin`;
}

export function OddsTranslationPanel({
  markets,
  homeName,
  awayName,
}: {
  markets: FootballOddsMarket[];
  homeName: string;
  awayName: string;
}) {
  const translated = compareOddsWithModel(markets, homeName, awayName, {
    result: null,
    btts: null,
    scoreMatrix: [],
    evidenceSufficient: false,
  });
  const quoteCount = translated.reduce((total, market) => total + market.selections.length, 0);
  const resultMarket = translated.find((market) => market.kind === '1x2');
  const resultLeader = resultMarket?.selections
    .filter((selection) => selection.rawImpliedProbability !== null)
    .sort((left, right) =>
      (right.fairProbability ?? right.rawImpliedProbability ?? 0) -
      (left.fairProbability ?? left.rawImpliedProbability ?? 0),
    )[0];
  const resultIsNormalized = resultLeader?.fairProbability !== null && resultLeader?.fairProbability !== undefined;

  return (
    <section className="space-y-5" data-testid="panel-odds-translation">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mono text-[9px] uppercase tracking-[.17em] text-[#9b7160]">Bookmaker prices, translated</p>
          <h2 className="mt-1 text-[20px] font-extrabold tracking-[-.05em] text-[#2b3e49]">Odds to expected outcomes</h2>
          <p className="mt-1 text-[9px] text-[#858982]">{homeName} at home · {awayName} away</p>
        </div>
        <span className="mono rounded-md border border-[#dcded3] bg-[#f3f4ed] px-2.5 py-1.5 text-[8px] text-[#748078]" data-testid="odds-translation-coverage">
          {translated.length} markets · {quoteCount} prices
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <article className="rounded-xl border border-[#d8ded5] bg-[#edf2ec] p-4" data-testid="odds-translation-result-summary">
          <div className="flex items-center gap-2 text-[#537867]">
            <Sparkles size={14} />
            <p className="text-[8px] font-extrabold uppercase tracking-[.12em]">Most likely 1X2 result by odds</p>
          </div>
          {resultLeader ? <>
            <p className="mt-3 text-[18px] font-extrabold tracking-[-.04em] text-[#344c40]">{resultLeader.selection}</p>
            <p className="mono mt-1 text-[22px] font-semibold text-[#456b58]" data-testid="odds-translation-result-probability">
              {percentage(resultLeader.fairProbability ?? resultLeader.rawImpliedProbability)}
            </p>
            <p className="mt-1 text-[8px] leading-4 text-[#63766b]">
              {resultIsNormalized
                ? `Margin-adjusted using the complete 1X2 set from ${resultLeader.bookmaker}.`
                : `Raw implied chance from ${resultLeader.bookmaker || 'the returned best quote'}; the full same-book 1X2 set was unavailable.`}
            </p>
          </> : <p className="mt-3 text-[9px] leading-5 text-[#63766b]">No usable 1X2 prices were returned for this match.</p>}
        </article>

        <article className="rounded-xl border border-[#deddd4] bg-[#fbfaf6] p-4">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={14} className="text-[#9b7160]" />
            <h3 className="text-[10px] font-extrabold text-[#43575a]">How each price translates</h3>
          </div>
          <p className="mt-2 text-[8px] leading-5 text-[#858982]">
            Raw implied chance = 1 ÷ decimal odds. When all outcomes for a recognized market are present from the same bookmaker, the estimate is normalized to 100% to remove that book’s margin. Prices from different books are not combined into a made-up fair probability.
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-[8px] leading-4 text-[#9b7160]">
            <CircleHelp size={11} className="mt-0.5 shrink-0" />
            These are odds-implied chances, not a bookmaker’s disclosed internal forecast. The source does not provide a verified quote timestamp.
          </p>
        </article>
      </div>

      {!translated.length ? (
        <div className="flex min-h-[190px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-6 py-10 text-center" data-testid="empty-odds-translation">
          <span className="grid size-10 place-items-center rounded-xl bg-[#e9eee8] text-[#708679]"><ArrowRightLeft size={17} /></span>
          <h3 className="mt-3 text-[13px] font-extrabold text-[#3c5058]">No odds to translate</h3>
          <p className="mt-1.5 max-w-sm text-[10px] leading-5 text-[#858982]">The source did not return bookmaker prices for this fixture.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {translated.map((market) => {
            const rows = [...market.selections].sort((left, right) =>
              (right.fairProbability ?? right.rawImpliedProbability ?? -1) -
              (left.fairProbability ?? left.rawImpliedProbability ?? -1),
            );
            const margins = [...new Set(market.selections
              .map((selection) => selection.marginPercent)
              .filter((value): value is number => value !== null))];

            return (
              <article key={market.marketId} className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" data-testid={`odds-translation-market-${market.marketId}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3">
                  <div>
                    <h3 className="text-[10px] font-extrabold text-[#43575a]">{market.name}</h3>
                    <p className="mono mt-1 text-[7px] uppercase tracking-[.1em] text-[#96978f]">{market.category} · {rows.length} selections</p>
                  </div>
                  {margins.length > 0 && (
                    <span className="mono rounded-md border border-[#deded4] bg-[#f9f8f3] px-2 py-1 text-[7px] text-[#7c857c]" data-testid={`odds-translation-margin-${market.marketId}`}>
                      {margins.length === 1 ? marginLabel(margins[0]) : `${margins.length} market margins`}
                    </span>
                  )}
                </div>
                {rows.length ? (
                  <div className="overflow-x-auto px-3 sm:px-4">
                    <table className="w-full min-w-[610px] text-left text-[8px]" aria-label={`${market.name} odds translated to implied probabilities`}>
                      <thead className="text-[7px] font-bold uppercase tracking-[.07em] text-[#92968d]">
                        <tr>
                          <th className="py-2.5 pr-3">Outcome</th>
                          <th className="py-2.5 text-center">Decimal odds</th>
                          <th className="py-2.5 text-center">Raw implied chance</th>
                          <th className="py-2.5 text-center">Bookmaker estimate</th>
                          <th className="py-2.5 pl-3 text-right">Price source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((selection, index) => {
                          const estimate = selection.fairProbability ?? selection.rawImpliedProbability;
                          const isNormalized = selection.fairProbability !== null;
                          return (
                            <tr key={`${selection.selection}-${index}`} className="border-t border-[#eceae2]" data-testid={`odds-translation-selection-${market.marketId}-${index}`}>
                              <td className="py-2.5 pr-3 font-bold text-[#52615e]">{selection.selection}</td>
                              <td className="mono py-2.5 text-center text-[#43575a]">{Number.isFinite(selection.odd) ? selection.odd.toFixed(2) : '—'}</td>
                              <td className="mono py-2.5 text-center text-[#68756d]" data-testid={`odds-translation-raw-${market.marketId}-${index}`}>{percentage(selection.rawImpliedProbability)}</td>
                              <td className="mono py-2.5 text-center font-bold text-[#526d5c]" data-testid={`odds-translation-estimate-${market.marketId}-${index}`}>
                                {percentage(estimate)}
                                <span className="mt-0.5 block text-[7px] font-normal text-[#92958b]">{isNormalized ? 'margin-adjusted' : 'raw · incomplete set'}</span>
                              </td>
                              <td className="py-2.5 pl-3 text-right text-[#858982]">
                                <span className="font-bold text-[#65716a]">{selection.bookmaker || 'Bookmaker not named'}</span>
                                <span className="mt-0.5 block">{selection.bookmakerCount} {selection.bookmakerCount === 1 ? 'book' : 'books'} returned</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="px-4 py-4 text-[9px] text-[#858982]">No selections were returned for this market.</p>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
