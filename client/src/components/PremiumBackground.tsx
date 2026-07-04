export const PremiumBackground = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ background: "#020912" }}>

    {/* ── Layer 1: Atmospheric depth hazes (huge, slow drift) ─────────────── */}
    <div style={{
      position: "absolute", top: "-35%", left: "-15%", width: "75%", height: "75%",
      background: "radial-gradient(ellipse, rgba(0,90,230,0.38) 0%, rgba(0,50,160,0.15) 45%, transparent 70%)",
      filter: "blur(90px)", animation: "orb-drift-1 20s ease-in-out infinite",
    }} />
    <div style={{
      position: "absolute", bottom: "-25%", right: "-10%", width: "65%", height: "65%",
      background: "radial-gradient(ellipse, rgba(80,20,240,0.28) 0%, rgba(60,0,180,0.1) 45%, transparent 70%)",
      filter: "blur(110px)", animation: "orb-drift-2 25s ease-in-out infinite",
    }} />
    <div style={{
      position: "absolute", top: "30%", right: "-5%", width: "50%", height: "60%",
      background: "radial-gradient(ellipse, rgba(0,170,220,0.18) 0%, transparent 65%)",
      filter: "blur(80px)", animation: "orb-drift-3 17s ease-in-out infinite 3s",
    }} />

    {/* ── Layer 2: Aurora bands ────────────────────────────────────────────── */}
    <div style={{
      position: "absolute", top: "8%", left: "-10%", right: "-10%", height: "260px",
      background: "linear-gradient(180deg, transparent, rgba(0,120,255,0.14) 40%, rgba(0,80,200,0.08) 70%, transparent)",
      filter: "blur(32px)", transform: "rotate(-3deg)",
      animation: "aurora-shift 14s ease-in-out infinite",
    }} />
    <div style={{
      position: "absolute", bottom: "12%", left: "-10%", right: "-10%", height: "200px",
      background: "linear-gradient(180deg, transparent, rgba(100,40,255,0.12) 40%, rgba(60,0,200,0.07) 70%, transparent)",
      filter: "blur(28px)", transform: "rotate(2deg)",
      animation: "aurora-shift-2 18s ease-in-out infinite 2s",
    }} />

    {/* ── Layer 3: HDR neon focal points (bright punch) ────────────────────── */}
    <div style={{
      position: "absolute", top: "12%", left: "58%", width: "280px", height: "280px",
      background: "radial-gradient(circle, rgba(0,160,255,0.55) 0%, rgba(0,100,220,0.2) 40%, transparent 68%)",
      filter: "blur(38px)", animation: "orb-drift-3 8s ease-in-out infinite",
    }} />
    <div style={{
      position: "absolute", top: "55%", left: "15%", width: "200px", height: "200px",
      background: "radial-gradient(circle, rgba(80,210,255,0.45) 0%, rgba(0,160,230,0.15) 45%, transparent 68%)",
      filter: "blur(28px)", animation: "orb-drift-1 10s ease-in-out infinite 1s",
    }} />
    <div style={{
      position: "absolute", bottom: "20%", right: "20%", width: "160px", height: "160px",
      background: "radial-gradient(circle, rgba(140,80,255,0.4) 0%, transparent 65%)",
      filter: "blur(22px)", animation: "orb-drift-2 11s ease-in-out infinite 2.5s",
    }} />

    {/* ── Layer 4: Perspective depth grid ─────────────────────────────────── */}
    <div style={{
      position: "absolute", inset: 0,
      backgroundImage: [
        "linear-gradient(rgba(255,255,255,0.032) 1px, transparent 1px)",
        "linear-gradient(90deg, rgba(255,255,255,0.032) 1px, transparent 1px)",
      ].join(","),
      backgroundSize: "52px 52px",
      animation: "grid-breathe 7s ease-in-out infinite",
    }} />

    {/* ── Layer 5: Thin HDR scan-line ──────────────────────────────────────── */}
    <div style={{
      position: "absolute", left: 0, right: 0, height: "1px",
      background: "linear-gradient(90deg, transparent 5%, rgba(0,180,255,0.65) 35%, rgba(120,220,255,0.8) 50%, rgba(0,180,255,0.65) 65%, transparent 95%)",
      boxShadow: "0 0 12px 3px rgba(0,160,255,0.3)",
      animation: "hdr-scan 10s ease-in-out infinite",
    }} />

    {/* ── Layer 6: Star field ───────────────────────────────────────────────── */}
    {[
      { top: "8%",  left: "12%",  delay: "0s",    size: 1.5 },
      { top: "15%", left: "72%",  delay: "0.7s",  size: 1 },
      { top: "22%", left: "43%",  delay: "1.4s",  size: 2 },
      { top: "35%", left: "88%",  delay: "2.1s",  size: 1 },
      { top: "42%", left: "6%",   delay: "0.3s",  size: 1.5 },
      { top: "58%", left: "55%",  delay: "1.8s",  size: 1 },
      { top: "65%", left: "30%",  delay: "0.9s",  size: 2 },
      { top: "72%", left: "80%",  delay: "2.4s",  size: 1 },
      { top: "82%", left: "18%",  delay: "1.1s",  size: 1.5 },
      { top: "88%", left: "62%",  delay: "0.5s",  size: 1 },
      { top: "5%",  left: "92%",  delay: "1.6s",  size: 1 },
      { top: "48%", left: "97%",  delay: "2.8s",  size: 1.5 },
    ].map((s, i) => (
      <div key={i} style={{
        position: "absolute", top: s.top, left: s.left,
        width: `${s.size}px`, height: `${s.size}px`,
        borderRadius: "50%", background: "rgba(180,220,255,0.9)",
        boxShadow: `0 0 ${s.size * 3}px rgba(100,180,255,0.7)`,
        animation: `star-twinkle ${2.5 + i * 0.3}s ease-in-out infinite`,
        animationDelay: s.delay,
      }} />
    ))}

    {/* ── Layer 7: Radial vignette ──────────────────────────────────────────── */}
    <div style={{
      position: "absolute", inset: 0,
      background: "radial-gradient(ellipse at 50% 50%, transparent 38%, rgba(2,9,18,0.55) 80%, rgba(2,9,18,0.85) 100%)",
    }} />

    {/* ── Layer 8: Top edge light bleed ────────────────────────────────────── */}
    <div style={{
      position: "absolute", top: 0, left: "15%", right: "15%", height: "3px",
      background: "linear-gradient(90deg, transparent, rgba(0,140,255,0.7) 30%, rgba(100,200,255,1) 50%, rgba(0,140,255,0.7) 70%, transparent)",
      boxShadow: "0 0 30px 8px rgba(0,120,255,0.35)",
    }} />
  </div>
);

export const SubduedSpaceBackground = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" style={{ background: "#020912" }}>

    {/* ── Layer 1: Atmospheric depth hazes (reduced opacity) ─────────────── */}
    <div style={{
      position: "absolute", top: "-30%", left: "-15%", width: "70%", height: "75%",
      background: "radial-gradient(ellipse, rgba(0,90,230,0.18) 0%, rgba(0,50,160,0.07) 45%, transparent 70%)",
      filter: "blur(100px)", animation: "orb-drift-1 28s ease-in-out infinite",
    }} />
    <div style={{
      position: "absolute", bottom: "-25%", right: "-10%", width: "60%", height: "65%",
      background: "radial-gradient(ellipse, rgba(80,20,240,0.14) 0%, rgba(60,0,180,0.05) 45%, transparent 70%)",
      filter: "blur(120px)", animation: "orb-drift-2 32s ease-in-out infinite",
    }} />
    <div style={{
      position: "absolute", top: "30%", right: "-5%", width: "45%", height: "55%",
      background: "radial-gradient(ellipse, rgba(0,170,220,0.09) 0%, transparent 65%)",
      filter: "blur(90px)", animation: "orb-drift-3 24s ease-in-out infinite 3s",
    }} />

    {/* ── Layer 2: Aurora bands (softer) ───────────────────────────────────── */}
    <div style={{
      position: "absolute", top: "10%", left: "-10%", right: "-10%", height: "240px",
      background: "linear-gradient(180deg, transparent, rgba(0,120,255,0.07) 40%, rgba(0,80,200,0.04) 70%, transparent)",
      filter: "blur(36px)", transform: "rotate(-3deg)",
      animation: "aurora-shift 18s ease-in-out infinite",
    }} />
    <div style={{
      position: "absolute", bottom: "14%", left: "-10%", right: "-10%", height: "200px",
      background: "linear-gradient(180deg, transparent, rgba(100,40,255,0.06) 40%, rgba(60,0,200,0.035) 70%, transparent)",
      filter: "blur(32px)", transform: "rotate(2deg)",
      animation: "aurora-shift-2 22s ease-in-out infinite 2s",
    }} />

    {/* ── Layer 3: Faint perspective grid ──────────────────────────────────── */}
    <div style={{
      position: "absolute", inset: 0,
      backgroundImage: [
        "linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px)",
        "linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)",
      ].join(","),
      backgroundSize: "64px 64px",
      animation: "grid-breathe 9s ease-in-out infinite",
    }} />

    {/* ── Layer 4: Sparse stars ────────────────────────────────────────────── */}
    {[
      { top: "12%", left: "18%", delay: "0s",   size: 1 },
      { top: "26%", left: "78%", delay: "1.2s", size: 1.5 },
      { top: "48%", left: "44%", delay: "0.6s", size: 1 },
      { top: "62%", left: "12%", delay: "2.0s", size: 1 },
      { top: "74%", left: "86%", delay: "0.9s", size: 1.5 },
      { top: "88%", left: "36%", delay: "1.6s", size: 1 },
    ].map((s, i) => (
      <div key={i} style={{
        position: "absolute", top: s.top, left: s.left,
        width: `${s.size}px`, height: `${s.size}px`,
        borderRadius: "50%", background: "rgba(180,220,255,0.55)",
        boxShadow: `0 0 ${s.size * 3}px rgba(100,180,255,0.35)`,
        animation: `star-twinkle ${3.5 + i * 0.4}s ease-in-out infinite`,
        animationDelay: s.delay,
      }} />
    ))}

    {/* ── Layer 5: Vignette to seat content ────────────────────────────────── */}
    <div style={{
      position: "absolute", inset: 0,
      background: "radial-gradient(ellipse at 50% 50%, transparent 35%, rgba(2,9,18,0.55) 80%, rgba(2,9,18,0.85) 100%)",
    }} />
  </div>
);

export default PremiumBackground;
