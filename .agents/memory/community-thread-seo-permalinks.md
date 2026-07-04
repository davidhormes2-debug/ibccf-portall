---
name: Community thread SEO permalinks
description: Pattern for giving dynamic (DB-backed) pages their own crawlable canonical URL alongside a static SPA route table.
---

Community threads (`/community/:threadId`) needed real, indexable permalinks even though thread content is dynamic and DB-backed, unlike the rest of the SEO prerender system which is pre-baked from `seo.json` at build time.

**Why:** The existing prerender/hreflang/sitemap pipeline (`server/seo/prerender.ts`, `client/src/i18n/useHreflangTags.ts`, `server/routes/sitemap.ts`) was designed around a fixed, enumerable set of marketing routes and division IDs. Dynamic per-row pages don't fit that model directly — you can't pre-bake copy for rows that don't exist yet, and you can't leave the route out of the sitemap/hreflang system either or it's uncrawlable.

**How to apply:** When adding a new class of dynamic public detail page that needs its own canonical URL:
- Keep the same numeric-path regex duplicated in exactly three places, each with a comment pointing at the other two: the client route matcher (wouter `useRoute`), the hreflang `isPublicPath()` allowlist, and the server prerender path matcher. All three must move together or hreflang/canonical tags silently stop firing for the new route.
- Keep the prerender function itself DB-free (pure string transform taking pre-fetched row data as input) so it stays unit-testable without mocking the database; let the caller (`server/static.ts` prod, `server/vite.ts` dev) do the DB fetch and cache.
- In the sitemap route, wrap the dynamic-rows query in its own try/catch so a transient DB error degrades to "skip the dynamic entries" rather than breaking the entire sitemap response.
- A missing/hidden row should still resolve the URL (return `noindex` + a generic fallback) rather than 404ing, so removed/moderated content doesn't leave a dangling indexed URL with no signal to deindex it.
