---
name: Browser egress safety
description: Security constraint for the remote Chromium browser's outbound network traffic.
---

Every remote Chromium HTTP(S) request must pass through the local egress proxy, which resolves the destination, rejects private or reserved addresses, and connects to the checked IP. Keep browser navigation limited to public web traffic on ports 80 and 443.

**Why:** The browser runs in the hosted application environment. Unrestricted navigation could expose internal services, and validating DNS without pinning the connection leaves a DNS-rebinding gap.

**How to apply:** Preserve the proxy when changing Playwright launch settings, navigation, redirects, or request routing. Any new path to the network must enforce the same policy.

Plain-text searches in the remote browser should use Bing: Google and DuckDuckGo returned automated-browsing block pages in hosted Chromium during verification. Never try to bypass a search provider's challenge page.

**Why:** Search providers decide whether to serve results to the hosted browser; routing plain queries to one that loaded normally avoids confusing users with a challenge page.

**How to apply:** Keep address-like input as direct navigation and route plain text to Bing. If users explicitly visit a blocked provider, explain the block and offer the built-in search field or a direct site address.
