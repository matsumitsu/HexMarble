import { hexCorner } from '../core/hex';
import { getPart, type PartType } from '../core/parts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** タイル定義の経路データから、パレット用のアイコン（SVG）を生成する */
export function partIconSvg(type: PartType, size = 40): string {
  const def = getPart(type);
  const s = 0.95;
  const corners = Array.from({ length: 6 }, (_, i) => hexCorner(i, s))
    .map((c) => `${c.x.toFixed(3)},${c.z.toFixed(3)}`)
    .join(' ');
  const color = hex(def.color);
  const lines = def.routes
    .map((r) => {
      const pts = r.points.filter((_, i, a) => i === 0 || i === a.length - 1 || i % 3 === 0);
      return `<polyline points="${pts.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="0.16" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  let extra = '';
  if (type === 'start') extra = `<rect x="-0.72" y="-0.25" width="0.18" height="0.5" fill="${color}"/>`;
  if (type === 'goal') extra = `<circle r="0.3" fill="${color}"/>`;
  if (type === 'drop') extra = `<circle r="0.26" fill="none" stroke="${color}" stroke-width="0.1"/><circle r="0.12" fill="#0b0f17"/>`;
  const mark = (t: string, y = 0.62, size = 0.42) => `<text x="0" y="${y}" font-size="${size}" text-anchor="middle" fill="${color}" font-weight="bold">${t}</text>`;
  if (type === 'steep') extra = mark('▼▼', 0.66, 0.34);
  if (type === 'funnel') extra = `<circle r="0.5" fill="none" stroke="${color}" stroke-width="0.06" opacity="0.6"/><circle r="0.14" fill="#0b0f17"/>`;
  if (type === 'booster') extra = mark('»', -0.25, 0.6);
  if (type === 'brake') extra = mark('≡', -0.25, 0.5);
  if (type === 'loop') extra = mark('↻', -0.28, 0.55);
  if (type === 'lift') extra = mark('▲', -0.3, 0.42);
  if (type === 'jump') extra = mark('⤴', -0.25, 0.55);
  if (type === 'warp') extra = `<circle r="0.24" fill="none" stroke="${color}" stroke-width="0.1"/><circle r="0.1" fill="${color}" opacity="0.6"/>`;
  if (type === 'chime') extra = mark('♪', -0.22, 0.55);
  if (type === 'seesaw') extra = `<line x1="0.45" y1="-0.45" x2="0.45" y2="0.45" stroke="${color}" stroke-width="0.1" transform="rotate(-15 0.45 0)"/>`;
  if (type === 'slope') extra = `<text x="0" y="0.62" font-size="0.42" text-anchor="middle" fill="${color}">▼</text>`;
  return `<svg viewBox="-1 -1 2 2" width="${size}" height="${size}" aria-hidden="true"><polygon points="${corners}" fill="#1b2230" stroke="#4b5b77" stroke-width="0.05"/>${lines}${extra}</svg>`;
}
