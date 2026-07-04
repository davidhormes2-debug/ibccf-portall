import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

function buildApp(enableBodyLogging: boolean) {
  const app = express();
  app.use(express.json());

  const logLines: string[] = [];

  if (enableBodyLogging) {
    app.use((req, res, next) => {
      let capturedJsonResponse: Record<string, any> | undefined = undefined;
      const originalResJson = res.json;
      res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
      };
      res.on("finish", () => {
        if (req.path.startsWith("/api")) {
          let line = `${req.method} ${req.path} ${res.statusCode}`;
          if (capturedJsonResponse) {
            line += ` :: ${JSON.stringify(capturedJsonResponse)}`;
          }
          logLines.push(line);
        }
      });
      next();
    });
  } else {
    app.use((req, res, next) => {
      res.on("finish", () => {
        if (req.path.startsWith("/api")) {
          logLines.push(`${req.method} ${req.path} ${res.statusCode}`);
        }
      });
      next();
    });
  }

  app.post("/api/admin/login", (_req, res) => {
    res.json({ token: "super-secret-bearer-token", user: "admin" });
  });

  app.post("/api/cases/login-pin", (_req, res) => {
    res.json({ sessionToken: "live-session-token", accessCode: "ACC-1234" });
  });

  return { app, logLines };
}

describe("API response body logging", () => {
  it("does NOT include response body in log lines when body logging is disabled (production posture)", async () => {
    const { app, logLines } = buildApp(false);

    await request(app).post("/api/admin/login").send({ username: "admin", password: "s3cr3t" });
    await request(app).post("/api/cases/login-pin").send({ pin: "1234" });

    expect(logLines).toHaveLength(2);
    for (const line of logLines) {
      expect(line).not.toContain("super-secret-bearer-token");
      expect(line).not.toContain("live-session-token");
      expect(line).not.toContain("ACC-1234");
      expect(line).not.toContain("::");
    }
  });

  it("includes response body in log lines only when body logging is explicitly enabled (dev/debug posture)", async () => {
    const { app, logLines } = buildApp(true);

    await request(app).post("/api/admin/login").send({ username: "admin", password: "s3cr3t" });

    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toContain("::");
    expect(logLines[0]).toContain("super-secret-bearer-token");
  });

  it("always logs operational metadata (method, path, status) regardless of body logging flag", async () => {
    for (const enableBody of [false, true]) {
      const { app, logLines } = buildApp(enableBody);
      await request(app).post("/api/admin/login").send({});

      expect(logLines[0]).toContain("POST");
      expect(logLines[0]).toContain("/api/admin/login");
      expect(logLines[0]).toContain("200");
    }
  });
});
