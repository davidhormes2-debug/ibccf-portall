import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { Shield, ArrowLeft, Play, Pause, Download, Volume2, VolumeX, Maximize2 } from "lucide-react";
import { BuildStampLine } from "@/components/BuildStampLine";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLocale } from "@/i18n/useLocale";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function WithdrawalGuidePage() {
  const { locale } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); }, []);

  const videoSrc = `/tutorial-videos/${locale.code}`;
  const downloadHref = `/tutorial-videos/${locale.code}?download=1`;
  const downloadFilename = `withdrawal-tutorial-${locale.code}.mp4`;

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function requestFullscreen() {
    const v = videoRef.current;
    if (!v) return;
    if (v.requestFullscreen) {
      void v.requestFullscreen();
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-slate-400 transition-colors hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm font-semibold uppercase tracking-widest">Back</span>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-12 focus:outline-none">
        {/* Hero */}
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5">
            <Shield className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-semibold uppercase tracking-widest text-amber-400">
              Help Center
            </span>
          </div>
          <h1 className="mb-3 text-4xl font-extrabold tracking-tight text-white md:text-5xl">
            Withdrawal Guide
          </h1>
          <p className="mx-auto max-w-xl text-base text-slate-400 leading-relaxed">
            A step-by-step animated walkthrough of all&nbsp;14 withdrawal stages. Watch
            online or download for offline reference — available in your language.
          </p>
        </div>

        {/* Video player card */}
        <div
          className="relative mx-auto overflow-hidden rounded-2xl"
          style={{
            background: "linear-gradient(135deg, rgba(200,169,81,0.10), rgba(200,169,81,0.04), rgba(15,23,42,0.95))",
            border: "1px solid rgba(200,169,81,0.30)",
            boxShadow: "0 8px 48px rgba(200,169,81,0.10), 0 2px 12px rgba(0,0,0,0.40)",
          }}
        >
          {/* Video element */}
          <div className="relative aspect-video w-full bg-black">
            {errored ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
                <Shield className="h-10 w-10 opacity-30" />
                <p className="text-sm">
                  Tutorial video is not available at this time.
                </p>
                <a
                  href="/"
                  className="rounded-lg border border-slate-700 px-4 py-1.5 text-xs text-slate-300 hover:border-slate-500 transition-colors"
                >
                  Return home
                </a>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className="h-full w-full object-contain"
                  preload="metadata"
                  playsInline
                  onCanPlay={() => {
                    if (errorTimerRef.current) {
                      clearTimeout(errorTimerRef.current);
                      errorTimerRef.current = null;
                    }
                    setLoaded(true);
                  }}
                  onError={() => {
                    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
                    errorTimerRef.current = setTimeout(() => setErrored(true), 200);
                  }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  aria-label="Withdrawal tutorial video"
                />

                {/* Click-to-play overlay shown before first play */}
                {!playing && (
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 transition-opacity hover:opacity-80"
                    aria-label="Play video"
                  >
                    <div
                      className="flex h-20 w-20 items-center justify-center rounded-full"
                      style={{
                        background: "rgba(200,169,81,0.22)",
                        border: "2px solid rgba(200,169,81,0.55)",
                        boxShadow: "0 0 32px rgba(200,169,81,0.25)",
                      }}
                    >
                      <Play className="h-9 w-9 text-amber-300 translate-x-0.5" />
                    </div>
                    {!loaded && (
                      <p className="text-xs uppercase tracking-widest text-slate-400">
                        Loading…
                      </p>
                    )}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Controls bar */}
          {!errored && (
            <div className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="rounded-lg border border-slate-700 p-2 text-slate-300 transition-colors hover:border-amber-500/40 hover:text-amber-300"
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4 translate-x-0.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={toggleMute}
                  className="rounded-lg border border-slate-700 p-2 text-slate-300 transition-colors hover:border-amber-500/40 hover:text-amber-300"
                  aria-label={muted ? "Unmute" : "Mute"}
                >
                  {muted ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={requestFullscreen}
                  className="rounded-lg border border-slate-700 p-2 text-slate-300 transition-colors hover:border-amber-500/40 hover:text-amber-300"
                  aria-label="Fullscreen"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>

              <a
                href={downloadHref}
                download={downloadFilename}
                data-testid="link-download-withdrawal-guide"
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-80"
                style={{
                  background: "rgba(200,169,81,0.18)",
                  border: "1px solid rgba(200,169,81,0.45)",
                }}
              >
                <Download className="h-4 w-4 text-amber-300" />
                Download
              </a>
            </div>
          )}
        </div>

        {/* Locale notice */}
        <p className="mt-4 text-center text-xs text-slate-500">
          Showing the{" "}
          <span className="font-semibold text-slate-400">{locale.label}</span>{" "}
          recording. Switch language above to load a different locale.
        </p>

        {/* Info cards */}
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "14 Stages",
              body: "Every phase of the withdrawal process is explained clearly, from case submission to final settlement.",
            },
            {
              title: "Localized",
              body: "Available in English, Spanish, French, German, Portuguese and Chinese — auto-matched to your language setting.",
            },
            {
              title: "Offline copy",
              body: "Download the MP4 and keep it for reference even when you're not connected to the portal.",
            },
          ].map(({ title, body }) => (
            <div
              key={title}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-6"
            >
              <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-amber-400">
                {title}
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        {/* CTA row */}
        <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/request-access"
            className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-6 py-3 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
          >
            Request portal access
          </Link>
          <Link
            href="/verify"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
          >
            Verify a platform
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-slate-800 py-8 px-4" role="contentinfo">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-xs text-slate-600 font-mono uppercase tracking-widest md:flex-row">
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5" />
            <span>IBCCF Enforcement Platform</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link href="/privacy-policy" className="hover:text-slate-400 transition-colors">Privacy</Link>
            <Link href="/terms-of-use" className="hover:text-slate-400 transition-colors">Terms</Link>
            <Link href="/legal-resources" className="hover:text-slate-400 transition-colors">Legal Resources</Link>
            <BuildStampLine className="text-slate-600" />
          </div>
        </div>
      </footer>
    </div>
  );
}
