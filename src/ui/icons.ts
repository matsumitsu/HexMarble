import { hexCorner } from '../core/hex';
import { getPart, type PartType } from '../core/parts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** パーツ定義の経路データから、パレット用のアイコン（SVG）を生成する */
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
  if (type === 'support') extra = `<polygon points="${corners}" fill="${color}" opacity="0.5" transform="scale(0.75)"/>`;
  if (type === 'slope') extra = `<text x="0" y="0.62" font-size="0.42" text-anchor="middle" fill="${color}">▼</text>`;
  return `<svg viewBox="-1 -1 2 2" width="${size}" height="${size}" aria-hidden="true"><polygon points="${corners}" fill="#1b2230" stroke="#4b5b77" stroke-width="0.05"/>${lines}${extra}</svg>`;
}
