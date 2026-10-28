import type { FootballOddsMarket } from '@workspace/api-client-react';
import { ArrowRightLeft, CircleHelp } from 'lucide-react';
import { compareOddsWithModel } from '@/lib/odds-edge-analysis';
import { analyzeOddsExpectation } from '@/lib/odds-expectation';

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
  const expectations = analyzeOddsExpectation(markets, homeName, awayName);
  const quoteCount = translated.reduce((total, market) => total + market.selections.length, 0);
  const resultLeader = expectations
    ? [...expectations.result].sort((left, right) => right.probability - left.probability)[0]
    : null;
  const bttsLeader = expectations
    ? [...expectations.btts].sort((left, right) => right.probability - left.probability)[0]
    : null;
  const closeBttsMarket = expectations
    ? Math.abs(expectations.btts[0].probability - expectations.btts[1].probability) < 0.03
    : false;
  const summaryTotals = expectations
    ? expectations.totals.filter((line) => [1.5, 2.5, 3.5].includes(line.line))
    : [];
  const combinedRead = expectations && resultLeader && bttsLeader
    ? `Combined read: ${resultLeader.label} leads 1X2 at ${percentage(resultLeader.probability)}; ${closeBttsMarket ? 'BTTS is closely priced' : `${bttsLeader.label} leads BTTS`} at ${percentage(bttsLeader.probability)}; ${summaryTotals.length ? summaryTotals.map((line) => `${line.over > line.under ? 'Over' : 'Under'} ${line.line.toFixed(1)} (${percentage(Math.max(line.over, line.under))})`).join(', ') : 'no complete standard total-goals lines'}; top scorelines ${expectations.topScores.slice(0, 2).map((score) => `${score.homeGoals}-${score.awayGoals}`).join(' and ')}.`
    : null;

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

      {expectations ? (
        <section className="overflow-hidden rounded-xl border border-[#d8ded5] bg-[#fbfaf6]" data-testid="odds-translation-joint-expectation">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e8e6de] bg-[#edf2ec] px-4 py-3.5">
            <div>
              <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Combined full-time market read</p>
              <h3 className="mt-1 text-[13px] font-extrabold text-[#344c40]">What the available odds point toward</h3>
            </div>
            <div className="mono text-right text-[8px] text-[#718079]" data-testid="odds-translation-input-count">
              {expectations.marketSourceCount} market sources · {expectations.signalCount} distinct signals
            </div>
          </div>

          {combinedRead && <p className="border-b border-[#e8e6de] bg-[#f8f7f1] px-4 py-3 text-[9px] font-semibold leading-5 text-[#52675a]" data-testid="odds-translation-combined-read">{combinedRead}</p>}

          <div className="grid gap-3 p-3 sm:p-4 xl:grid-cols-4">
            <article className="rounded-lg border border-[#e4e2d9] bg-[#fcfbf7] p-3" data-testid="odds-translation-joint-result">
              <h4 className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#82877f]">Full-time result</h4>
              <div className="mt-3 space-y-2.5">
                {expectations.result.map((outcome) => {
                  const leading = outcome.probability === Math.max(...expectations.result.map((item) => item.probability));
                  return <div key={outcome.label}>
                    <div className="mb-1 flex justify-between gap-2 text-[8px]">
                      <span className={`truncate ${leading ? 'font-extrabold text-[#456b58]' : 'text-[#68756d]'}`}>{outcome.label}</span>
                      <span className="mono font-bold text-[#52615e]">{percentage(outcome.probability)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#e8e7df]">
                      <div className={`h-full rounded-full ${leading ? 'bg-[#63876e]' : 'bg-[#a8b5a8]'}`} style={{ width: `${Math.max(0, Math.min(100, outcome.probability * 100))}%` }} />
                    </div>
                  </div>;
                })}
              </div>
            </article>

            <article className="rounded-lg border border-[#e4e2d9] bg-[#fcfbf7] p-3" data-testid="odds-translation-joint-btts">
              <h4 className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#82877f]">Both teams to score</h4>
              <div className="mt-3 space-y-2.5">
                {expectations.btts.map((outcome) => {
                  const leading = outcome.probability === Math.max(...expectations.btts.map((item) => item.probability));
                  return <div key={outcome.label}>
                    <div className="mb-1 flex justify-between gap-2 text-[8px]">
                      <span className={`${leading ? 'font-extrabold text-[#456b58]' : 'text-[#68756d]'}`}>{outcome.label}</span>
                      <span className="mono font-bold text-[#52615e]">{percentage(outcome.probability)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#e8e7df]">
                      <div className={`h-full rounded-full ${leading ? 'bg-[#63876e]' : 'bg-[#a8b5a8]'}`} style={{ width: `${Math.max(0, Math.min(100, outcome.probability * 100))}%` }} />
                    </div>
                  </div>;
                })}
              </div>
            </article>

            <article className="rounded-lg border border-[#e4e2d9] bg-[#fcfbf7] p-3" data-testid="odds-translation-joint-totals">
              <h4 className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#82877f]">Total goals · full time</h4>
              {expectations.totals.length ? (
                <div className="mt-2 divide-y divide-[#eceae2]">
                  {expectations.totals.map((line) => {
                    const likely = line.over > line.under ? 'Over' : 'Under';
                    const chance = Math.max(line.over, line.under);
                    return <div key={line.line} className="flex items-center justify-between gap-2 py-2 first:pt-1 last:pb-0" data-testid={`odds-translation-joint-total-${line.line}`}>
                      <span className={`text-[8px] font-bold ${chance >= 0.55 ? 'text-[#456b58]' : 'text-[#68756d]'}`}>{likely} {line.line.toFixed(1)}</span>
                      <span className="mono text-[8px] text-[#52615e]">{percentage(chance)} <span className="text-[#a0a198]">· O {percentage(line.over)} / U {percentage(line.under)}</span></span>
                    </div>;
                  })}
                </div>
              ) : <p className="mt-3 text-[8px] leading-4 text-[#92958b]">No complete full-time goal-line pair was returned.</p>}
            </article>

            <article className="rounded-lg border border-[#e4e2d9] bg-[#fcfbf7] p-3" data-testid="odds-translation-joint-scores">
              <h4 className="text-[8px] font-extrabold uppercase tracking-[.1em] text-[#82877f]">Most likely scorelines</h4>
              <p className="mono mt-1 text-[7px] text-[#92958b]">Expected goals · {expectations.expectedHomeGoals.toFixed(2)} – {expectations.expectedAwayGoals.toFixed(2)}</p>
              <div className="mt-2 space-y-1.5">
                {expectations.topScores.slice(0, 4).map((score) => <div key={`${score.homeGoals}-${score.awayGoals}`} className="flex items-center justify-between rounded-md bg-[#f3f2eb] px-2.5 py-2">
                  <span className="mono text-[10px] font-extrabold text-[#43575a]">{score.homeGoals} – {score.awayGoals}</span>
                  <span className="mono text-[8px] font-bold text-[#526d5c]">{percentage(score.probability)}</span>
                </div>)}
              </div>
            </article>
          </div>

          <div className="border-t border-[#e8e6de] px-4 py-3">
            <p className="text-[8px] leading-4 text-[#737d76]" data-testid="odds-translation-fit-method">
              The score distribution combines normalized prices from full-time 1X2, BTTS, full-time total-goal lines, team-goal lines, result/goal combinations, and complete correct-score markets when available. {expectations.scoreMarketSeeded
                ? 'A complete correct-score market anchors the scoreline probabilities; the other markets adjust that distribution.'
                : 'Without a complete correct-score market, a simple Poisson score grid is fitted to the available odds signals.'}
              {' '}The input-to-fit average difference is {expectations.fitErrorPoints === null ? 'unavailable' : `${expectations.fitErrorPoints.toFixed(1)} percentage points`}; a larger difference means the markets disagree.
            </p>
            <p className="mt-1.5 flex items-start gap-1.5 text-[8px] leading-4 text-[#9b7160]">
              <CircleHelp size={11} className="mt-0.5 shrink-0" />
              This is a combined odds-implied estimate, not a bookmaker’s disclosed internal model. Returned best prices can come from different books, and the source does not provide a verified quote timestamp. Half-time, corners, cards, and player markets remain visible below but are not treated as full-time score evidence.
            </p>
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-4 py-4" data-testid="odds-translation-joint-unavailable">
          <div className="flex items-center gap-2 text-[#65756a]"><ArrowRightLeft size={14} /><p className="text-[9px] font-extrabold">Combined match expectation unavailable</p></div>
          <p className="mt-1.5 text-[8px] leading-4 text-[#858982]">No complete full-time result, goal, BTTS, or scoreline markets were returned. Every individual price below is still translated where possible.</p>
        </div>
      )}

      {!translated.length ? (
        <div className="flex min-h-[190px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-6 py-10 text-center" data-testid="empty-odds-translation">
          <span className="grid size-10 place-items-center rounded-xl bg-[#e9eee8] text-[#708679]"><ArrowRightLeft size={17} /></span>
          <h3 className="mt-3 text-[13px] font-extrabold text-[#3c5058]">No odds to translate</h3>
          <p className="mt-1.5 max-w-sm text-[10px] leading-5 text-[#858982]">The source did not return bookmaker prices for this fixture.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2 px-1">
            <div><p className="mono text-[8px] uppercase tracking-[.14em] text-[#9b7160]">Full feed</p><h3 className="mt-1 text-[12px] font-extrabold text-[#43575a]">Every returned market and selection</h3></div>
            <span className="mono text-[8px] text-[#858982]">{translated.length} markets · {quoteCount} selections</span>
          </div>
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
