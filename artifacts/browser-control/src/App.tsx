import { type FormEvent, type MouseEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  useActivateBrowserTab,
  useCloseBrowserSession,
  useCloseBrowserTab,
  useCreateBrowserSession,
  useCreateBrowserTab,
  getGetBrowserSessionQueryKey,
  useGetBrowserSession,
  useHealthCheck,
  useMoveBrowserMouse,
  useNavigateBrowser,
  usePerformBrowserAction,
  type BrowserActionInput,
  type BrowserState,
} from '@workspace/api-client-react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Camera,
  Check,
  CalendarDays,
  CircleAlert,
  Globe2,
  Keyboard,
  LoaderCircle,
  LockKeyhole,
  MousePointer2,
  Plus,
  RefreshCw,
  ShieldCheck,
  StopCircle,
  X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import FixturesPage from '@/pages/fixtures';
import MatchDetailsPage from '@/pages/match-details';
import ProcessingPage from '@/pages/processing';
import DatabasePage, { TesterPage } from '@/pages/database';
import ModelTrainingPage from '@/pages/model-training';

const queryClient = new QueryClient();

type OutputMode = 'screenshot' | 'markdown' | 'text' | 'json' | 'links';
const OUTPUT_MODES: { id: OutputMode; label: string }[] = [
  { id: 'screenshot', label: 'Screenshot' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'text', label: 'Text' },
  { id: 'json', label: 'JSON' },
  { id: 'links', label: 'Links' },
];
const SYNCED_TAB_LIMIT = 25;
type BrowserPoint = { x: number; y: number };

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function SyncTabsOption({
  checked,
  onChange,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <label className={`flex min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2 ${checked ? 'border-[#bdd0c3] bg-[#edf3ed]' : 'border-[#deddd4] bg-[#f9f8f3]'} ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-0.5 size-3.5 shrink-0 accent-[#d96f51]"
        data-testid={testId}
      />
      <span className="min-w-0">
        <span className="block text-[10px] font-extrabold text-[#536763]">Sync activity across up to {SYNCED_TAB_LIMIT} tabs</span>
        <span className="mt-0.5 block text-[9px] leading-4 text-[#858982]">
          {checked ? 'Navigation opens copies; clicks, typing, and scrolling are mirrored.' : 'Off: actions affect only the active tab.'}
        </span>
      </span>
    </label>
  );
}

function getOutputText(state: BrowserState, mode: OutputMode) {
  switch (mode) {
    case 'markdown':
      return state.pageContent.markdown;
    case 'text':
      return state.pageContent.text;
    case 'json':
      return JSON.stringify({
        title: state.title,
        url: state.currentUrl,
        description: state.pageContent.description,
        headings: state.pageContent.headings,
        text: state.pageContent.text,
        markdown: state.pageContent.markdown,
        links: state.pageContent.links,
      }, null, 2);
    case 'links':
      return state.pageContent.links
        .map((link) => `${link.text} — ${link.href}`)
        .join('\n');
    default:
      return '';
  }
}

function readableError(error: unknown) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (typeof error === 'object' && 'error' in error && typeof error.error === 'string') return error.error;
  return 'The browser could not complete that request. Try again.';
}

function BrowserConsole() {
  const client = useQueryClient();
  const health = useHealthCheck();
  const [sessionId, setSessionId] = useState('');
  const [address, setAddress] = useState('');
  const [typeText, setTypeText] = useState('');
  const [keyText, setKeyText] = useState('');
  const [showKeyControls, setShowKeyControls] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>('screenshot');
  const [syncTabs, setSyncTabs] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [pointerPosition, setPointerPosition] = useState<BrowserPoint | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const outputPanelRef = useRef<HTMLDivElement>(null);
  const pointerPositionRef = useRef<BrowserPoint | null>(null);
  const pendingMousePositionRef = useRef<BrowserPoint | null>(null);
  const mouseMoveWorkerRef = useRef<Promise<void> | null>(null);
  const lastRemoteMousePositionRef = useRef<BrowserPoint | null>(null);
  const sessionQueryKey = getGetBrowserSessionQueryKey(sessionId);
  const createSession = useCreateBrowserSession();
  const closeSession = useCloseBrowserSession();
  const navigate = useNavigateBrowser();
  const performAction = usePerformBrowserAction();
  const moveMouse = useMoveBrowserMouse();
  const createTab = useCreateBrowserTab();
  const activateTab = useActivateBrowserTab();
  const closeTab = useCloseBrowserTab();

  const busy = createSession.isPending || closeSession.isPending || navigate.isPending ||
    performAction.isPending || createTab.isPending || activateTab.isPending || closeTab.isPending;
  const sessionQuery = useGetBrowserSession(sessionId, {
    query: {
      enabled: Boolean(sessionId),
      queryKey: sessionQueryKey,
      refetchInterval: outputMode === 'screenshot' && !busy ? 500 : false,
    },
  });
  const state = sessionQuery.data as BrowserState | undefined;
  const activeTab = state?.tabs.find((tab) => tab.id === state.activeTabId) ?? state?.tabs.find((tab) => tab.active);
  const outputText = state ? getOutputText(state, outputMode) : '';

  useEffect(() => {
    if (state?.currentUrl) setAddress(state.currentUrl);
  }, [state?.currentUrl]);

  const acceptState = (next: BrowserState) => {
    setSessionId(next.sessionId);
    client.setQueryData(getGetBrowserSessionQueryKey(next.sessionId), next);
  };
  const sendAction = (data: BrowserActionInput) => {
    if (!sessionId || busy) return;
    performAction.mutate({ sessionId, data: { ...data, syncTabs } }, { onSuccess: acceptState });
  };

  const pumpMouseMoves = (): Promise<void> => {
    if (mouseMoveWorkerRef.current) return mouseMoveWorkerRef.current;
    if (!sessionId || !pendingMousePositionRef.current) return Promise.resolve();

    const moveSessionId = sessionId;
    const worker = (async () => {
      while (pendingMousePositionRef.current) {
        const point = pendingMousePositionRef.current;
        pendingMousePositionRef.current = null;
        const last = lastRemoteMousePositionRef.current;
        if (last?.x === point.x && last.y === point.y) continue;
        try {
          await moveMouse.mutateAsync({
            sessionId: moveSessionId,
            data: { ...point, syncTabs },
          });
          lastRemoteMousePositionRef.current = point;
        } catch {
          pendingMousePositionRef.current = null;
          break;
        }
      }
    })();

    mouseMoveWorkerRef.current = worker;
    void worker.finally(() => {
      if (mouseMoveWorkerRef.current === worker) mouseMoveWorkerRef.current = null;
      if (pendingMousePositionRef.current) void pumpMouseMoves();
    });
    return worker;
  };

  const queueMouseMove = (point: BrowserPoint): Promise<void> => {
    pendingMousePositionRef.current = point;
    return pumpMouseMoves();
  };

  const flushMouseMoves = async () => {
    while (mouseMoveWorkerRef.current || pendingMousePositionRef.current) {
      if (!mouseMoveWorkerRef.current) {
        void pumpMouseMoves();
      }
      const worker = mouseMoveWorkerRef.current;
      if (worker) await worker;
      else break;
    }
  };

  const getBrowserPoint = (clientX: number, clientY: number): BrowserPoint | null => {
    if (!state) return null;
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 ||
        clientX < rect.left || clientX > rect.right ||
        clientY < rect.top || clientY > rect.bottom) return null;
    return {
      x: Math.max(0, Math.min(state.viewportWidth - 1, Math.round(((clientX - rect.left) / rect.width) * state.viewportWidth))),
      y: Math.max(0, Math.min(state.viewportHeight - 1, Math.round(((clientY - rect.top) / rect.height) * state.viewportHeight))),
    };
  };

  const onStart = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const url = normalizeUrl(address);
    createSession.mutate({
      data: {
        ...(url ? { url } : {}),
        ...(url && syncTabs ? { tabCount: SYNCED_TAB_LIMIT } : {}),
      },
    }, {
      onSuccess: (next) => {
        acceptState(next);
        setAddress(next.currentUrl);
      },
    });
  };

  const onNavigate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = normalizeUrl(address);
    if (!sessionId || !url || busy) return;
    navigate.mutate({
      sessionId,
      data: {
        url,
        syncTabs,
        ...(syncTabs ? { tabCount: SYNCED_TAB_LIMIT } : {}),
      },
    }, { onSuccess: acceptState });
  };

  const changeSyncTabs = (enabled: boolean) => {
    setSyncTabs(enabled);
    if (
      !enabled ||
      !sessionId ||
      !state?.currentUrl ||
      !/^https?:\/\//i.test(state.currentUrl) ||
      busy
    ) {
      return;
    }
    setAddress(state.currentUrl);
    navigate.mutate({
      sessionId,
      data: {
        url: state.currentUrl,
        syncTabs: true,
        tabCount: SYNCED_TAB_LIMIT,
      },
    }, { onSuccess: acceptState });
  };

  const onNewTab = () => {
    if (!sessionId || busy) return;
    createTab.mutate({ sessionId, data: { url: 'about:blank' } }, { onSuccess: acceptState });
  };

  const onCloseSession = () => {
    if (!sessionId || busy) return;
    closeSession.mutate({ sessionId }, {
      onSuccess: () => {
        client.removeQueries({ queryKey: getGetBrowserSessionQueryKey(sessionId) });
        setSessionId('');
        setAddress('');
        setTypeText('');
        setKeyText('');
        setSyncTabs(false);
      },
    });
  };

  const updatePointerPosition = (point: BrowserPoint) => {
    pointerPositionRef.current = point;
    setPointerPosition(point);
    void queueMouseMove(point);
  };

  const trackPreviewPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!state || busy) return;
    const point = getBrowserPoint(event.clientX, event.clientY);
    if (point) updatePointerPosition(point);
  };

  const clickPreview = async (event: MouseEvent<HTMLImageElement>) => {
    if (!state || busy) return;
    const point = getBrowserPoint(event.clientX, event.clientY);
    if (!point) return;
    updatePointerPosition(point);
    await flushMouseMoves();
    sendAction({ action: 'click', x: point.x, y: point.y });
  };

  const scrollPreview = async (event: globalThis.WheelEvent) => {
    event.preventDefault();
    if (!state || busy) return;
    const point = getBrowserPoint(event.clientX, event.clientY) ?? pointerPositionRef.current;
    if (!point) return;
    updatePointerPosition(point);
    await flushMouseMoves();
    sendAction({
      action: 'scroll',
      x: point.x,
      y: point.y,
      deltaY: Math.max(-5000, Math.min(5000, Math.round(event.deltaY))),
    });
  };

  useEffect(() => {
    const panel = outputPanelRef.current;
    if (!panel || outputMode !== 'screenshot') return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      void scrollPreview(event);
    };
    panel.addEventListener('wheel', handleWheel, { passive: false });
    return () => panel.removeEventListener('wheel', handleWheel);
  }, [outputMode, scrollPreview]);

  const submitType = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!typeText || busy) return;
    sendAction({ action: 'type', text: typeText });
    setTypeText('');
  };

  const scrollPage = (deltaY: number) => {
    if (!state || busy) return;
    const point = pointerPositionRef.current ?? {
      x: Math.round(state.viewportWidth / 2),
      y: Math.round(state.viewportHeight / 2),
    };
    pointerPositionRef.current = point;
    setPointerPosition(point);
    sendAction({ action: 'scroll', x: point.x, y: point.y, deltaY });
  };

  const submitKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!keyText || busy) return;
    sendAction({ action: 'key', key: keyText });
    setKeyText('');
  };

  const saveScreenshot = () => {
    if (!state?.screenshot) return;
    const link = document.createElement('a');
    link.href = state.screenshot;
    link.download = `browser-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    link.click();
  };

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(outputText);
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Copy failed');
    }
    window.setTimeout(() => setCopyStatus(''), 1500);
  };

  const openExtractedLink = (url: string) => {
    if (!sessionId || busy) return;
    setAddress(url);
    navigate.mutate({
      sessionId,
      data: {
        url,
        syncTabs,
        ...(syncTabs ? { tabCount: SYNCED_TAB_LIMIT } : {}),
      },
    }, { onSuccess: acceptState });
  };

  const primaryError = readableError(createSession.error) || readableError(closeSession.error) ||
    readableError(navigate.error) || readableError(performAction.error) || readableError(moveMouse.error) ||
    readableError(createTab.error) || readableError(activateTab.error) || readableError(closeTab.error) ||
    readableError(sessionQuery.error);

  return (
    <main className="screen-noise min-h-[100dvh] bg-[#f2f0e8] text-[#243443]">
      <header className="relative z-10 border-b border-[#d9d8cf] bg-[#f7f5ef]">
        <div className="mx-auto flex min-h-[72px] max-w-[1540px] items-center justify-between gap-5 px-4 sm:px-7 lg:px-10">
          <div className="flex items-center gap-3.5">
            <div className="grid size-10 place-items-center rounded-[13px] bg-[#253746] text-[#f8f2e7] shadow-sm" aria-hidden="true">
              <Globe2 size={20} strokeWidth={1.8} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-[15px] font-extrabold tracking-[-.04em]">Browser Control</span>
                <span className="rounded-full border border-[#deddd3] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.16em] text-[#7e827d]">Remote session</span>
              </div>
              <p className="mt-0.5 hidden text-[11px] text-[#858780] sm:block">A real browser, operated from here.</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5" aria-live="polite">
            <nav aria-label="Main navigation" className="mr-2 flex flex-wrap items-center gap-1 rounded-xl border border-[#deddd3] bg-[#efeee7] p-1">
              <Link href="/" aria-current="page" className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#253746] px-3 text-[10px] font-extrabold text-[#f8f2e7] shadow-sm" data-testid="link-browser-home">
                <Globe2 size={13} /> <span>Browser</span>
              </Link>
              <Link href="/fixtures" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] transition hover:bg-[#fbfaf6] hover:text-[#344550]" data-testid="link-fixtures">
                <CalendarDays size={13} /> <span>Fixtures</span>
              </Link>
              <Link href="/processing" className="inline-flex h-8 items-center rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] transition hover:bg-[#fbfaf6] hover:text-[#344550]" data-testid="link-processing">Processing</Link>
              <Link href="/database" className="inline-flex h-8 items-center rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] transition hover:bg-[#fbfaf6] hover:text-[#344550]" data-testid="link-database">Database</Link>
              <Link href="/model-training" className="inline-flex h-8 items-center rounded-lg px-3 text-[10px] font-extrabold text-[#64716d] transition hover:bg-[#fbfaf6] hover:text-[#344550]" data-testid="link-model-training">Model training</Link>
            </nav>
            <span className={`relative flex size-2.5 rounded-full ${health.isError ? 'bg-[#c76c5c]' : health.isLoading ? 'bg-[#d59a42]' : 'bg-[#4d997e]'}`}>
              {health.isLoading && <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-30" />}
            </span>
            <span className="text-[11px] font-semibold text-[#68716e]" data-testid="status-api">
              {health.isLoading ? 'Checking service' : health.isError ? 'Service unavailable' : 'Service ready'}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1540px] px-4 pb-10 pt-7 sm:px-7 sm:pt-9 lg:px-10">
        <div className="animate-rise mb-6 flex flex-col justify-between gap-4 sm:mb-8 sm:flex-row sm:items-end">
          <div>
            <p className="mono mb-2 text-[10px] uppercase tracking-[.19em] text-[#9b7160]">Hands-on browsing console</p>
            <h1 className="text-[26px] font-extrabold leading-tight tracking-[-.055em] sm:text-[34px]">Your browser, at a distance.</h1>
            <p className="mt-2 max-w-[610px] text-[13px] leading-6 text-[#727973]">
              Open a live Chromium session and work through the page directly. No extensions or third-party integrations.
            </p>
          </div>
          {state && (
            <div className="flex items-center gap-2 self-start rounded-lg border border-[#dcd9d0] bg-[#faf9f5] px-3 py-2 sm:self-auto">
              <span className="size-1.5 rounded-full bg-[#4d997e]" />
              <span className="mono text-[10px] text-[#66716f]" data-testid="text-session-id">
                SESSION / {state.sessionId.slice(0, 8).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {health.isError && (
          <section className="mb-5 flex items-start gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] px-4 py-3.5 text-sm" role="alert" data-testid="status-health-error">
            <CircleAlert size={17} className="mt-0.5 shrink-0 text-[#b85b46]" />
            <div className="min-w-0">
              <p className="font-bold text-[#784b3e]">Browser service is not responding.</p>
              <p className="mt-1 text-xs leading-5 text-[#8c6b5e]">Starting a session is unavailable until the service comes back online. Your page state is not stored in this interface.</p>
            </div>
          </section>
        )}

        {primaryError && !health.isError && (
          <section className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] px-4 py-3.5 text-sm" role="alert" data-testid="status-action-error">
            <div className="flex gap-3">
              <CircleAlert size={17} className="mt-0.5 shrink-0 text-[#b85b46]" />
              <div>
                <p className="font-bold text-[#784b3e]">That action did not go through.</p>
                <p className="mt-1 text-xs leading-5 text-[#8c6b5e]">{primaryError}</p>
              </div>
            </div>
            {sessionId && <button className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-[#855542] hover:bg-[#f6e8df]" onClick={() => sessionQuery.refetch()} data-testid="button-retry-session">Retry state</button>}
          </section>
        )}

        {!state ? (
          <section className="animate-rise overflow-hidden rounded-[20px] border border-[#d6d5cc] bg-[#f9f8f3] shadow-[0_20px_70px_rgba(47,59,64,.07)]" data-testid="section-session-empty">
            <div className="grid lg:grid-cols-[1fr_370px]">
              <div className="relative flex min-h-[350px] flex-col justify-between overflow-hidden p-6 sm:p-10 lg:min-h-[425px]">
                <div className="absolute -right-12 -top-14 size-[310px] rounded-full border border-[#e5e2d8] sm:size-[430px]" aria-hidden="true" />
                <div className="absolute -right-3 top-[-4px] size-[230px] rounded-full border border-[#e5e2d8] sm:size-[330px]" aria-hidden="true" />
                <div className="relative z-[1]">
                  <div className="mb-7 flex size-12 items-center justify-center rounded-2xl bg-[#e6eee8] text-[#397b67]">
                    <Globe2 size={22} />
                  </div>
                  <span className="mono text-[10px] uppercase tracking-[.17em] text-[#8e7770]">Session not started</span>
                  <h2 className="mt-3 max-w-[530px] text-[30px] font-extrabold leading-[1.12] tracking-[-.055em] sm:text-[43px]">A clean window into the web.</h2>
                  <p className="mt-4 max-w-[490px] text-[13px] leading-6 text-[#767b75]">
                    Start Chromium with an optional destination. Navigate, click, type, and move between tabs from one focused workspace.
                  </p>
                </div>
                <div className="relative z-[1] mt-10 flex flex-wrap gap-x-6 gap-y-3 text-[11px] font-semibold text-[#7d827d]">
                  <span className="flex items-center gap-2"><ShieldCheck size={14} className="text-[#4d997e]" /> Isolated browser session</span>
                  <span className="flex items-center gap-2"><LockKeyhole size={14} className="text-[#4d997e]" /> No third-party sign-in</span>
                </div>
              </div>
              <div className="border-t border-[#e1dfd7] bg-[#f1f0e9] p-5 sm:p-7 lg:border-l lg:border-t-0">
                <div className="mb-5">
                  <p className="mono text-[10px] uppercase tracking-[.17em] text-[#9a7867]">Begin a session</p>
                  <h3 className="mt-2 text-[18px] font-extrabold tracking-[-.035em]">Where to?</h3>
                </div>
                <form onSubmit={onStart} className="space-y-3">
                  <label htmlFor="start-url" className="block text-[11px] font-bold text-[#56605e]">Starting address <span className="font-medium text-[#969993]">(optional)</span></label>
                  <div className="relative">
                    <ArrowUpRight size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#89918b]" />
                    <input id="start-url" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="example.com" autoComplete="url" className="h-12 w-full rounded-lg border border-[#d5d5cc] bg-[#fbfaf6] pl-10 pr-3 text-[13px] text-[#263746] placeholder:text-[#aaa99f] focus:border-[#d97b5c] focus:outline-none focus:ring-2 focus:ring-[#d97b5c]/15" data-testid="input-start-url" />
                  </div>
                  <SyncTabsOption
                    checked={syncTabs}
                    onChange={changeSyncTabs}
                    disabled={busy}
                    testId="toggle-sync-tabs-start"
                  />
                  <p className="text-[10px] leading-[1.65] text-[#858982]">You can enter a domain or a complete URL. Sites may block automated browsing.</p>
                  <button type="submit" disabled={busy} className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#d96f51] px-4 text-[12px] font-extrabold text-white shadow-[0_5px_12px_rgba(173,79,52,.16)] transition hover:bg-[#c95f43] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-start-session">
                    {createSession.isPending ? <><LoaderCircle size={15} className="animate-spin" /> {syncTabs ? 'Opening 25 synced tabs…' : 'Opening browser…'}</> : <>Start browser session <ArrowRight size={15} /></>}
                  </button>
                </form>
                <div className="mt-6 border-t border-[#dddbd2] pt-4">
                  <p className="flex items-start gap-2 text-[10px] leading-[1.65] text-[#838881]">
                    <LockKeyhole size={13} className="mt-0.5 shrink-0 text-[#9a7867]" />
                    Private and internal network destinations are blocked for safety.
                  </p>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="animate-rise overflow-hidden rounded-[17px] border border-[#c9cbc5] bg-[#e8e8e1] shadow-[0_22px_65px_rgba(39,53,62,.12)]" aria-label="Remote browser workspace">
            <div className="browser-shell flex min-h-[46px] items-center justify-between px-4 sm:px-5">
              <div className="flex items-center gap-2.5">
                <span className="flex gap-1.5" aria-hidden="true"><span className="size-2 rounded-full bg-[#d87859]" /><span className="size-2 rounded-full bg-[#e1b457]" /><span className="size-2 rounded-full bg-[#64a287]" /></span>
                <span className="ml-1 text-[10px] font-semibold tracking-wide text-[#d0d8d9]">REMOTE CHROMIUM</span>
              </div>
              <div className="mono text-[9px] uppercase tracking-[.14em] text-[#9cabb0]">Live viewport</div>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto border-b border-[#c9cbc5] bg-[#f4f3ed] px-3 pt-2 sm:px-4">
              {state.tabs.map((tab) => (
                <div key={tab.id} className={`group flex h-9 min-w-[122px] max-w-[230px] items-center rounded-t-lg border border-b-0 px-2 ${tab.id === state.activeTabId ? 'border-[#c9cbc5] bg-[#e8e8e1]' : 'border-transparent bg-transparent hover:bg-[#ecebe4]'}`} data-testid={`tab-browser-${tab.id}`}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => sessionId && activateTab.mutate({ sessionId, tabId: tab.id }, { onSuccess: acceptState })} disabled={busy} aria-label={`Switch to ${tab.title || 'untitled tab'}`} aria-pressed={tab.id === state.activeTabId} data-testid={`button-activate-tab-${tab.id}`}>
                    <span className={`size-1.5 shrink-0 rounded-full ${tab.id === state.activeTabId ? 'bg-[#d96f51]' : 'bg-[#b4b9b2]'}`} />
                    <span className="truncate text-[10px] font-bold text-[#52605f]">{tab.title || tab.url || 'New tab'}</span>
                  </button>
                  <button type="button" onClick={() => sessionId && closeTab.mutate({ sessionId, tabId: tab.id }, { onSuccess: acceptState })} disabled={busy || state.tabs.length <= 1} className="ml-1 grid size-6 shrink-0 place-items-center rounded-md text-[#89908a] opacity-70 hover:bg-[#d9d9d1] hover:text-[#344550] disabled:cursor-not-allowed disabled:opacity-25 sm:opacity-0 sm:group-hover:opacity-100" aria-label={`Close ${tab.title || 'untitled tab'}`} data-testid={`button-close-tab-${tab.id}`}>
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={onNewTab} disabled={busy} className="ml-1 grid size-8 shrink-0 place-items-center rounded-lg text-[#65716e] hover:bg-[#ddded7] disabled:opacity-40" aria-label="Open new tab" title="Open new tab" data-testid="button-new-tab"><Plus size={16} /></button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-[#d1d1c9] bg-[#f7f6f1] px-3 py-2.5 sm:px-4">
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={() => sendAction({ action: 'back' })} disabled={busy} className="grid size-8 place-items-center rounded-lg text-[#596663] hover:bg-[#e8e8e1] disabled:opacity-40" title="Go back" aria-label="Go back" data-testid="button-browser-back"><ArrowLeft size={16} /></button>
                <button type="button" onClick={() => sendAction({ action: 'forward' })} disabled={busy} className="grid size-8 place-items-center rounded-lg text-[#596663] hover:bg-[#e8e8e1] disabled:opacity-40" title="Go forward" aria-label="Go forward" data-testid="button-browser-forward"><ArrowRight size={16} /></button>
                <button type="button" onClick={() => sendAction({ action: 'reload' })} disabled={busy} className="grid size-8 place-items-center rounded-lg text-[#596663] hover:bg-[#e8e8e1] disabled:opacity-40" title="Reload page" aria-label="Reload page" data-testid="button-browser-reload"><RefreshCw size={15} className={performAction.isPending ? 'animate-spin' : ''} /></button>
              </div>
              <form onSubmit={onNavigate} className="flex min-w-[200px] flex-1 items-center">
                <div className="relative w-full">
                  <LockKeyhole size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7e8d82]" aria-hidden="true" />
                  <input aria-label="Address" value={address} onChange={(event) => setAddress(event.target.value)} className="h-9 w-full rounded-lg border border-[#d5d6ce] bg-[#eeede7] pl-9 pr-[78px] text-[11px] text-[#3b4d56] placeholder:text-[#8d9690] focus:border-[#d97b5c] focus:bg-[#fbfaf6] focus:outline-none" placeholder="Enter a web address" data-testid="input-address" />
                  <button type="submit" disabled={busy || !address.trim()} className="absolute right-1 top-1/2 h-7 -translate-y-1/2 rounded-md bg-[#dfe8e1] px-2.5 text-[10px] font-extrabold text-[#416a5d] hover:bg-[#d2e0d5] disabled:opacity-40" data-testid="button-navigate">Go</button>
                </div>
              </form>
              <SyncTabsOption
                checked={syncTabs}
                onChange={changeSyncTabs}
                disabled={busy}
                testId="toggle-sync-tabs"
              />
              <button type="button" onClick={saveScreenshot} disabled={!state.screenshot} className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#d2d4cc] bg-[#fbfaf6] px-3 text-[10px] font-bold text-[#586663] hover:bg-white disabled:cursor-not-allowed disabled:opacity-45" title="Save screenshot as PNG" data-testid="button-save-screenshot">
                <Camera size={14} /> <span className="hidden sm:inline">Save capture</span>
              </button>
              <button type="button" onClick={onCloseSession} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-bold text-[#9a5d4c] hover:bg-[#f4e7df] disabled:opacity-40" data-testid="button-close-session">
                {closeSession.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <StopCircle size={14} />}
                <span className="hidden sm:inline">End session</span>
              </button>
            </div>

            <div className="grid min-h-[500px] lg:grid-cols-[minmax(0,1fr)_270px]">
              <div className="flex min-h-[380px] flex-col border-b border-[#d1d1c9] lg:border-b-0 lg:border-r">
                <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[#d2d2ca] px-3 sm:px-5">
                  <div className="min-w-0 truncate text-[10px] font-semibold text-[#67716d]" data-testid="text-page-title">{state.title || activeTab?.title || 'Untitled page'}</div>
                  <div className="mono shrink-0 text-[9px] text-[#91968e]" data-testid="text-viewport-size">{state.viewportWidth} × {state.viewportHeight}</div>
                </div>
                <div className="flex min-h-11 items-center justify-between gap-2 border-b border-[#d2d2ca] bg-[#f4f3ed] px-2 sm:px-4">
                  <div role="tablist" aria-label="Page output format" className="flex min-w-0 items-center gap-1 overflow-x-auto py-1">
                    {OUTPUT_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        role="tab"
                        aria-selected={outputMode === mode.id}
                        aria-controls="browser-output-panel"
                        onClick={() => { setOutputMode(mode.id); setCopyStatus(''); }}
                        className={`shrink-0 rounded-md px-2.5 py-1.5 text-[10px] font-bold transition sm:px-3 ${outputMode === mode.id ? 'bg-[#dfe8e1] text-[#416a5d]' : 'text-[#737c76] hover:bg-[#e9e9e2] hover:text-[#394b50]'}`}
                        data-testid={`tab-output-${mode.id}`}
                      >
                        {mode.label}{mode.id === 'links' ? ` (${state.pageContent.links.length})` : ''}
                      </button>
                    ))}
                  </div>
                  {outputMode !== 'screenshot' && (
                    <button
                      type="button"
                      onClick={copyOutput}
                      disabled={!outputText}
                      className="shrink-0 rounded-md border border-[#d5d6ce] bg-[#fbfaf6] px-2.5 py-1.5 text-[10px] font-bold text-[#596963] hover:bg-white disabled:opacity-40"
                      title="Copy the selected output"
                      data-testid="button-copy-output"
                    >
                      {copyStatus || 'Copy output'}
                    </button>
                  )}
                </div>
                <div
                  ref={outputPanelRef}
                  id="browser-output-panel"
                  role="tabpanel"
                  aria-label={`${OUTPUT_MODES.find((mode) => mode.id === outputMode)?.label ?? 'Page'} output`}
                  className={`flex flex-1 overflow-auto p-3 sm:p-5 lg:p-7 ${outputMode === 'screenshot' ? 'items-center justify-center bg-[#dadbd5]' : 'items-start bg-[#eeede7]'}`}
                >
                  {outputMode === 'screenshot' ? (
                    state.screenshot ? (
                      <div className="relative inline-block w-full" onPointerMove={trackPreviewPointer} onPointerLeave={() => setPointerPosition(null)}>
                        <img ref={imageRef} src={state.screenshot} alt={`Remote browser showing ${state.currentUrl || 'the current page'}`} onClick={clickPreview} draggable={false} className="block h-auto max-h-[calc(100dvh-260px)] w-full cursor-none object-contain shadow-[0_8px_24px_rgba(35,49,53,.17)]" data-testid="img-browser-screenshot" />
                        {pointerPosition && (
                          <MousePointer2
                            aria-hidden="true"
                            className="pointer-events-none absolute z-10 size-5 -translate-x-px -translate-y-px fill-white stroke-[#243443] drop-shadow-md"
                            style={{
                              left: `${(pointerPosition.x / state.viewportWidth) * 100}%`,
                              top: `${(pointerPosition.y / state.viewportHeight) * 100}%`,
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="flex min-h-[280px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-[#c0c4bd] bg-[#e3e4de] px-6 text-center">
                        <div className="mb-4 grid size-11 place-items-center rounded-2xl bg-[#d8e4dc] text-[#487866]"><Globe2 size={21} /></div>
                        <p className="text-[14px] font-extrabold tracking-[-.025em] text-[#53615e]">This tab is ready when you are.</p>
                        <p className="mt-1.5 max-w-[300px] text-[11px] leading-5 text-[#7c8580]">Enter an address above to load a page. The screenshot will appear here.</p>
                      </div>
                    )
                  ) : outputMode === 'links' ? (
                    state.pageContent.links.length > 0 ? (
                      <div className="flex w-full flex-col gap-2" data-testid="list-page-links">
                        {state.pageContent.links.map((link, index) => (
                          <button
                            key={`${link.href}-${index}`}
                            type="button"
                            onClick={() => openExtractedLink(link.href)}
                            disabled={busy}
                            className="flex w-full items-center justify-between gap-4 rounded-lg border border-[#d9d9d1] bg-[#fbfaf6] px-3.5 py-3 text-left transition hover:border-[#c9d6cb] hover:bg-white disabled:opacity-50"
                            data-testid={`button-page-link-${index}`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[11px] font-bold text-[#485b58]">{link.text}</span>
                              <span className="mono mt-1 block break-all text-[9px] text-[#878e86]">{link.href}</span>
                            </span>
                            <ArrowUpRight size={14} className="shrink-0 text-[#668674]" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex min-h-[280px] w-full items-center justify-center rounded-xl border border-dashed border-[#c9cbc2] bg-[#f5f4ee] px-6 text-center text-[12px] text-[#7c8580]">
                        No links were found on this page.
                      </div>
                    )
                  ) : outputText ? (
                    <pre className="min-h-[280px] w-full whitespace-pre-wrap break-words rounded-xl border border-[#d9d9d1] bg-[#fbfaf6] p-4 text-[11px] leading-6 text-[#354b50] selection:bg-[#dfe8e1] sm:p-6" data-testid={`output-${outputMode}`}>{outputText}</pre>
                  ) : (
                    <div className="flex min-h-[280px] w-full items-center justify-center rounded-xl border border-dashed border-[#c9cbc2] bg-[#f5f4ee] px-6 text-center text-[12px] text-[#7c8580]">
                      No page content to show yet. Navigate to a website to extract its {outputMode === 'markdown' ? 'Markdown' : 'text'}.
                    </div>
                  )}
                </div>
                <div className="flex min-h-9 items-center justify-between border-t border-[#d2d2ca] bg-[#eeede7] px-3 text-[9px] text-[#848b83] sm:px-5">
                  <span className="flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${busy ? 'bg-[#d49b46]' : 'bg-[#4d997e]'}`} />{busy ? 'Applying browser action' : 'Move pointer, click, or scroll over page'}</span>
                  <span className="mono hidden sm:block">{state.currentUrl || 'about:blank'}</span>
                  <span className="hidden sm:block">Live screenshot · refreshes twice a second</span>
                </div>
              </div>

              <aside className="bg-[#f4f3ed] p-4 sm:p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="mono text-[9px] uppercase tracking-[.16em] text-[#9b7969]">Input controls</p>
                    <h3 className="mt-1 text-[15px] font-extrabold tracking-[-.03em]">Work the page</h3>
                  </div>
                  <Keyboard size={17} className="mt-1 text-[#71817b]" />
                </div>
                <p className="mt-2 text-[10px] leading-[1.65] text-[#838982]">Move the pointer over the page preview, click to interact, and scroll at its current position.</p>

                <div className="mt-4">
                  <p className="mb-1.5 text-[10px] font-bold text-[#5d6965]">Page scroll</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => scrollPage(-650)}
                      disabled={busy}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#d5d6ce] bg-[#fbfaf6] text-[10px] font-bold text-[#536763] transition hover:border-[#bfcfc4] hover:bg-white disabled:opacity-40"
                      aria-label="Scroll page up"
                      title="Scroll up about 650 pixels"
                      data-testid="button-scroll-up"
                    >
                      <ArrowUp size={14} /> Scroll up
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollPage(650)}
                      disabled={busy}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#d5d6ce] bg-[#fbfaf6] text-[10px] font-bold text-[#536763] transition hover:border-[#bfcfc4] hover:bg-white disabled:opacity-40"
                      aria-label="Scroll page down"
                      title="Scroll down about 650 pixels"
                      data-testid="button-scroll-down"
                    >
                      <ArrowDown size={14} /> Scroll down
                    </button>
                  </div>
                </div>

                <form onSubmit={submitType} className="mt-5">
                  <label htmlFor="type-text" className="mb-1.5 block text-[10px] font-bold text-[#5d6965]">Type text</label>
                  <div className="flex gap-1.5">
                    <input id="type-text" value={typeText} onChange={(event) => setTypeText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Text to enter…" className="h-9 min-w-0 flex-1 rounded-lg border border-[#d5d6ce] bg-[#fbfaf6] px-2.5 text-[10px] placeholder:text-[#a5a69c] focus:outline-none" data-testid="input-type-text" />
                    <button type="submit" disabled={busy || !typeText} className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#dfe8e1] text-[#416a5d] hover:bg-[#d2e0d5] disabled:opacity-40" aria-label="Type text into focused element" data-testid="button-send-text"><Check size={15} /></button>
                  </div>
                </form>

                <div className="mt-5 border-t border-[#deddd4] pt-4">
                  <button type="button" onClick={() => setShowKeyControls((shown) => !shown)} aria-expanded={showKeyControls} className="flex w-full items-center justify-between text-left text-[10px] font-bold text-[#5d6965]" data-testid="button-toggle-key-controls">
                    Send a key
                    <span className="mono text-[9px] font-normal text-[#959b93]">{showKeyControls ? 'HIDE' : 'SHOW'}</span>
                  </button>
                  {showKeyControls && (
                    <form onSubmit={submitKey} className="mt-2.5 flex gap-1.5">
                      <input value={keyText} onChange={(event) => setKeyText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Enter, Tab, Escape…" maxLength={50} className="h-9 min-w-0 flex-1 rounded-lg border border-[#d5d6ce] bg-[#fbfaf6] px-2.5 text-[10px] placeholder:text-[#a5a69c] focus:outline-none" aria-label="Key name to send" data-testid="input-key-name" />
                      <button type="submit" disabled={busy || !keyText} className="h-9 rounded-lg bg-[#dfe8e1] px-3 text-[10px] font-extrabold text-[#416a5d] hover:bg-[#d2e0d5] disabled:opacity-40" data-testid="button-send-key">Send</button>
                    </form>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {['Enter', 'Tab', 'Escape'].map((key) => (
                      <button type="button" key={key} onClick={() => sendAction({ action: 'key', key })} disabled={busy} className="rounded-md border border-[#d8d9d1] bg-[#f9f8f3] px-2 py-1 text-[9px] font-semibold text-[#6b7772] hover:bg-white disabled:opacity-40" data-testid={`button-quick-key-${key.toLowerCase()}`}>{key}</button>
                    ))}
                  </div>
                </div>

                <div className="mt-5 border-t border-[#deddd4] pt-4">
                  <p className="mb-2 text-[10px] font-bold text-[#5d6965]">Session details</p>
                  <dl className="space-y-2">
                    <div className="flex justify-between gap-2 text-[9px]">
                      <dt className="text-[#92978f]">Open tabs</dt><dd className="mono text-[#5e6a66]" data-testid="text-tab-count">{state.tabs.length}</dd>
                    </div>
                    <div className="flex justify-between gap-2 text-[9px]">
                      <dt className="text-[#92978f]">Viewport</dt><dd className="mono text-[#5e6a66]">{state.viewportWidth} × {state.viewportHeight}</dd>
                    </div>
                    <div className="flex justify-between gap-2 text-[9px]">
                      <dt className="text-[#92978f]">Connection</dt><dd className="flex items-center gap-1.5 font-semibold text-[#4d816d]"><span className="size-1.5 rounded-full bg-[#4d997e]" /> Live</dd>
                    </div>
                  </dl>
                </div>

                {sessionQuery.isError && (
                  <div className="mt-4 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] p-3 text-[10px] leading-5 text-[#8c6b5e]" role="alert">
                    Session state could not be refreshed.
                    <button type="button" onClick={() => sessionQuery.refetch()} className="ml-1 font-bold underline" data-testid="button-refresh-state">Retry</button>
                  </div>
                )}
              </aside>
            </div>
            {sessionQuery.isFetching && !busy && (
              <div className="flex h-8 items-center justify-center gap-2 border-t border-[#d1d1c9] bg-[#f4f3ed] text-[9px] font-semibold text-[#78817b]" role="status" data-testid="status-refreshing">
                <LoaderCircle size={12} className="animate-spin" /> Refreshing browser state
              </div>
            )}
          </section>
        )}

        <footer className="mt-5 flex flex-col justify-between gap-2 px-1 text-[10px] leading-5 text-[#8b8d84] sm:flex-row sm:items-center">
          <p className="flex items-start gap-2"><LockKeyhole size={12} className="mt-0.5 shrink-0" /> Websites can block automation or require sign-in. Private and internal network targets are blocked.</p>
          <p className="mono shrink-0 tracking-wide">BROWSER CONTROL <span className="text-[#c27d62]">/</span> CHROMIUM</p>
        </footer>
      </div>
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={BrowserConsole} />
        <Route path="/fixtures" component={FixturesPage} />
        <Route path="/matches/:fixtureId" component={MatchDetailsPage} />
        <Route path="/processing" component={ProcessingPage} />
        <Route path="/database" component={DatabasePage} />
        <Route path="/model-training" component={ModelTrainingPage} />
        <Route path="/tester" component={TesterPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
