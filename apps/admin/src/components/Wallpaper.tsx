/**
 * "Ribbon" wallpaper: wide glossy colour ribbons, a warm orb and floating glass bubbles.
 * Drawn as inline SVG so it stays sharp at any size. The layers drift slowly and shift a few
 * pixels with the pointer (--mx, --my are set on the root element). All motion uses transform only.
 */
const BUBBLES = [
  { x: 210, y: 300, r: 62, d: 0, t: 9 },
  { x: 560, y: 640, r: 26, d: 1.5, t: 7 },
  { x: 880, y: 250, r: 38, d: 3, t: 11 },
  { x: 1180, y: 520, r: 90, d: 0.8, t: 12 },
  { x: 1450, y: 760, r: 70, d: 2.2, t: 10 },
  { x: 130, y: 780, r: 54, d: 4, t: 13 },
  { x: 760, y: 860, r: 34, d: 1, t: 8 },
  { x: 1020, y: 120, r: 24, d: 2.6, t: 9 },
  { x: 1500, y: 420, r: 30, d: 3.6, t: 7.5 },
];

export default function Wallpaper() {
  return (
    <div className="wall" aria-hidden="true">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
        <defs>
          <linearGradient id="gSky" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1f3bb8" />
            <stop offset="0.45" stopColor="#1a1250" />
            <stop offset="1" stopColor="#3a1160" />
          </linearGradient>
          <linearGradient id="gOrange" x1="0" y1="0" x2="1" y2="0.4">
            <stop offset="0" stopColor="#ff9a3d" />
            <stop offset="0.5" stopColor="#f0463f" />
            <stop offset="1" stopColor="#d02d7a" />
          </linearGradient>
          <linearGradient id="gMagenta" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d3337c" />
            <stop offset="1" stopColor="#6a2fd0" />
          </linearGradient>
          <linearGradient id="gBlue" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#2b6cf0" />
            <stop offset="1" stopColor="#5a3fe0" />
          </linearGradient>
          <linearGradient id="gPurple" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6a3df0" stopOpacity="0.9" />
            <stop offset="1" stopColor="#2f55e0" stopOpacity="0.8" />
          </linearGradient>
          <radialGradient id="gOrb" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#ffb347" />
            <stop offset="0.6" stopColor="#f2603a" />
            <stop offset="1" stopColor="#c8307a" />
          </radialGradient>
          <radialGradient id="gBub" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.55" stopColor="#fff" stopOpacity="0.02" />
            <stop offset="0.9" stopColor="#fff" stopOpacity="0.18" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.4" />
          </radialGradient>
          <filter id="fSoft" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>

        <rect width="1600" height="1000" fill="url(#gSky)" />

        <g className="par par-a">
          <circle cx="1380" cy="170" r="215" fill="url(#gOrb)" />
          <path className="drift d1" d="M-200 180 C 200 60, 520 260, 900 200 S 1450 60, 1850 180 L1850 -100 L-200 -100 Z" fill="url(#gBlue)" />
        </g>

        <g className="par par-b">
          <path className="drift d2" d="M-200 430 C 250 300, 520 520, 900 440 S 1500 300, 1850 400 L1850 530 C 1500 450, 1200 610, 900 570 S 300 450, -200 550 Z" fill="url(#gPurple)" />
          <path className="drift d3" d="M-200 650 C 100 480, 420 530, 700 650 S 1250 810, 1500 610 S 1750 490, 1850 550 L1850 910 C 1500 970, 1250 890, 950 970 S 350 970, 80 890 S -100 790, -200 830 Z" fill="url(#gOrange)" />
          <path d="M-200 650 C 100 480, 420 530, 700 650 S 1250 810, 1500 610 S 1750 490, 1850 550" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="2.5" />
          <path d="M-200 668 C 100 498, 420 548, 700 668 S 1250 828, 1500 628 S 1750 508, 1850 568" fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="26" filter="url(#fSoft)" />
        </g>

        <g className="par par-c">
          <path className="drift d4" d="M-200 790 C 150 710, 450 770, 800 870 S 1400 1010, 1850 830 L1850 1100 L-200 1100 Z" fill="url(#gMagenta)" />
          <path d="M-200 790 C 150 710, 450 770, 800 870 S 1400 1010, 1850 830" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" />
        </g>

        <g className="par par-d">
          {BUBBLES.map((b, i) => (
            <g key={i} transform={`translate(${b.x} ${b.y})`}>
              <g className="bubble" style={{ animationDelay: `${b.d}s`, animationDuration: `${b.t}s` }}>
                <circle r={b.r} fill="url(#gBub)" stroke="#fff" strokeOpacity="0.42" strokeWidth="1.5" />
                <ellipse cx={-b.r * 0.38} cy={-b.r * 0.42} rx={b.r * 0.22} ry={b.r * 0.11} fill="#fff" fillOpacity="0.75" transform={`rotate(-35 ${-b.r * 0.38} ${-b.r * 0.42})`} />
                <path d={`M ${b.r * 0.55} ${b.r * 0.35} A ${b.r * 0.66} ${b.r * 0.66} 0 0 1 ${b.r * 0.15} ${b.r * 0.66}`} fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round" />
              </g>
            </g>
          ))}
        </g>

        <rect className="veil" width="1600" height="1000" fill="#fff" />
      </svg>
    </div>
  );
}
