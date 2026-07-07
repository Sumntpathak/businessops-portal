import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { load } from "cheerio";
import ipaddr from "ipaddr.js";
import robotsParserPackage from "robots-parser";

const robotsParser = robotsParserPackage as unknown as (
  url: string,
  robotstxt: string
) => {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
};

const USER_AGENT = "ReceptoBot/1.0";
const MAX_PAGES = 10;
const MAX_TOTAL_TEXT_BYTES = 500 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 10_000;

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export interface StubService {
  name: string;
  durationMinutes: number;
  price: string | null;
  description: string;
}

export interface StubBusinessHour {
  weekday: number;
  opens: string;
  closes: string;
  closed: boolean;
}

export interface StubDraft {
  agentMd: string;
  services: StubService[];
  businessHours: StubBusinessHour[];
}

function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Crawler only supports HTTP and HTTPS URLs");
  }

  if (url.username || url.password) {
    throw new Error("Crawler URLs must not contain credentials");
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Crawler refused a local hostname");
  }

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new Error("Crawler refused a non-public IP address");
    }
    return url;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Crawler hostname resolved to a non-public IP address");
  }

  return url;
}

function normalizedDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function priority(url: URL): number {
  const path = url.pathname.toLowerCase();

  if (path === "/" || path === "") return 0;
  if (/about|company|who-we-are/.test(path)) return 10;
  if (/service|treatment|product|menu/.test(path)) return 20;
  if (/pricing|price|fees|plans/.test(path)) return 30;
  if (/contact|location|find-us/.test(path)) return 40;
  if (/book|appointment|schedule/.test(path)) return 50;
  return 100;
}

export function rankCrawlUrls(baseUrl: string, candidates: readonly string[]): string[] {
  const base = new URL(baseUrl);
  const domain = normalizedDomain(base.hostname);
  const homepage = new URL("/", base.origin).toString();
  const unique = new Map<string, URL>();

  for (const candidate of [homepage, base.toString(), ...candidates]) {
    try {
      const url = new URL(candidate, base);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        normalizedDomain(url.hostname) !== domain
      ) {
        continue;
      }

      url.hash = "";
      url.search = "";
      const key = url.toString();
      unique.set(key, url);
    } catch {
      // Ignore malformed links discovered in page markup or search results.
    }
  }

  return [...unique.values()]
    .sort((left, right) => {
      const score = priority(left) - priority(right);
      return score || left.pathname.localeCompare(right.pathname);
    })
    .slice(0, MAX_PAGES)
    .map((url) => url.toString());
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error("Crawler response exceeded the size limit");
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchPublicText(
  rawUrl: string,
  accept: string,
  maxBytes = MAX_RESPONSE_BYTES
): Promise<{ finalUrl: string; status: number; contentType: string; text: string }> {
  let current = (await assertPublicUrl(rawUrl)).toString();

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

    try {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept,
          "user-agent": USER_AGENT
        }
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("Crawler received a redirect without a location");
        }
        current = (await assertPublicUrl(new URL(location, current).toString())).toString();
        continue;
      }

      return {
        finalUrl: current,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        text: await readLimitedText(response, maxBytes)
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Crawler exceeded the redirect limit");
}

function extractPage(html: string, pageUrl: string): {
  page: CrawledPage;
  links: string[];
} {
  const $ = load(html);
  const title = $("title").first().text().trim() || new URL(pageUrl).hostname;
  const links = $("a[href]")
    .map((_, element) => {
      const href = $(element).attr("href");
      if (!href) return null;
      try {
        return new URL(href, pageUrl).toString();
      } catch {
        return null;
      }
    })
    .get()
    .filter((url): url is string => Boolean(url));

  $("script, style, noscript, svg, canvas, iframe, form, nav, footer").remove();
  const root = $("main, article").first();
  const text = (root.length ? root.text() : $("body").text())
    .replace(/\s+/g, " ")
    .trim();

  return {
    page: { url: pageUrl, title, text },
    links
  };
}

function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return text;
  return bytes.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/, "");
}

export async function braveSearch(
  query: string,
  apiKey: string
): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

  try {
    const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("count", "5");

    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "x-subscription-token": apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`Brave Search failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      web?: { results?: Array<{ url?: string }> };
    };

    return (body.web?.results ?? [])
      .map((result) => result.url)
      .filter((url): url is string => Boolean(url));
  } finally {
    clearTimeout(timeout);
  }
}

export async function crawlWebsite(
  providedUrl: string,
  searchUrls: readonly string[]
): Promise<CrawledPage[]> {
  const base = await assertPublicUrl(providedUrl);
  const robotsUrl = new URL("/robots.txt", base.origin).toString();
  const robotsResponse = await fetchPublicText(
    robotsUrl,
    "text/plain, */*;q=0.1",
    256 * 1024
  );

  if (robotsResponse.status !== 404 && robotsResponse.status >= 400) {
    throw new Error(`Could not read robots.txt (HTTP ${robotsResponse.status})`);
  }

  const robots = robotsParser(
    robotsUrl,
    robotsResponse.status === 404 ? "" : robotsResponse.text
  );
  const homepageUrl = new URL("/", base.origin).toString();

  if (robots.isAllowed(homepageUrl, USER_AGENT) === false) {
    throw new Error("robots.txt disallows crawling the homepage");
  }

  const homepageResponse = await fetchPublicText(
    homepageUrl,
    "text/html, application/xhtml+xml"
  );

  if (!homepageResponse.contentType.includes("text/html")) {
    throw new Error("Business homepage did not return HTML");
  }

  const homepage = extractPage(homepageResponse.text, homepageResponse.finalUrl);
  const urls = rankCrawlUrls(base.toString(), [
    ...searchUrls,
    ...homepage.links
  ]);
  const pages: CrawledPage[] = [];
  let totalBytes = 0;

  for (const url of urls) {
    if (robots.isAllowed(url, USER_AGENT) === false) {
      continue;
    }

    let extracted = url === homepage.page.url ? homepage : null;

    if (!extracted) {
      const response = await fetchPublicText(
        url,
        "text/html, application/xhtml+xml"
      );

      if (!response.contentType.includes("text/html") || !response.text) {
        continue;
      }
      extracted = extractPage(response.text, response.finalUrl);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (!extracted.page.text) {
      continue;
    }

    const remaining = MAX_TOTAL_TEXT_BYTES - totalBytes;
    if (remaining <= 0) break;

    const text = truncateUtf8(extracted.page.text, remaining);
    const page = { ...extracted.page, text };
    totalBytes += Buffer.byteLength(text, "utf8");
    pages.push(page);

    if (totalBytes >= MAX_TOTAL_TEXT_BYTES || pages.length >= MAX_PAGES) {
      break;
    }
  }

  return pages;
}

// FABLE-TODO: Claude call — distill crawl_result into agent.md draft + services[] + business_hours[].
export function stubDistill(businessName: string): StubDraft {
  const review = "[REVIEW: fill from crawl]";
  const agentMd = [
    `# ${businessName} Reception Agent`,
    "",
    "## Identity",
    `You are the helpful AI receptionist for ${businessName}.`,
    "",
    "## Business summary",
    review,
    "",
    "## Address and contact",
    review,
    "",
    "## Services",
    review,
    "",
    "## Pricing",
    review,
    "",
    "## Business hours",
    review,
    "",
    "## Booking rules",
    "- Confirm the caller's name, phone number, service, date, and time.",
    "- Never promise a slot until calendar availability is confirmed.",
    "",
    "## Frequently asked questions",
    review,
    "",
    "## Escalation",
    "- If unsure, take a message for staff instead of inventing an answer.",
    "- For emergencies, advise the caller to contact local emergency services.",
    "",
    "## Privacy",
    "- Collect only information needed to answer the question or complete the booking.",
    "- Never disclose one caller's information to another."
  ].join("\n");

  return {
    agentMd,
    services: [
      {
        name: "Consultation",
        durationMinutes: 30,
        price: null,
        description: review
      },
      {
        name: "Standard appointment",
        durationMinutes: 60,
        price: null,
        description: review
      }
    ],
    businessHours: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      opens: weekday === 0 ? "00:00:00" : "09:00:00",
      closes: weekday === 0 ? "00:00:00" : "17:00:00",
      closed: weekday === 0
    }))
  };
}
