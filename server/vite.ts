import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import {
  prerenderIndexHtml,
  prerenderCommunityThreadHtml,
  matchCommunityThreadPath,
  type CommunityThreadSeoData,
} from "./seo/prerender";
import { db } from "./db";
import { communityThreads } from "@shared/schema";
import { eq } from "drizzle-orm";

async function getCommunityThreadSeoDataDev(
  id: number,
): Promise<CommunityThreadSeoData | null> {
  try {
    const [row] = await db
      .select({
        id: communityThreads.id,
        title: communityThreads.title,
        content: communityThreads.content,
        authorHandle: communityThreads.authorHandle,
        createdAt: communityThreads.createdAt,
        viewCount: communityThreads.viewCount,
        replyCount: communityThreads.replyCount,
        isFlagged: communityThreads.isFlagged,
      })
      .from(communityThreads)
      .where(eq(communityThreads.id, id));
    if (!row || row.isFlagged) return null;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      authorHandle: row.authorHandle,
      createdAt: row.createdAt as unknown as string,
      viewCount: row.viewCount ?? 0,
      replyCount: row.replyCount ?? 0,
    };
  } catch {
    return null;
  }
}

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      let page = await vite.transformIndexHtml(url, template);
      // Localise <title>, meta tags, and inject SEO body copy for the
      // marketing routes so search engines / no-JS crawlers see the
      // requested language in the initial payload — not English. The
      // React app renders over the injected block during hydration
      // (createRoot.render replaces #root children, no hydrate warning).
      const pathname = url.split("?")[0] || "/";
      const threadId = matchCommunityThreadPath(pathname);
      const prerendered = threadId !== null
        ? prerenderCommunityThreadHtml({
            template: page,
            url,
            acceptLanguage: req.headers["accept-language"] as string | undefined,
            host: (req.headers["x-forwarded-host"] as string | undefined)
              ?? (req.headers.host as string | undefined),
            proto: (req.headers["x-forwarded-proto"] as string | undefined)
              ?? req.protocol,
            thread: await getCommunityThreadSeoDataDev(threadId),
          })
        : prerenderIndexHtml({
            template: page,
            url,
            acceptLanguage: req.headers["accept-language"] as string | undefined,
            host: (req.headers["x-forwarded-host"] as string | undefined)
              ?? (req.headers.host as string | undefined),
            proto: (req.headers["x-forwarded-proto"] as string | undefined)
              ?? req.protocol,
          });
      page = prerendered.html;
      if (prerendered.rewrote) {
        res.setHeader("Content-Language", prerendered.locale);
        res.setHeader("Vary", "Accept-Language");
      }
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
