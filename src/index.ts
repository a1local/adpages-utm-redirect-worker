export interface Env {
  ROUTES_JSON?: string;
  DEFAULT_UTM_SOURCE?: string;
  DEFAULT_UTM_MEDIUM?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type RedirectStatus = 301 | 302 | 307 | 308;

type UtmKey =
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "utm_term"
  | "utm_content";

interface RedirectRoute {
  destination: string;
  status?: RedirectStatus;
  utm?: Partial<Record<UtmKey, string>>;
  allowedPassthroughParams?: string[];
}

type RouteMap = Record<string, RedirectRoute>;

const UTM_KEYS: UtmKey[] = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content"
];

const DEFAULT_STATUS: RedirectStatus = 302;
const MAX_PARAM_VALUE_LENGTH = 512;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse("Method not allowed", 405, {
        Allow: "GET, HEAD"
      });
    }

    if (url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "adpages-utm-redirect-worker"
      });
    }

    const routeMap = parseRoutes(env.ROUTES_JSON);
    const route = routeMap[normalizePath(url.pathname)];

    if (!route) {
      return jsonResponse(
        {
          error: "route_not_found",
          message: "No redirect route is configured for this path."
        },
        404
      );
    }

    const result = buildRedirectUrl(route, url, env);

    if (!result.ok) {
      return jsonResponse(
        {
          error: "invalid_route_configuration",
          message: result.message
        },
        500
      );
    }

    const status = isRedirectStatus(route.status) ? route.status : DEFAULT_STATUS;

    if (url.searchParams.get("dry_run") === "1") {
      return jsonResponse({
        route: normalizePath(url.pathname),
        status,
        redirectTo: result.url.toString()
      });
    }

    return Response.redirect(result.url.toString(), status);
  }
};

function buildRedirectUrl(
  route: RedirectRoute,
  incomingUrl: URL,
  env: Env
): { ok: true; url: URL } | { ok: false; message: string } {
  let destinationUrl: URL;

  try {
    destinationUrl = new URL(route.destination);
  } catch {
    return {
      ok: false,
      message: "Route destination must be an absolute http or https URL."
    };
  }

  if (destinationUrl.protocol !== "https:" && destinationUrl.protocol !== "http:") {
    return {
      ok: false,
      message: "Route destination must use http or https."
    };
  }

  normalizeExistingUtm(destinationUrl);

  const defaults: Partial<Record<UtmKey, string>> = {
    utm_source: env.DEFAULT_UTM_SOURCE || "shortlink",
    utm_medium: env.DEFAULT_UTM_MEDIUM || "redirect"
  };

  for (const key of UTM_KEYS) {
    const defaultValue = defaults[key];

    if (defaultValue && !destinationUrl.searchParams.has(key)) {
      destinationUrl.searchParams.set(key, normalizeUtmValue(defaultValue));
    }
  }

  for (const [key, value] of Object.entries(route.utm ?? {}) as Array<[UtmKey, string]>) {
    if (UTM_KEYS.includes(key) && value) {
      destinationUrl.searchParams.set(key, normalizeUtmValue(value));
    }
  }

  for (const paramName of route.allowedPassthroughParams ?? []) {
    if (!isSafeParamName(paramName) || !incomingUrl.searchParams.has(paramName)) {
      continue;
    }

    const incomingValue = cleanParamValue(incomingUrl.searchParams.get(paramName));

    if (!incomingValue) {
      continue;
    }

    if (isUtmKey(paramName)) {
      destinationUrl.searchParams.set(paramName, normalizeUtmValue(incomingValue));
    } else {
      destinationUrl.searchParams.set(paramName, incomingValue);
    }
  }

  return {
    ok: true,
    url: destinationUrl
  };
}

function parseRoutes(routesJson: string | undefined): RouteMap {
  if (!routesJson) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(routesJson);
    const routes = isRecord(parsed) && isRecord(parsed.routes) ? parsed.routes : parsed;

    if (!isRecord(routes)) {
      return {};
    }

    const routeMap: RouteMap = {};

    for (const [path, value] of Object.entries(routes)) {
      if (!isRecord(value) || typeof value.destination !== "string") {
        continue;
      }

      routeMap[normalizePath(path)] = {
        destination: value.destination,
        status: isRedirectStatus(value.status) ? value.status : undefined,
        utm: parseUtm(value.utm),
        allowedPassthroughParams: parseStringArray(value.allowedPassthroughParams)
      };
    }

    return routeMap;
  } catch {
    return {};
  }
}

function parseUtm(value: unknown): Partial<Record<UtmKey, string>> {
  if (!isRecord(value)) {
    return {};
  }

  const utm: Partial<Record<UtmKey, string>> = {};

  for (const key of UTM_KEYS) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.trim()) {
      utm[key] = candidate;
    }
  }

  return utm;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizePath(path: string): string {
  const withoutTrailingSlash = path === "/" ? path : path.replace(/\/+$/, "");
  return withoutTrailingSlash.startsWith("/") ? withoutTrailingSlash : `/${withoutTrailingSlash}`;
}

function normalizeExistingUtm(url: URL): void {
  for (const key of UTM_KEYS) {
    const value = url.searchParams.get(key);

    if (value) {
      url.searchParams.set(key, normalizeUtmValue(value));
    }
  }
}

function normalizeUtmValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.+-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, 128);
}

function cleanParamValue(value: string | null): string {
  if (!value) {
    return "";
  }

  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, MAX_PARAM_VALUE_LENGTH);
}

function isUtmKey(value: string): value is UtmKey {
  return UTM_KEYS.includes(value as UtmKey);
}

function isSafeParamName(value: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(value);
}

function isRedirectStatus(value: unknown): value is RedirectStatus {
  return value === 301 || value === 302 || value === 307 || value === 308;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function textResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...headers
    }
  });
}
