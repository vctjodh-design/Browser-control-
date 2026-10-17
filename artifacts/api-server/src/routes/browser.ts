import { Router, type IRouter, type Response } from "express";
import {
  ActivateBrowserTabParams,
  ActivateBrowserTabResponse,
  CloseBrowserSessionParams,
  CloseBrowserTabParams,
  CloseBrowserTabResponse,
  CloseBrowserSessionResponse,
  CreateBrowserSessionBody,
  CreateBrowserSessionResponse,
  CreateBrowserTabBody,
  CreateBrowserTabParams,
  CreateBrowserTabResponse,
  GetBrowserSessionParams,
  GetBrowserSessionResponse,
  MoveBrowserMouseBody,
  MoveBrowserMouseParams,
  MoveBrowserMouseResponse,
  NavigateBrowserBody,
  NavigateBrowserParams,
  NavigateBrowserResponse,
  PerformBrowserActionBody,
  PerformBrowserActionParams,
  PerformBrowserActionResponse,
} from "@workspace/api-zod";
import {
  activateBrowserTab,
  closeBrowserSession,
  closeBrowserTab,
  createBrowserSession,
  createBrowserTab,
  getBrowserState,
  moveBrowserMouse,
  navigateBrowser,
  performBrowserAction,
  BrowserOperationError,
} from "../lib/browser-controller";

const router: IRouter = Router();

function sendError(response: Response, error: unknown): void {
  const known = error instanceof BrowserOperationError;
  const status = known ? error.statusCode : 502;
  const message = known
    ? error.message
    : "The browser request could not be completed.";
  response.status(status).json({ error: message });
}

function sendValidationError(response: Response, message: string): void {
  response.status(400).json({ error: message });
}

router.post("/browser/sessions", async (req, res): Promise<void> => {
  const parsed = CreateBrowserSessionBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error.message);
    return;
  }

  try {
    const state = await createBrowserSession(
      parsed.data.url,
      parsed.data.tabCount,
    );
    res.status(201).json(CreateBrowserSessionResponse.parse(state));
  } catch (error) {
    if (!(error instanceof BrowserOperationError) || error.statusCode >= 500) {
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not create a browser session",
      );
    }
    sendError(res, error);
  }
});

router.get("/browser/sessions/:sessionId", async (req, res): Promise<void> => {
  const params = GetBrowserSessionParams.safeParse(req.params);
  if (!params.success) {
    sendValidationError(res, params.error.message);
    return;
  }

  try {
    res.json(
      GetBrowserSessionResponse.parse(
        await getBrowserState(params.data.sessionId),
      ),
    );
  } catch (error) {
    sendError(res, error);
  }
});

router.delete(
  "/browser/sessions/:sessionId",
  async (req, res): Promise<void> => {
    const params = CloseBrowserSessionParams.safeParse(req.params);
    if (!params.success) {
      sendValidationError(res, params.error.message);
      return;
    }

    try {
      await closeBrowserSession(params.data.sessionId);
      res.status(204).json(CloseBrowserSessionResponse.parse(undefined));
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  "/browser/sessions/:sessionId/navigate",
  async (req, res): Promise<void> => {
    const params = NavigateBrowserParams.safeParse(req.params);
    const body = NavigateBrowserBody.safeParse(req.body);
    if (!params.success) {
      sendValidationError(res, params.error.message);
      return;
    }
    if (!body.success) {
      sendValidationError(res, body.error.message);
      return;
    }

    try {
      const state = await navigateBrowser(
        params.data.sessionId,
        body.data.url,
        body.data.syncTabs,
        body.data.tabCount,
      );
      res.json(NavigateBrowserResponse.parse(state));
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  "/browser/sessions/:sessionId/action",
  async (req, res): Promise<void> => {
    const params = PerformBrowserActionParams.safeParse(req.params);
    const body = PerformBrowserActionBody.safeParse(req.body);
    if (!params.success) {
      sendValidationError(res, params.error.message);
      return;
    }
    if (!body.success) {
      sendValidationError(res, body.error.message);
      return;
    }

    try {
      const state = await performBrowserAction(
        params.data.sessionId,
        body.data,
      );
      res.json(PerformBrowserActionResponse.parse(state));
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  "/browser/sessions/:sessionId/mouse",
  async (req, res): Promise<void> => {
    const params = MoveBrowserMouseParams.safeParse(req.params);
    const body = MoveBrowserMouseBody.safeParse(req.body);
    if (!params.success) {
      sendValidationError(res, params.error.message);
      return;
    }
    if (!body.success) {
      sendValidationError(res, body.error.message);
      return;
    }

    try {
      const result = await moveBrowserMouse(
        params.data.sessionId,
        body.data.x,
        body.data.y,
        body.data.syncTabs,
      );
      res.json(MoveBrowserMouseResponse.parse(result));
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  "/browser/sessions/:sessionId/tabs",
  async (req, res): Promise<void> => {
    const params = CreateBrowserTabParams.safeParse(req.params);
    const body = CreateBrowserTabBody.safeParse(req.body);
    if (!params.success) {
      sendValidationError(res, params.error.message);
      return;
    }
    if (!body.success) {
      sendValidationError(res, body.error.message);
      return;
    }

    try {
      const state = await createBrowserTab(
        params.data.sessionId,
        body.data.url,
      );
      res.status(201).json(CreateBrowserTabResponse.parse(state));
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  "/browser/sessions/:sessionId/tabs/:tabId/activate",
  async (req, res): Promise<void> => {
    const params = ActivateBrowserTabParams.safeParse(req.params);
    if (!params.success) {
      sendValidationError(res, params.error.message);
      return;
    }

    try {
      const state = await activateBrowserTab(
        params.data.sessionId,
        params.data.tabId,
      );
      res.json(ActivateBrowserTabResponse.parse(state));
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.delete(
  "/browser/sessions/:sessionId/tabs/:tabId",
  async (req, res): Promise<void> => {
    const params = CloseBrowserTabParams.safeParse(req.params);
    if (!params.success) {
      sendValidationError(res, params.error.message);
      return;
    }

    try {
      const state = await closeBrowserTab(
        params.data.sessionId,
        params.data.tabId,
      );
      res.json(CloseBrowserTabResponse.parse(state));
    } catch (error) {
      sendError(res, error);
    }
  },
);

export default router;
