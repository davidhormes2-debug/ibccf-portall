async function rawProbe(label: string, dsn: string | undefined) {
  console.log(`\n=== ${label} ===`);
  if (!dsn) return;
  const m = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/);
  if (!m) { console.log("no match"); return; }
  const [, publicKey, host, projectId] = m;
  console.log(`host=${host} projectId=${projectId} publicKey=${publicKey.slice(0,8)}...`);

  const ts = Math.floor(Date.now() / 1000);
  const eventId = Array.from({length:32}, () => Math.floor(Math.random()*16).toString(16)).join("");
  const auth = `Sentry sentry_version=7,sentry_client=raw-probe/1.0,sentry_key=${publicKey}`;
  const event = {
    event_id: eventId,
    timestamp: ts,
    platform: "node",
    level: "error",
    message: { formatted: `RAW PROBE :: ${label} :: ${new Date().toISOString()}` },
  };
  const body = JSON.stringify(event);
  const url = `https://${host}/api/${projectId}/store/`;
  console.log(`POST ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": auth,
    },
    body,
  });
  console.log(`status=${res.status}`);
  const text = await res.text();
  console.log(`body=${text}`);
}

(async () => {
  await rawProbe("SENTRY_DSN", process.env.SENTRY_DSN);
  await rawProbe("VITE_SENTRY_DSN", process.env.VITE_SENTRY_DSN);
})();
