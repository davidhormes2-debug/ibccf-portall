import { describe, it, expect } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";

const SERVER_ENTRY = path.resolve(__dirname, "index.ts");
const TSX_BIN = path.resolve(__dirname, "..", "node_modules", ".bin", "tsx");

const STRONG_SECRET = "X7#mQpLt2@WzKjR9dNvYsB4eCgHuFqAo";
const STRONG_PASSWORD = "Str0ng!Pass#word99";
const STRONG_USERNAME = "ibccf_superuser_x9";

type BootResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function spawnServer(env: Record<string, string | undefined>): ChildProcessWithoutNullStreams {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") childEnv[k] = v;
  }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  delete childEnv.ALLOW_WEAK_ADMIN_USERNAME;
  delete childEnv.ALLOW_WEAK_ADMIN_PASSWORD;
  delete childEnv.ALLOW_WEAK_SESSION_SECRET;

  return spawn(TSX_BIN, [SERVER_ENTRY], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as ChildProcessWithoutNullStreams;
}

/**
 * Like spawnServer but does NOT strip escape-hatch flags, so callers can
 * explicitly set ALLOW_WEAK_ADMIN_PASSWORD / ALLOW_WEAK_SESSION_SECRET /
 * ALLOW_WEAK_ADMIN_USERNAME to test the production fatal-exit behavior.
 */
function spawnServerWithFlags(env: Record<string, string | undefined>): ChildProcessWithoutNullStreams {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") childEnv[k] = v;
  }
  delete childEnv.ALLOW_WEAK_ADMIN_USERNAME;
  delete childEnv.ALLOW_WEAK_ADMIN_PASSWORD;
  delete childEnv.ALLOW_WEAK_SESSION_SECRET;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }

  return spawn(TSX_BIN, [SERVER_ENTRY], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as ChildProcessWithoutNullStreams;
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<BootResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Server did not exit within ${timeoutMs}ms. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function waitForListening(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<BootResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const onStdout = (b: Buffer) => {
      stdout += b.toString();
      if (/serving on port \d+/.test(stdout)) {
        cleanup();
        resolve({ code: null, signal: null, stdout, stderr });
      }
    };
    const onStderr = (b: Buffer) => { stderr += b.toString(); };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolve({ code, signal, stdout, stderr });
    };
    const timer = setTimeout(() => {
      cleanup();
      child.kill("SIGKILL");
      reject(new Error(`Server did not bind within ${timeoutMs}ms. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    }
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("exit", onExit);
  });
}

async function killAndWait(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

describe("server boot — SESSION_SECRET weak-value rejection (integration)", () => {
  it("exits with code 1 when SESSION_SECRET is absent (undefined)", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: undefined,
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
    expect(result.stderr).toContain("SESSION_SECRET");
  }, 35_000);

  it("exits with code 1 within a few seconds when SESSION_SECRET is too short", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: "tooshort",
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
    expect(result.stderr).toContain("SESSION_SECRET");
  }, 35_000);

  it("exits with code 1 when SESSION_SECRET is a known-insecure blocklist value", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: "secret",
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
    expect(result.stderr).toContain("SESSION_SECRET");
  }, 35_000);

  it("exits with code 1 when SESSION_SECRET has low entropy (repetitive characters)", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
    expect(result.stderr).toContain("SESSION_SECRET");
  }, 35_000);
});

describe("server boot — ADMIN_PASSWORD weak-value rejection (integration)", () => {
  it("exits with code 1 when ADMIN_PASSWORD is absent (undefined)", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: undefined,
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
    expect(result.stderr).toContain("ADMIN_PASSWORD");
  }, 35_000);

  it("exits with code 1 within a few seconds when ADMIN_PASSWORD is 'password'", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: "password",
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
    expect(result.stderr).toContain("ADMIN_PASSWORD");
  }, 35_000);

  it("exits with code 1 when ADMIN_PASSWORD is too short", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: "abc",
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
    expect(result.stderr).toContain("ADMIN_PASSWORD");
  }, 35_000);

  it("exits with code 1 when ADMIN_PASSWORD is a common known-weak value", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: "123456789",
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
    expect(result.stderr).toContain("ADMIN_PASSWORD");
  }, 35_000);
});

describe("server boot — ADMIN_USERNAME trivial-value rejection (integration)", () => {
  it("exits with code 1 when ADMIN_USERNAME is absent (undefined)", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: undefined,
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
    expect(result.stderr).toContain("ADMIN_USERNAME");
  }, 35_000);

  it("exits with code 1 within a few seconds when ADMIN_USERNAME is 'admin'", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
    expect(result.stderr).toContain("ADMIN_USERNAME");
  }, 35_000);

  it("exits with code 1 when ADMIN_USERNAME is 'root'", async () => {
    const child = spawnServer({
      ADMIN_USERNAME: "root",
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "development",
      PORT: "0",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
  }, 35_000);

  it("boots and binds the port when ADMIN_USERNAME is a strong, non-trivial value", async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawnServer({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "development",
      PORT: String(port),
    });
    try {
      const result = await waitForListening(child, 60_000);
      expect(result.code).toBeNull();
      expect(result.stdout).toMatch(/serving on port \d+/);
    } finally {
      await killAndWait(child);
    }
  }, 90_000);
});

describe("server boot — production escape-hatch flags fatal exit (integration)", () => {
  it("exits with code 1 when ALLOW_WEAK_ADMIN_PASSWORD=1 is set in production with strong credentials", async () => {
    const child = spawnServerWithFlags({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "production",
      PORT: "0",
      ALLOW_WEAK_ADMIN_PASSWORD: "1",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
  }, 35_000);

  it("exits with code 1 when ALLOW_WEAK_SESSION_SECRET=1 is set in production with strong credentials", async () => {
    const child = spawnServerWithFlags({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "production",
      PORT: "0",
      ALLOW_WEAK_SESSION_SECRET: "1",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
  }, 35_000);

  it("exits with code 1 when ALLOW_WEAK_ADMIN_USERNAME=1 is set in production with strong credentials", async () => {
    const child = spawnServerWithFlags({
      ADMIN_USERNAME: STRONG_USERNAME,
      ADMIN_PASSWORD: STRONG_PASSWORD,
      SESSION_SECRET: STRONG_SECRET,
      NODE_ENV: "production",
      PORT: "0",
      ALLOW_WEAK_ADMIN_USERNAME: "1",
    });
    const result = await waitForExit(child, 30_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[SECURITY]");
  }, 35_000);
});
