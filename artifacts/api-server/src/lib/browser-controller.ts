import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { logger } from "./logger";
import {
  BrowserPolicyError,
  startSecureBrowserProxy,
  validatePublicWebUrl,
} from "./secure-browser-proxy";

const MAX_SESSIONS = 3;
const MAX_TABS_PER_SESSION = 8;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const VIEWPORT = { width: 1440, height: 900 };
const MAX_PAGE_TEXT_LENGTH = 50_000;
const MAX_PAGE_LINKS = 200;

export class BrowserOperationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "BrowserOperationError";
  }
}

type BrowserAction =
  | { action: "click"; x?: number; y?: number }
  | { action: "type"; text?: string }
  | { action: "key"; key?: string }
  | { action: "scroll"; deltaY?: number }
  | { action: "back" }
  | { action: "forward" }
  | { action: "reload" };

type BrowserSession = {
  id: string;
  context: BrowserContext;
  tabs: Map<string, Page>;
  activeTabId: string;
  lastUsedAt: number;
};

let browser: Browser | undefined;
let proxy: Awaited<ReturnType<typeof startSecureBrowserProxy>> | undefined;
const sessions = new Map<string, BrowserSession>();

async function ensureBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  try {
    proxy ??= await startSecureBrowserProxy();
    browser = await chromium.launch({
      headless: true,
      proxy: {
        server: proxy.url,
        bypass: "<-loopback>",
      },
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    return browser;
  } catch (error) {
    await proxy?.close().catch(() => undefined);
    proxy = undefined;
    browser = undefined;
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Chromium could not be started",
    );
    throw new BrowserOperationError(
      "Chromium is unavailable. The browser service could not start.",
      503,
    );
  }
}

function registerPage(
  session: BrowserSession,
  page: Page,
  activate = true,
): string {
  const tabId = randomUUID();
  session.tabs.set(tabId, page);
  if (activate) session.activeTabId = tabId;

  page.on("popup", (popup) => {
    registerPage(session, popup);
  });
  page.on("close", () => {
    session.tabs.delete(tabId);
    if (session.activeTabId === tabId) {
      session.activeTabId = session.tabs.keys().next().value ?? "";
    }
  });

  return tabId;
}

function getSession(sessionId: string): BrowserSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new BrowserOperationError(
      "This browser session has ended or expired.",
      404,
    );
  }
  session.lastUsedAt = Date.now();
  return session;
}

function getActivePage(session: BrowserSession): Page {
  const page = session.tabs.get(session.activeTabId);
  if (!page || page.isClosed()) {
    throw new BrowserOperationError(
      "The active browser tab is no longer available.",
      404,
    );
  }
  return page;
}

export async function getBrowserState(sessionId: string) {
  const session = getSession(sessionId);
  const activePage = getActivePage(session);
  const tabs = await Promise.all(
    Array.from(session.tabs, async ([id, page]) => ({
      id,
      url: page.isClosed() ? "" : page.url(),
      title: page.isClosed() ? "Closed tab" : await page.title().catch(() => ""),
      active: id === session.activeTabId,
    })),
  );
  const [screenshot, pageContent, title] = await Promise.all([
    activePage.screenshot({
      type: "png",
      animations: "disabled",
      timeout: 15_000,
    }),
    activePage.evaluate(() => {
      const doc = (globalThis as unknown as { document: any }).document;
      const getStyle = (
        globalThis as unknown as {
          getComputedStyle: (element: any) => any;
        }
      ).getComputedStyle;
      const normalize = (value: string) =>
        value
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      const body = doc.body;
      const isVisible = (element: any) => {
        const style = getStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.visibility !== "collapse" &&
          element.getClientRects().length > 0
        );
      };
      const text = normalize(body?.innerText ?? "").slice(
        0,
        50_000,
      );
      const description = normalize(
        doc
          .querySelector('meta[name="description"]')
          ?.getAttribute("content") ?? "",
      ).slice(0, 2_000);
      const headingElements = (
        Array.from(body?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? []) as any[]
      ).filter(isVisible);
      const headings = headingElements.slice(0, 100).flatMap((element) => {
        const headingText = normalize(element.innerText ?? "");
        if (!headingText) return [];
        return [
          {
            level: Number(element.tagName.slice(1)),
            text: headingText.slice(0, 500),
          },
        ];
      });

      const markdownBlocks = (
        Array.from(
          body?.querySelectorAll(
            "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre",
          ) ?? [],
        ) as any[]
      )
        .filter(isVisible)
        .flatMap((element) => {
          const tag = element.tagName.toLowerCase();
          if (
            (tag === "p" && element.parentElement?.closest("li,blockquote,pre")) ||
            (tag === "blockquote" &&
              element.parentElement?.closest("blockquote")) ||
            (tag === "pre" && element.parentElement?.closest("pre"))
          ) {
            return [];
          }
          const blockText = normalize(
            element.innerText ?? element.textContent ?? "",
          );
          if (!blockText) return [];
          if (/^h[1-6]$/.test(tag)) {
            return [`${"#".repeat(Number(tag.slice(1)))} ${blockText}`];
          }
          if (tag === "li") return [`- ${blockText}`];
          if (tag === "blockquote") {
            return [blockText.split("\n").map((line) => `> ${line}`).join("\n")];
          }
          if (tag === "pre") return [`\`\`\`\n${blockText}\n\`\`\``];
          return [blockText];
        });
      const markdown = (
        markdownBlocks.length > 0 ? markdownBlocks.join("\n\n") : text
      ).slice(0, 50_000);

      const seenLinks = new Set<string>();
      const links = (
        Array.from(body?.querySelectorAll("a[href]") ?? []) as any[]
      )
        .filter(isVisible)
        .flatMap((element) => {
          const anchor = element as any;
          let target: URL;
          try {
            target = new URL(anchor.href, doc.baseURI);
          } catch {
            return [];
          }
          if (
            (target.protocol !== "http:" && target.protocol !== "https:") ||
            target.username ||
            target.password ||
            target.href.length > 2_048 ||
            seenLinks.has(target.href)
          ) {
            return [];
          }
          seenLinks.add(target.href);
          const linkText = normalize(
            anchor.innerText || anchor.getAttribute("aria-label") || "",
          ).slice(0, 300);
          return [{ text: linkText || target.href, href: target.href }];
        })
        .slice(0, 200);

      return { description, text, markdown, headings, links };
    }),
    activePage.title().catch(() => ""),
  ]);

  return {
    sessionId,
    activeTabId: session.activeTabId,
    tabs: tabs.filter((tab) => session.tabs.has(tab.id)),
    screenshot: `data:image/png;base64,${screenshot.toString("base64")}`,
    currentUrl: activePage.url(),
    title,
    pageContent,
    viewportWidth: VIEWPORT.width,
    viewportHeight: VIEWPORT.height,
  };
}

export async function createBrowserSession(url?: string) {
  if (sessions.size >= MAX_SESSIONS) {
    throw new BrowserOperationError(
      "All browser sessions are currently in use. Try again in a few minutes.",
      503,
    );
  }

  const browserInstance = await ensureBrowser();
  const context = await browserInstance.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const sessionId = randomUUID();
  const session: BrowserSession = {
    id: sessionId,
    context,
    tabs: new Map(),
    activeTabId: "",
    lastUsedAt: Date.now(),
  };
  registerPage(session, page);
  sessions.set(sessionId, session);

  try {
    if (url) {
      const safeUrl = await validatePublicWebUrl(url);
      await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    return await getBrowserState(sessionId);
  } catch (error) {
    await closeBrowserSession(sessionId);
    if (error instanceof BrowserPolicyError) {
      throw new BrowserOperationError(error.message, 400);
    }
    if (error instanceof BrowserOperationError) throw error;
    const chromiumErrorCode =
      error instanceof Error
        ? error.message.match(/\bnet::(ERR_[A-Z0-9_]+)\b/)?.[1]
        : undefined;
    logger.warn(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        chromiumErrorCode,
      },
      "A browser page failed to load",
    );
    throw new BrowserOperationError(
      "The page did not finish loading. Check the address and try again.",
      502,
    );
  }
}

export async function navigateBrowser(sessionId: string, url: string) {
  const session = getSession(sessionId);
  const page = getActivePage(session);
  let safeUrl: string;
  try {
    safeUrl = await validatePublicWebUrl(url);
  } catch (error) {
    if (error instanceof BrowserPolicyError) {
      throw new BrowserOperationError(error.message, 400);
    }
    throw error;
  }

  try {
    await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return await getBrowserState(sessionId);
  } catch {
    throw new BrowserOperationError(
      "The page could not be loaded. It may have blocked the request or timed out.",
      502,
    );
  }
}

export async function performBrowserAction(
  sessionId: string,
  action: BrowserAction,
) {
  const session = getSession(sessionId);
  const page = getActivePage(session);

  try {
    switch (action.action) {
      case "click":
        if (typeof action.x !== "number" || typeof action.y !== "number") {
          throw new BrowserOperationError(
            "A screen position is required to click.",
            400,
          );
        }
        if (
          action.x < 0 ||
          action.y < 0 ||
          action.x >= VIEWPORT.width ||
          action.y >= VIEWPORT.height
        ) {
          throw new BrowserOperationError(
            "The click position is outside the browser viewport.",
            400,
          );
        }
        await page.mouse.click(action.x, action.y);
        await page.waitForTimeout(200);
        break;
      case "type":
        if (typeof action.text !== "string" || action.text.length === 0) {
          throw new BrowserOperationError("Enter text to type.", 400);
        }
        await page.keyboard.type(action.text);
        break;
      case "key":
        if (typeof action.key !== "string" || action.key.length === 0) {
          throw new BrowserOperationError("Choose a key to press.", 400);
        }
        await page.keyboard.press(action.key);
        break;
      case "scroll":
        await page.mouse.wheel(0, action.deltaY ?? 600);
        break;
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => null);
        break;
      case "forward":
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => null);
        break;
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
        break;
    }

    return await getBrowserState(sessionId);
  } catch (error) {
    if (error instanceof BrowserOperationError) throw error;
    throw new BrowserOperationError(
      "That browser action could not be completed.",
      502,
    );
  }
}

export async function createBrowserTab(sessionId: string, url: string) {
  const session = getSession(sessionId);
  if (session.tabs.size >= MAX_TABS_PER_SESSION) {
    throw new BrowserOperationError(
      `A session can have up to ${MAX_TABS_PER_SESSION} tabs.`,
      429,
    );
  }

  let safeUrl: string;
  try {
    safeUrl = await validatePublicWebUrl(url);
  } catch (error) {
    if (error instanceof BrowserPolicyError) {
      throw new BrowserOperationError(error.message, 400);
    }
    throw error;
  }

  const page = await session.context.newPage();
  registerPage(session, page);
  try {
    await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return await getBrowserState(sessionId);
  } catch {
    await page.close().catch(() => undefined);
    throw new BrowserOperationError(
      "The page could not be loaded. It may have blocked the request or timed out.",
      502,
    );
  }
}

export async function activateBrowserTab(sessionId: string, tabId: string) {
  const session = getSession(sessionId);
  const page = session.tabs.get(tabId);
  if (!page || page.isClosed()) {
    throw new BrowserOperationError("That tab is no longer available.", 404);
  }
  session.activeTabId = tabId;
  return getBrowserState(sessionId);
}

export async function closeBrowserTab(sessionId: string, tabId: string) {
  const session = getSession(sessionId);
  const page = session.tabs.get(tabId);
  if (!page) {
    throw new BrowserOperationError("That tab is no longer available.", 404);
  }

  await page.close();
  if (session.tabs.size === 0) {
    const newPage = await session.context.newPage();
    registerPage(session, newPage);
  }
  return getBrowserState(sessionId);
}

export async function closeBrowserSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new BrowserOperationError("This browser session was not found.", 404);
  }
  sessions.delete(sessionId);
  await session.context.close().catch(() => undefined);

  if (sessions.size === 0 && browser) {
    const currentBrowser = browser;
    browser = undefined;
    await currentBrowser.close().catch(() => undefined);
    await proxy?.close().catch(() => undefined);
    proxy = undefined;
  }
}

const cleanupTimer = setInterval(() => {
  const expired = Array.from(sessions.values()).filter(
    (session) => Date.now() - session.lastUsedAt > IDLE_TIMEOUT_MS,
  );
  for (const session of expired) {
    void closeBrowserSession(session.id).catch((error: unknown) => {
      logger.warn(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "An expired browser session could not be closed",
      );
    });
  }
}, 60_000);
cleanupTimer.unref();
