import { describe, it, expect } from "vitest";
import {
  matchCommunityThreadPath,
  prerenderCommunityThreadHtml,
  type CommunityThreadSeoData,
} from "../seo/prerender";

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <title>IBCCF</title>
    <meta name="description" content="default description" />
    <meta property="og:title" content="default og title" />
    <meta property="og:description" content="default og description" />
    <meta property="og:url" content="https://ibccf.site/" />
    <meta name="twitter:title" content="default twitter title" />
    <meta name="twitter:description" content="default twitter description" />
    <link rel="canonical" href="https://ibccf.site/" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const THREAD: CommunityThreadSeoData = {
  id: 42,
  title: "Withdrawal delayed for 3 weeks — anyone else?",
  content:
    "I submitted my withdrawal request three weeks ago and still no update. " +
    "Has anyone else experienced this kind of delay with their case?",
  authorHandle: "CaseHolder_92",
  createdAt: "2026-05-01T12:00:00.000Z",
  viewCount: 128,
  replyCount: 4,
};

function render(input: Partial<Parameters<typeof prerenderCommunityThreadHtml>[0]> = {}) {
  return prerenderCommunityThreadHtml({
    template: TEMPLATE,
    url: "/community/42",
    acceptLanguage: undefined,
    host: "ibccf.site",
    proto: "https",
    buildStamp: "test-build",
    thread: THREAD,
    ...input,
  });
}

describe("matchCommunityThreadPath", () => {
  it("matches a numeric thread path and returns the id", () => {
    expect(matchCommunityThreadPath("/community/42")).toBe(42);
  });

  it("returns null for the community list path", () => {
    expect(matchCommunityThreadPath("/community")).toBeNull();
  });

  it("returns null for non-numeric ids", () => {
    expect(matchCommunityThreadPath("/community/abc")).toBeNull();
  });

  it("returns null for zero or negative ids", () => {
    expect(matchCommunityThreadPath("/community/0")).toBeNull();
    expect(matchCommunityThreadPath("/community/-1")).toBeNull();
  });

  it("returns null for unrelated paths", () => {
    expect(matchCommunityThreadPath("/divisions/legal")).toBeNull();
  });
});

describe("prerenderCommunityThreadHtml", () => {
  it("does not rewrite when the URL is not a community thread permalink", () => {
    const result = render({ url: "/community" });
    expect(result.rewrote).toBe(false);
    expect(result.found).toBe(false);
    expect(result.html).toBe(TEMPLATE);
  });

  it("rewrites <title>, meta description, and OG/Twitter tags from the thread", () => {
    const result = render();
    expect(result.rewrote).toBe(true);
    expect(result.found).toBe(true);
    expect(result.html).toContain(
      `<title>${THREAD.title} — Community Discussion | IBCCF</title>`,
    );
    expect(result.html).toContain(
      `<meta name="description" content="${THREAD.content}" />`,
    );
    expect(result.html).toContain(
      `<meta property="og:title" content="${THREAD.title} — Community Discussion | IBCCF" />`,
    );
    expect(result.html).toContain(
      `<meta property="og:url" content="https://ibccf.site/community/42" />`,
    );
  });

  it("sets the canonical link to the un-prefixed English permalink", () => {
    const result = render();
    expect(result.html).toContain(
      `<link rel="canonical" href="https://ibccf.site/community/42" />`,
    );
  });

  it("emits hreflang alternates for every supported locale plus x-default", () => {
    const result = render();
    expect(result.html).toMatch(/hreflang="es" href="https:\/\/ibccf\.site\/community\/42\?lang=es"/);
    expect(result.html).toContain('hreflang="x-default"');
  });

  it("injects DiscussionForumPosting JSON-LD with thread stats", () => {
    const result = render();
    const match = result.html.match(
      /<script type="application\/ld\+json" data-community-thread-seo>([\s\S]*?)<\/script>/,
    );
    expect(match).toBeTruthy();
    const json = JSON.parse(match![1]);
    expect(json["@type"]).toBe("DiscussionForumPosting");
    expect(json.headline).toBe(THREAD.title);
    expect(json.author).toEqual({ "@type": "Person", name: THREAD.authorHandle });
    expect(json.interactionStatistic).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          interactionType: "https://schema.org/ViewAction",
          userInteractionCount: THREAD.viewCount,
        }),
        expect.objectContaining({
          interactionType: "https://schema.org/CommentAction",
          userInteractionCount: THREAD.replyCount,
        }),
      ]),
    );
  });

  it("does not emit JSON-LD or index the page when the thread is null (missing/hidden)", () => {
    const result = render({ thread: null });
    expect(result.found).toBe(false);
    expect(result.rewrote).toBe(true);
    expect(result.html).not.toContain("data-community-thread-seo");
    expect(result.html).toContain('<meta name="robots" content="noindex, follow" />');
    expect(result.html).toContain("<title>Discussion Not Found | IBCCF</title>");
  });

  it("injects a build-stamp meta tag when provided", () => {
    const result = render();
    expect(result.html).toContain('<meta name="build-stamp" content="test-build" />');
  });

  it("injects an SEO body block into #root with the thread title", () => {
    const result = render();
    expect(result.html).toMatch(/<div id="root"><div data-prerender="true"/);
    expect(result.html).toContain(THREAD.title);
  });
});
