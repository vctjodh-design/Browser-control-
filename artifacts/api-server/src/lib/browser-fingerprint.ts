/**
 * Browser fingerprint impersonation for the managed Chromium sessions.
 *
 * Stock Playwright automation is trivially detectable: the UA says
 * `HeadlessChrome`, `navigator.webdriver` is `true`, `window.chrome` is missing,
 * there are no User-Agent Client Hints at all, `navigator.plugins` is empty, the
 * screen is exactly the emulated viewport, `outerWidth === innerWidth` and WebGL
 * reports SwiftShader. Those are the first checks in every bot-scoring pipeline,
 * and they are what gets a session shown a challenge it cannot pass.
 *
 * Everything below derives from a single value — the version of the Chromium we
 * actually launch — so the UA string, `navigator.userAgentData` and the
 * `sec-ch-ua*` request headers can never disagree with one another.
 *
 * The persona is deliberately one fixed machine (Windows 11 x64, branded Chrome)
 * rather than a random one: a deterministic fingerprint stays internally
 * consistent across sessions instead of inventing a new "device" per tab.
 */

type BrandVersion = { brand: string; version: string };

type Persona = {
  brands: BrandVersion[];
  fullVersionList: BrandVersion[];
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  model: string;
  languages: string[];
  hardwareConcurrency: number;
  deviceMemory: number;
  screen: {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
  };
  windowFrame: { width: number; height: number };
  pluginNames: string[];
  webgl: { vendor: string; renderer: string };
};

export type ImpersonationContextOptions = {
  userAgent: string;
  timezoneId: string;
  colorScheme: "light";
  extraHTTPHeaders: Record<string, string>;
};

export type Impersonation = {
  contextOptions: ImpersonationContextOptions;
  initScript: string;
};

/**
 * Chromium derives `navigator.webdriver` from this feature; without the flag
 * the property reports `true` whenever the browser is driven over CDP.
 */
export const STEALTH_LAUNCH_ARGS = ["--disable-blink-features=AutomationControlled"];

/**
 * Chromium's GREASE table for `sec-ch-ua`: the junk brand name and version are
 * both derived from the browser's major version, and the list order is picked
 * from a fixed six-permutation table. Copying the algorithm (rather than a
 * single observed version) keeps the spoof correct on the next upgrade.
 */
const GREASE_CHARS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const GREASE_VERSIONS = ["8", "99", "24"];
/** `Windows.Foundation.UniversalApiContract` version reported for Windows 11. */
const PERSONA_PLATFORM_VERSION = "15.0.0";
const BRAND_ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function brandList(
  major: number,
  fullVersion: string,
  includeFullVersion: boolean,
): BrandVersion[] {
  const grease = `Not${GREASE_CHARS[major % 11]}A${GREASE_CHARS[(major + 1) % 11]}Brand`;
  const greaseVersion = GREASE_VERSIONS[major % 3];
  const base: BrandVersion[] = [
    {
      brand: grease,
      version: includeFullVersion ? `${greaseVersion}.0.0.0` : greaseVersion,
    },
    {
      brand: "Chromium",
      version: includeFullVersion ? fullVersion : String(major),
    },
    {
      brand: "Google Chrome",
      version: includeFullVersion ? fullVersion : String(major),
    },
  ];
  return BRAND_ORDERS[major % 6].map((index) => base[index]);
}

function serialiseBrands(brands: BrandVersion[]): string {
  return brands
    .map(({ brand, version }) => `"${brand}";v="${version}"`)
    .join(", ");
}

export function buildImpersonation(browserVersion: string): Impersonation {
  const major = Number.parseInt(browserVersion.split(".")[0] ?? "0", 10);
  const chromeMajor = Number.isFinite(major) && major > 0 ? major : 156;

  // The UA must claim the build we actually run: a mismatch between the
  // `Chrome/156` in the UA and the 156 in `sec-ch-ua` is a classic bot tell.
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;
  const brands = brandList(chromeMajor, browserVersion, false);
  const fullVersionList = brandList(chromeMajor, browserVersion, true);

  const persona: Persona = {
    brands,
    fullVersionList,
    fullVersion: browserVersion,
    platform: "Windows",
    platformVersion: PERSONA_PLATFORM_VERSION,
    architecture: "x86",
    bitness: "64",
    model: "",
    languages: ["en-US", "en"],
    hardwareConcurrency: 8,
    deviceMemory: 16,
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
    // The emulated viewport is a non-maximised window on that screen, so the
    // frame is a real border + title/tab/toolbar band rather than zero.
    windowFrame: { width: 16, height: 104 },
    pluginNames: [
      "PDF Viewer",
      "Chrome PDF Viewer",
      "Chromium PDF Viewer",
      "Microsoft Edge PDF Viewer",
      "WebKit built-in PDF",
    ],
    webgl: {
      vendor: "Google Inc. (NVIDIA)",
      renderer:
        "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
  };

  return {
    contextOptions: {
      userAgent,
      // Deliberately no `locale` option: Playwright applies it through
      // Emulation.setAcceptLanguage, which wins over setExtraHTTPHeaders and
      // would flatten our Chrome-shaped `en-US,en;q=0.9` back to a bare
      // `en-US` — the classic automation header. The headless build's own
      // default locale is already en-US, so JS and headers stay aligned.
      // Deliberately left at UTC rather than a spoofed US timezone: it is a
      // normal Windows timezone, and moving the browser's clock would silently
      // shift every page-relative time the app parses.
      timezoneId: "UTC",
      colorScheme: "light",
      extraHTTPHeaders: {
        "sec-ch-ua": serialiseBrands(brands),
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        // Chromium only puts the high-entropy hints on the wire after an
        // Accept-CH negotiation, and then it uses Playwright's own metadata —
        // which reports a platform version of "10.0" against our Windows 11
        // persona. Sending them ourselves keeps the wire and the JS identical.
        "sec-ch-ua-platform-version": `"${PERSONA_PLATFORM_VERSION}"`,
        "sec-ch-ua-full-version-list": serialiseBrands(fullVersionList),
        "Accept-Language": "en-US,en;q=0.9",
      },
    },
    initScript: `(${String(installFingerprint)})(${JSON.stringify(persona)});`,
  };
}

/**
 * Injected into every document of every tab before page scripts run.
 * Kept self-contained: it is stringified and handed to Playwright as-is, so it
 * may only close over its `persona` argument.
 */
function installFingerprint(persona: Persona): void {
  const define = (
    target: object,
    property: PropertyKey,
    descriptor: PropertyDescriptor,
  ): boolean => {
    try {
      Object.defineProperty(target, property, descriptor);
      return true;
    } catch {
      return false;
    }
  };

  const getter = (
    target: object,
    property: string,
    read: () => unknown,
  ): boolean =>
    define(target, property, { get: read, configurable: true, enumerable: true });

  const method = (
    target: object,
    property: PropertyKey,
    impl: (...args: never[]) => unknown,
    enumerable = true,
  ): boolean =>
    define(target, property, {
      value: impl,
      configurable: true,
      writable: true,
      enumerable,
    });

  // The api-server is typed against Node, not the DOM, and at run time this
  // script is evaluated inside the page where `globalThis` *is* the window.
  const page = globalThis as unknown as {
    screen: Record<PropertyKey, unknown>;
    innerWidth: number;
    innerHeight: number;
    chrome?: unknown;
    Plugin?: object;
    MimeType?: object;
    PluginArray?: object;
    MimeTypeArray?: object;
    Notification?: object;
    PermissionStatus?: object;
    WebGLRenderingContext?: object;
    WebGL2RenderingContext?: object;
  };

  // The Node typings do not know the Performance Timeline entry shapes.
  const navigationTiming = ():
    | { responseEnd?: number; duration?: number; type?: string }
    | undefined =>
    (
      performance as unknown as {
        getEntriesByType: (type: string) => object[];
      }
    ).getEntriesByType("navigation")[0] as
      | { responseEnd?: number; duration?: number; type?: string }
      | undefined;

  const nativeToString = <T extends object>(impl: T, name: string): T => {
    define(impl, "toString", {
      value: () => `function ${name}() { [native code] }`,
      configurable: true,
      writable: true,
      enumerable: false,
    });
    return impl;
  };

  // --- navigator ---------------------------------------------------------
  // Chromium already reports `false` when launched without the automation
  // feature; only patch when the flag did not take effect.
  try {
    const webdriver = (navigator as unknown as { webdriver?: boolean }).webdriver;
    if (webdriver !== false) {
      getter(Navigator.prototype, "webdriver", () => false);
    }
  } catch {
    /* leave the descriptor alone if this build has none */
  }

  getter(Navigator.prototype, "platform", () => "Win32");
  getter(Navigator.prototype, "hardwareConcurrency", () => persona.hardwareConcurrency);
  getter(Navigator.prototype, "deviceMemory", () => persona.deviceMemory);
  const languages = Object.freeze(persona.languages.slice());
  getter(Navigator.prototype, "languages", () => languages);

  // --- User-Agent Client Hints ------------------------------------------
  // Playwright synthesises `userAgentData` from its own template, so it does
  // not match the brands our UA claims. Replace it wholesale, keeping the
  // request-a-hint contract (low-entropy keys always present, high-entropy
  // keys only when asked for).
  const highEntropy = {
    architecture: persona.architecture,
    bitness: persona.bitness,
    formFactors: ["Desktop"],
    fullVersionList: persona.fullVersionList,
    model: persona.model,
    platformVersion: persona.platformVersion,
    uaFullVersion: persona.fullVersion,
    wow64: false,
  };
  const userAgentData = {
    brands: persona.brands,
    mobile: false,
    platform: persona.platform,
    getHighEntropyValues(hints: string[] = []): Promise<Record<string, unknown>> {
      const requested = new Set(hints);
      const result: Record<string, unknown> = {
        brands: persona.brands,
        mobile: false,
        platform: persona.platform,
      };
      for (const [key, value] of Object.entries(highEntropy)) {
        if (requested.has(key)) result[key] = value;
      }
      return Promise.resolve(result);
    },
    toJSON(): { brands: BrandVersion[]; mobile: boolean; platform: string } {
      return {
        brands: persona.brands,
        mobile: false,
        platform: persona.platform,
      };
    },
  };
  getter(Navigator.prototype, "userAgentData", () => userAgentData);

  // --- plugin / mime-type arrays ----------------------------------------
  // Real Chrome reports five built-in PDF plugins and two MIME types; the
  // headless shell reports nothing, which is a one-line bot signature.
  const makeArrayLike = (prototype: unknown, items: object[]): object => {
    const list = Object.create(
      (prototype as { prototype?: object } | undefined)?.prototype ??
        Object.prototype,
    ) as Record<PropertyKey, unknown>;
    items.forEach((item, index) => {
      define(list, String(index), {
        value: item,
        enumerable: true,
        configurable: true,
        writable: false,
      });
    });
    define(list, "length", {
      value: items.length,
      enumerable: false,
      configurable: true,
      writable: false,
    });
    method(list, "item", (index: number) => items[index] ?? null);
    method(
      list,
      "namedItem",
      (name: string) =>
        items.find((item) => {
          const record = item as Record<string, unknown>;
          return record.name === name || record.type === name;
        }) ?? null,
    );
    method(list, "refresh", () => undefined);
    define(list, Symbol.iterator, {
      value: function* () {
        for (const item of items) yield item;
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });
    return list;
  };

  try {
    const mimeTypes: object[] = [];
    const plugins: object[] = persona.pluginNames.map((name, index) => {
      const pluginMimes = index === 0 ? mimeTypes : [];
      const plugin = Object.create(
        page.Plugin ?? Object.prototype,
      ) as Record<PropertyKey, unknown>;
      define(plugin, "name", { value: name, configurable: true, enumerable: true });
      define(plugin, "filename", {
        value: "internal-pdf-viewer",
        configurable: true,
        enumerable: true,
      });
      define(plugin, "description", {
        value: "Portable Document Format",
        configurable: true,
        enumerable: true,
      });
      define(plugin, "length", {
        value: pluginMimes.length,
        configurable: true,
        enumerable: false,
        writable: false,
      });
      pluginMimes.forEach((mime, mimeIndex) => {
        define(plugin, String(mimeIndex), {
          value: mime,
          configurable: true,
          enumerable: true,
          writable: false,
        });
      });
      method(plugin, "item", (mimeIndex: number) => pluginMimes[mimeIndex] ?? null);
      method(
        plugin,
        "namedItem",
        (mimeName: string) =>
          pluginMimes.find(
            (mime) => (mime as Record<string, unknown>).type === mimeName,
          ) ?? null,
      );
      method(plugin, "refresh", () => undefined);
      define(plugin, Symbol.iterator, {
        value: function* () {
          for (const mime of pluginMimes) yield mime;
        },
        enumerable: false,
        configurable: true,
        writable: true,
      });
      return plugin;
    });

    for (const type of ["application/pdf", "text/pdf"]) {
      const mime = Object.create(
        page.MimeType ?? Object.prototype,
      ) as Record<PropertyKey, unknown>;
      define(mime, "type", { value: type, configurable: true, enumerable: true });
      define(mime, "suffixes", { value: "pdf", configurable: true, enumerable: true });
      define(mime, "description", {
        value: "Portable Document Format",
        configurable: true,
        enumerable: true,
      });
      define(mime, "enabledPlugin", {
        value: plugins[0],
        configurable: true,
        enumerable: true,
      });
      mimeTypes.push(mime);
    }

    // The MIME types are only known once the loop above has run, so give the
    // first plugin (the one that owns them) its entries and length now.
    const pdfPlugin = plugins[0] as Record<PropertyKey, unknown> | undefined;
    if (pdfPlugin) {
      define(pdfPlugin, "length", {
        value: mimeTypes.length,
        configurable: true,
        enumerable: false,
        writable: false,
      });
      mimeTypes.forEach((mime, mimeIndex) => {
        define(pdfPlugin, String(mimeIndex), {
          value: mime,
          configurable: true,
          enumerable: true,
          writable: false,
        });
      });
    }

    const pluginArray = makeArrayLike(
      page.PluginArray,
      plugins,
    );
    const mimeTypeArray = makeArrayLike(
      page.MimeTypeArray,
      mimeTypes,
    );
    getter(Navigator.prototype, "plugins", () => pluginArray);
    getter(Navigator.prototype, "mimeTypes", () => mimeTypeArray);
  } catch {
    /* plugin surface unavailable — nothing to hide */
  }

  // --- window.chrome -----------------------------------------------------
  // Absent in the headless shell, present on every real Chrome page.
  try {
    const existing = page.chrome;
    const chromeTarget = (
      typeof existing === "object" && existing !== null ? existing : {}
    ) as Record<string, unknown>;
    const built = chromeTarget !== (existing as object);

    if (!chromeTarget.app) {
      chromeTarget.app = {
        running: false,
        InstallState: {
          DISABLED: "disabled",
          INSTALLED: "installed",
          NOT_INSTALLED: "not_installed",
        },
        RunningState: {
          CANNOT_RUN: "cannot_run",
          READY_TO_RUN: "ready_to_run",
          RUNNING: "running",
        },
      };
    }

    if (typeof chromeTarget.csi !== "function") {
      chromeTarget.csi = nativeToString(function csi(): Record<string, unknown> {
        const start = Math.round(performance.timeOrigin);
        const navigation = navigationTiming();
        return {
          startE: start,
          onloadT: start + Math.round(navigation?.responseEnd ?? 0),
          pageT: Math.round(navigation?.duration ?? 0),
          tran: 15,
        };
      }, "csi");
    }

    if (typeof chromeTarget.loadTimes !== "function") {
      chromeTarget.loadTimes = nativeToString(
        function loadTimes(): Record<string, unknown> {
          const start = performance.timeOrigin / 1000;
          const navigation = navigationTiming();
          const firstPaint = performance.getEntriesByName(
            "first-paint",
          )[0] as PerformanceEntry | undefined;
          const paint = firstPaint
            ? start + firstPaint.startTime / 1000
            : 0;
          return {
            requestTime: start,
            startLoadTime: start,
            finishLoadTime: start + (navigation?.responseEnd ?? 0) / 1000,
            firstPaintTime: paint,
            firstPaintAfterLoadTime: 0,
            navigationType:
              navigation && navigation.type === "navigate"
                ? "Other"
                : (navigation?.type as string) || "Other",
            wasFetchedViaSpdy: true,
            wasNpnNegotiated: true,
            npnNegotiatedProtocol: "h2",
            wasAlternateProtocolAvailable: false,
            connectionInfo: "h2",
          };
        },
        "loadTimes",
      );
    }

    if (typeof chromeTarget.runtime !== "object" || chromeTarget.runtime === null) {
      chromeTarget.runtime = {
        id: undefined,
        Platform: {
          ANDROID: "android",
          CROS: "cros",
          FUCHSIA: "fuchsia",
          LINUX: "linux",
          MAC: "mac",
          OPENBSD: "openbsd",
          WIN: "win",
        },
        RequestRunningState: {
          CANNOT_RUN: "cannot_run",
          READY_TO_RUN: "ready_to_run",
          RUNNING: "running",
        },
        OnInstalledReason: {
          CHROME_UPDATE: "chrome_update",
          INSTALL: "install",
          SHARED_MODULE_UPDATE: "shared_module_update",
          UPDATE: "update",
        },
        OnRestartRequiredReason: {
          APP_UPDATE: "app_update",
          OS_UPDATE: "os_update",
          PERIODIC: "periodic",
        },
        ContextType: {
          BRIDGE: "bridge",
          EXTENSION: "extension",
          OFFSCREEN_DOCUMENT: "offscreen_document",
          TAB: "tab",
        },
        connect: nativeToString(function connect(): never {
          throw new Error("Attempting to use a disconnected port object");
        }, "connect"),
        sendMessage: nativeToString(function sendMessage(): never {
          throw new TypeError(
            "Error in invocation of runtime.sendMessage(): Required parameters are missing.",
          );
        }, "sendMessage"),
      };
    }

    if (built) {
      define(page, "chrome", {
        value: chromeTarget,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    }
  } catch {
    /* chrome object unavailable */
  }

  // --- WebGL -------------------------------------------------------------
  // SwiftShader (software rendering) is one of the loudest automation signals:
  // a desktop Windows machine reports an ANGLE-wrapped GPU string instead.
  const patchWebgl = (ctor: unknown): void => {
    const context = (
      ctor as { prototype?: Record<PropertyKey, unknown> } | undefined
    )?.prototype;
    const original = context?.getParameter as
      | ((this: unknown, parameter: number) => unknown)
      | undefined;
    if (!context || typeof original !== "function") return;
    method(
      context,
      "getParameter",
      function getParameter(this: unknown, parameter: number): unknown {
        if (parameter === 0x9245) return persona.webgl.vendor;
        if (parameter === 0x9246) return persona.webgl.renderer;
        return original.call(this, parameter);
      },
      false,
    );
  };
  patchWebgl(page.WebGLRenderingContext);
  patchWebgl(page.WebGL2RenderingContext);

  // --- permissions -------------------------------------------------------
  // Headless reports notifications as hard-denied; a fresh desktop profile
  // reports "default"/prompt, and denial is used as an automation hint.
  try {
    const notification = page.Notification;
    if (notification) {
      define(notification, "permission", {
        get: () => "default",
        configurable: true,
        enumerable: true,
      });
    }
    const permissions = (
      navigator as unknown as { permissions?: Record<PropertyKey, unknown> }
    ).permissions;
    const query = permissions?.query as
      | ((this: unknown, descriptor: unknown) => Promise<unknown>)
      | undefined;
    if (permissions && typeof query === "function") {
      method(
        permissions,
        "query",
        function query(descriptor: { name?: string } | null): Promise<unknown> {
          if (descriptor?.name === "notifications") {
            const status = Object.create(
              page.PermissionStatus ?? Object.prototype,
            ) as Record<PropertyKey, unknown>;
            define(status, "state", {
              value: "default",
              configurable: true,
              enumerable: true,
            });
            define(status, "onchange", {
              value: null,
              configurable: true,
              writable: true,
              enumerable: true,
            });
            return Promise.resolve(status);
          }
          return query.call(permissions, descriptor);
        },
      );
    }
  } catch {
    /* permission surface unavailable */
  }

  // --- screen and window -------------------------------------------------
  // Emulation makes `screen` exactly the viewport and `outer === inner`; a real
  // desktop reports its physical display and a window with a frame around it.
  try {
    const display = persona.screen;
    const dimensions: Record<string, number> = {
      width: display.width,
      height: display.height,
      availWidth: display.availWidth,
      availHeight: display.availHeight,
      colorDepth: 24,
      pixelDepth: 24,
    };
    for (const [name, size] of Object.entries(dimensions)) {
      define(page.screen, name, {
        get: () => size,
        configurable: true,
        enumerable: true,
      });
    }
    const frame = persona.windowFrame;
    define(page, "outerWidth", {
      get: () => page.innerWidth + frame.width,
      configurable: true,
      enumerable: true,
    });
    define(page, "outerHeight", {
      get: () => page.innerHeight + frame.height,
      configurable: true,
      enumerable: true,
    });
  } catch {
    /* screen surface unavailable */
  }
}