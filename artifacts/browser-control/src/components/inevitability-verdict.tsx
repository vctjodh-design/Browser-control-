import { Link } from 'wouter';
import { ArrowRight, Crosshair, Gauge, Skull, Target } from 'lucide-react';
import type { InevitabilityVerdict } from '@/lib/inevitability';

// The verdict, drawn once and used by both surfaces: the Inevitability page and
// the match page's tab. The scoreline, the lynchpin and the script are the same
// objects in both places, so a change to how the engine speaks shows up in one
// component rather than two that can drift apart.

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mono text-[8px] uppercase tracking-[.16em] text-[#9a8c80]">{label}</dt>
      <dd className="mono mt-1 text-[15px] font-extrabold text-[#2b3e49]">{value}</dd>
    </div>
  );
}

export function VerdictHeader({
  verdict,
  showMatchLink = true,
}: {
  verdict: InevitabilityVerdict;
  showMatchLink?: boolean;
}) {
  // The confidence says what kind of verdict this is: about the elevens, or
  // about one channel resolving on one night. Colour carries the same meaning.
  const tone =
    verdict.confidence.tier === 'firm'
      ? 'border-[#c3d2c8] bg-[#eef3ee] text-[#4c6b58]'
      : verdict.confidence.tier === 'leaning'
        ? 'border-[#e0cdc0] bg-[#faf1ea] text-[#8a6a58]'
        : 'border-[#e3c3b6] bg-[#fff6f0] text-[#b85b46]';
  return (
    <section
      className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]"
      data-testid="section-verdict"
    >
      <div className="grid gap-5 px-4 py-5 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6">
        <div>
          <p className="mono text-[8px] uppercase tracking-[.18em] text-[#9b7160]">The verdict</p>
          <p
            className="mt-1 text-[30px] font-extrabold leading-none tracking-[-.05em] text-[#2b3e49]"
            data-testid="text-scoreline"
          >
            {verdict.short[0]} {verdict.verdict.home}–{verdict.verdict.away} {verdict.short[1]}
          </p>
          <p className="mt-2 max-w-[560px] text-[11px] leading-5 text-[#727973]">{verdict.verdict.text}</p>
        </div>
        <dl className="flex gap-6 sm:justify-end">
          <Stat label="Home xG" value={verdict.expectedGoals.home.toFixed(2)} />
          <Stat label="Away xG" value={verdict.expectedGoals.away.toFixed(2)} />
        </dl>
      </div>
      <div className="grid gap-2 border-t border-[#e1dfd7] px-4 py-3 sm:grid-cols-[auto_1fr] sm:items-start sm:gap-4 sm:px-6">
        <p
          className={`mono inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.13em] ${tone}`}
          data-testid="chip-confidence"
          title={verdict.confidence.basis}
        >
          <Gauge size={11} /> {verdict.confidence.label}
          <span className="text-[#9a9c93]">· {verdict.confidence.separation.toFixed(2)}</span>
        </p>
        <div>
          <p className="text-[10px] leading-5 text-[#5d6a66]" data-testid="text-confidence">
            {verdict.confidence.text}
          </p>
          <p className="mono mt-0.5 text-[8px] uppercase tracking-[.1em] text-[#a0a29a]">{verdict.confidence.basis}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e1dfd7] bg-[#f1f0e9] px-4 py-2.5 sm:px-6">
        <p className="mono text-[8px] uppercase tracking-[.12em] text-[#8b8d84]">
          {verdict.teams[0]} v {verdict.teams[1]}
        </p>
        {showMatchLink && (
          <Link
            href={`/matches/${verdict.fixtureId}`}
            className="inline-flex items-center gap-1 text-[9px] font-extrabold text-[#8a6a58] underline-offset-2 hover:underline"
            data-testid="link-verdict-match"
          >
            Match centre <ArrowRight size={11} />
          </Link>
        )}
      </div>
    </section>
  );
}

export function LynchpinCard({ verdict }: { verdict: InevitabilityVerdict }) {
  const link = verdict.lynchpin;
  const share = Math.round(link.share * 100);
  return (
    <section
      className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_16px_50px_rgba(47,59,64,.06)]"
      data-testid="section-lynchpin"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e1dfd7] bg-[#f1f0e9] px-4 py-3 sm:px-6">
        <p className="mono flex items-center gap-2 text-[9px] uppercase tracking-[.17em] text-[#9b7160]">
          <Target size={13} /> The lynchpin matchup
        </p>
        <p className="mono text-[8px] uppercase tracking-[.12em] text-[#93958b]">{link.lane} channel</p>
      </div>

      <div className="grid gap-4 px-4 py-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a37a68]">{link.team} · carrying</p>
          <p className="mt-1 text-[19px] font-extrabold leading-tight tracking-[-.04em] text-[#2b3e49]">{link.attacker}</p>
          <p className="mono text-[9px] text-[#858780]">{link.attackerRole}</p>
        </div>
        <div className="grid place-items-center">
          <span className="mono rounded-full border border-[#d9d8cf] bg-white px-3 py-1 text-[9px] font-extrabold uppercase tracking-[.14em] text-[#7d827d]">
            vs
          </span>
        </div>
        <div className="sm:text-right">
          <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#5f7c6d]">{link.opponent} · covering</p>
          <p className="mt-1 text-[19px] font-extrabold leading-tight tracking-[-.04em] text-[#2b3e49]">{link.defender}</p>
          <p className="mono text-[9px] text-[#858780]">{link.defenderRole}</p>
        </div>
      </div>

      <div className="mx-4 mb-5 rounded-xl border border-[#e3e1d8] bg-white px-4 py-4 sm:mx-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-bold text-[#4c5a58]">
            {link.attacker} keeps {Math.round(link.share * 10)} carries in 10
          </p>
          <p className="mono text-[9px] text-[#8b8d84]">
            {link.edge > 0 ? '+' : ''}
            {link.edge.toFixed(1)} rating points
          </p>
        </div>
        <span className="mt-2.5 block h-[7px] w-full overflow-hidden rounded-full bg-[#eceae1]">
          <span
            className="block h-full rounded-full bg-[#c97555]"
            style={{ width: `${Math.max(3, Math.min(100, share))}%` }}
          />
        </span>
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-[#efeee7] pt-3 sm:grid-cols-3">
          <Stat label="Forced adaptation" value={link.forcedAdaptation.toFixed(2)} />
          <Stat label="Cover distance" value={`${link.coverDistance.toFixed(2)} slots`} />
          <Stat label="Contest" value={link.kind} />
        </dl>
      </div>

      <div className="grid border-t border-[#e1dfd7] sm:grid-cols-2">
        <div className="border-b border-[#e1dfd7] px-4 py-4 sm:border-b-0 sm:border-r sm:px-6">
          <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">What covering it costs</p>
          <p className="mt-1.5 text-[11px] leading-5 text-[#5d6a66]">{link.response}</p>
        </div>
        <div className="px-4 py-4 sm:px-6">
          <p className="mono text-[8px] uppercase tracking-[.15em] text-[#5f7c6d]">What that opens</p>
          <p className="mt-1.5 text-[11px] leading-5 text-[#5d6a66]">{link.opens}</p>
        </div>
      </div>
    </section>
  );
}

export function Cascade({ verdict }: { verdict: InevitabilityVerdict }) {
  return (
    <section
      className="overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]"
      data-testid="section-cascade"
    >
      <div className="border-b border-[#e1dfd7] bg-[#f1f0e9] px-4 py-3 sm:px-6">
        <p className="mono text-[9px] uppercase tracking-[.17em] text-[#9b7160]">The channel's arithmetic</p>
        <p className="mt-1 text-[10px] leading-4 text-[#8b8d84]">
          Possessions in the {verdict.lynchpin.lane} channel, down to the goals they are worth.
        </p>
      </div>
      <ol className="divide-y divide-[#eceae1]">
        {verdict.cascade.map((step, index) => (
          <li
            key={step.label}
            className="flex items-baseline gap-3 px-4 py-3 sm:px-6"
            data-testid={`cascade-step-${index}`}
          >
            <span className="mono w-4 shrink-0 text-[9px] text-[#b0b2a8]">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-[#3d4c4a]">{step.label}</p>
              <p className="mt-0.5 text-[10px] leading-4 text-[#8b8d84]">{step.detail}</p>
            </div>
            <p className="mono shrink-0 text-right text-[13px] font-extrabold text-[#2b3e49]">
              {step.value}
              <span className="ml-1 text-[8px] font-normal uppercase tracking-[.1em] text-[#a0a29a]">{step.unit}</span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Script({ verdict }: { verdict: InevitabilityVerdict }) {
  return (
    <section
      className="overflow-hidden rounded-[17px] border border-[#2c4152] bg-[#1b2b38] text-[#dfe6e2]"
      data-testid="section-trace"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2c4152] px-4 py-3 sm:px-6">
        <p className="mono flex items-center gap-2 text-[9px] uppercase tracking-[.17em] text-[#c99578]">
          <Crosshair size={12} /> The execution script
        </p>
        <p className="mono text-[8px] uppercase tracking-[.12em] text-[#6f847f]">one match · one trace</p>
      </div>
      <ol className="px-4 py-4 sm:px-6">
        {verdict.trace.map((line, index) => {
          const isGoal = /^\d+'/.test(line);
          const isFullTime = line.startsWith('Full time');
          return (
            <li
              key={`${index}-${line.slice(0, 12)}`}
              className={`border-b border-[#243746] py-2 text-[11px] leading-6 last:border-0 ${
                isGoal ? 'font-semibold text-[#f0d4c4]' : isFullTime ? 'font-extrabold text-white' : 'text-[#b9c8c1]'
              }`}
              data-testid={`trace-line-${index}`}
            >
              {line}
            </li>
          );
        })}
      </ol>
      <div className="flex items-start gap-2 border-t border-[#2c4152] bg-[#16242f] px-4 py-3 sm:px-6">
        <Skull size={13} className="mt-0.5 shrink-0 text-[#c99578]" />
        <p className="text-[10px] leading-5 text-[#a9bab2]">
          <span className="font-bold uppercase tracking-[.1em] text-[#c99578]">Kill-condition — </span>
          {verdict.killCondition}
        </p>
      </div>
    </section>
  );
}
