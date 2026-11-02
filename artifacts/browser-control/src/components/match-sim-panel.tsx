import { useMemo, useRef, useState } from 'react';
import { Maximize2, MonitorPlay, RotateCcw } from 'lucide-react';

// Clubs arrive from the fixture feed as names only, so each side gets a stable
// kit colour derived from its name. The same club therefore always plays in the
// same colours, and the two sides never share one.
const KIT_COLOURS = [
  0xc8102e, 0x12327a, 0x0f7b4b, 0xd8a012, 0x5b2d8e,
  0x0b6fa4, 0xb84a1f, 0x2f6f4f, 0x8a1c3b, 0x1f2b38,
];

function kitColour(name: string) {
  let hash = 7;
  for (const character of name.trim().toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1_000_003;
  }
  return KIT_COLOURS[hash % KIT_COLOURS.length];
}

const hex = (colour: number) => colour.toString(16).padStart(6, '0');

export function MatchSimPanel({ home, away, venue }: { home: string; away: string; venue?: string | null }) {
  const [generation, setGeneration] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);

  const source = useMemo(() => {
    let homeColour = kitColour(home);
    const awayColour = kitColour(away);
    if (awayColour === homeColour) homeColour = KIT_COLOURS[(KIT_COLOURS.indexOf(homeColour) + 3) % KIT_COLOURS.length];

    const params = new URLSearchParams({
      home,
      away,
      homeColour: hex(homeColour),
      awayColour: hex(awayColour),
    });
    if (venue) params.set('venue', venue);
    return `${import.meta.env.BASE_URL}sim.html?${params.toString()}`;
  }, [home, away, venue]);

  const restart = () => setGeneration((value) => value + 1);

  const goFullscreen = () => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <section
      ref={shellRef}
      className="mt-5 overflow-hidden rounded-[16px] border border-[#253746] bg-[#111c28] shadow-[0_18px_50px_rgba(23,35,45,.18)]"
      aria-label="Live match simulation"
      data-testid="panel-match-simulation"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2c4152] bg-[#1b2b38] px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-[#22384a] text-[#8fb7a4]"><MonitorPlay size={14} /></span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[10px] font-extrabold tracking-[-.01em] text-[#eaf2ee]">
              <span className="size-1.5 rounded-full bg-[#7bc4a2]" /> Live simulation
            </p>
            <p className="mono truncate text-[8px] uppercase tracking-[.13em] text-[#89a3a0]">
              {home} v {away}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={restart}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#334b5d] bg-[#22384a] px-2.5 text-[9px] font-extrabold text-[#c9dcd4] transition hover:bg-[#2a4457]"
            data-testid="button-sim-restart"
          >
            <RotateCcw size={11} /> Restart
          </button>
          <button
            type="button"
            onClick={goFullscreen}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#334b5d] bg-[#22384a] px-2.5 text-[9px] font-extrabold text-[#c9dcd4] transition hover:bg-[#2a4457]"
            data-testid="button-sim-fullscreen"
          >
            <Maximize2 size={11} /> Full screen
          </button>
        </div>
      </div>

      <div className="relative aspect-video max-h-[70vh] w-full bg-black">
        <iframe
          key={generation}
          src={source}
          title={`${home} v ${away} — live match simulation`}
          className="absolute inset-0 size-full border-0"
          allow="autoplay; fullscreen"
          data-testid="iframe-match-simulation"
        />
      </div>

      <p className="border-t border-[#2c4152] bg-[#16242f] px-4 py-2 text-[9px] leading-4 text-[#8ba39c] sm:px-5">
        KICK OFF starts the match. Cameras, playback speed and BE A PLAYER sit in the dock; move with WASD, pass with space, shoot with F, slide in with X.
      </p>
    </section>
  );
}
