/**
 * Soil node cross-section, drawn to scale in millimetres from drawing sheets 1–3:
 * head Ø86 × 178 sitting 10 mm above ground, lid Ø94, panel frame 117 wide at +229, antenna tip +310,
 * PVC pipe Ø75 down to −350, DS18B20 at −100, M1 centre −150 (east), M2 centre −300 (west), 106 mm probes,
 * radiation shield Ø70 on a 60 mm arm.
 */
const TOP = 400;               // highest point drawn, mm above ground (room for the radio arcs)
const y = (z: number) => TOP - z; // ground-up millimetres → SVG y

const callouts: { n: number; at: [number, number]; to: [number, number] }[] = [
  { n: 1, at: [30, 306], to: [118, 318] },
  { n: 2, at: [52, 229], to: [130, 252] },
  { n: 3, at: [-150, 140], to: [-205, 214] },
  { n: 4, at: [43, 100], to: [126, 92] },
  { n: 5, at: [0, -100], to: [-118, -82] },
  { n: 6, at: [143, -150], to: [196, -108] },
  { n: 7, at: [-143, -300], to: [-196, -246] },
];

export function SoilSection() {
  return (
    <svg className="soil" viewBox="-240 20 480 790" role="img"
      aria-label="Cross-section of the BHOOMI soil node: electronics head and solar panel above ground, PVC pipe below with a temperature probe at 10 cm and moisture probes at 15 and 30 cm.">
      <defs>
        <radialGradient id="wet" cx="50%" cy="50%" r="50%">
          <stop offset="0%" className="wet-0" />
          <stop offset="100%" className="wet-1" />
        </radialGradient>
        <pattern id="grain" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="4" r="1.1" className="grain" />
          <circle cx="10" cy="11" r=".8" className="grain" />
        </pattern>
      </defs>

      {/* soil: topsoil and subsoil, with depth ticks */}
      <rect x="-240" y={y(0)} width="480" height="200" className="soil-top" />
      <rect x="-240" y={y(-200)} width="480" height={y(-410) - y(-200)} className="soil-sub" />
      <rect x="-240" y={y(0)} width="480" height={y(-410) - y(0)} fill="url(#grain)" />
      <line x1="-240" x2="240" y1={y(0)} y2={y(0)} className="ground" />
      {[-200, -150, -120, -60, 70, 120, 175].map((x, i) => (
        <path key={x} d={`M${x} ${y(0)} l${i % 2 ? 4 : -3} -${10 + (i % 3) * 5}`} className="blade" />
      ))}
      {[[-150, "15 cm"], [-300, "30 cm"]].map(([z, label]) => (
        <g key={label as string} className="tick">
          <line x1="196" x2="240" y1={y(z as number)} y2={y(z as number)} />
          <text x="236" y={y(z as number) - 7} textAnchor="end">{label}</text>
        </g>
      ))}
      <text x="236" y={y(0) - 8} textAnchor="end" className="tick-label">ground</text>

      {/* moisture the probes sense */}
      <ellipse cx="108" cy={y(-150)} rx="70" ry="38" fill="url(#wet)" />
      <ellipse cx="-108" cy={y(-300)} rx="70" ry="38" fill="url(#wet)" />

      {/* PVC pipe and end cap */}
      <rect x="-37.5" y={y(10)} width="75" height={y(-350) - y(10)} className="pipe" />
      <rect x="-40" y={y(-350)} width="80" height="12" rx="2" className="cap" />

      {/* probes: caps at the pipe wall, PCB blades into undisturbed soil */}
      <rect x="37.5" y={y(-150) - 9} width="34" height="18" className="probe-cap" />
      <path d={`M71.5 ${y(-150) - 6} h66 l8 6 l-8 6 h-66 z`} className="probe" />
      <rect x="-71.5" y={y(-300) - 9} width="34" height="18" className="probe-cap" />
      <path d={`M-71.5 ${y(-300) - 6} h-66 l-8 6 l8 6 h66 z`} className="probe" />
      <circle cx="0" cy={y(-100)} r="6" className="ds" />

      {/* above ground: head, lid, panel, antenna, shield */}
      <rect x="-43" y={y(188)} width="86" height="178" rx="3" className="head" />
      <rect x="-47" y={y(192)} width="94" height="6" rx="2" className="lid" />
      <rect x="-12" y={y(212)} width="6" height="20" className="post" />
      <rect x="6" y={y(212)} width="6" height="20" className="post" />
      <rect x="-58.5" y={y(229)} width="117" height="17" rx="2" className="panel" />
      {[-30, 0, 30].map(x => <line key={x} x1={x} x2={x} y1={y(229) + 2} y2={y(229) + 15} className="panel-cell" />)}
      <rect x="27" y={y(310)} width="7" height={y(192) - y(310)} rx="3" className="antenna" />
      <rect x="-103" y={y(152)} width="60" height="6" className="post" />
      {[0, 1, 2, 3, 4].map(i => <rect key={i} x="-173" y={y(160) + i * 9} width="70" height="3.5" rx="1.5" className="shield" />)}
      <circle cx="0" cy={y(120)} r="3.5" className="led" />

      {/* radio: three arcs from the antenna tip */}
      {[22, 40, 58].map((r, i) => (
        <path key={r} d={`M${30 - r} ${y(312)} a${r} ${r} 0 0 1 ${r * 2} 0`} className="arc" style={{ opacity: 1 - i * 0.28 }} />
      ))}

      {/* numbered callouts, explained in the legend next to the drawing */}
      {callouts.map(c => (
        <g key={c.n} className="callout">
          <line x1={c.at[0]} y1={y(c.at[1])} x2={c.to[0]} y2={y(c.to[1])} />
          <circle cx={c.at[0]} cy={y(c.at[1])} r="3" className="callout-dot" />
          <circle cx={c.to[0]} cy={y(c.to[1])} r="15" className="callout-ring" />
          <text x={c.to[0]} y={y(c.to[1]) + 5.5} textAnchor="middle">{c.n}</text>
        </g>
      ))}
    </svg>
  );
}
