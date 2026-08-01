/**
 * 生成 demo 画布用的占位图。
 *
 * 占位图只是为了让演示画布在没有真实素材时也能成立。要换成真实素材，
 * 直接把同名文件替换成 .jpg/.png 并同步改 canvas.json 里的 imageUrl 即可，
 * 不需要改动其它代码。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

/** 一张占位图 = 渐变底 + 几何构图 + 角标文字，风格与官网一致 */
function frame({ w, h, from, to, accent, label, kind }) {
  const cx = w / 2;
  const horizon = Math.round(h * 0.68);

  const subject = kind === 'portrait'
    // 立绘：一个抽象人形剪影
    ? `<ellipse cx="${cx}" cy="${horizon - h * 0.3}" rx="${w * 0.11}" ry="${w * 0.13}" fill="rgba(0,0,0,0.5)"/>
       <path d="M${cx - w * 0.18} ${horizon} q${w * 0.18} -${h * 0.22} ${w * 0.36} 0 Z" fill="rgba(0,0,0,0.5)"/>
       <circle cx="${cx}" cy="${horizon - h * 0.3}" r="${w * 0.14}" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="1.5"/>`
    // 场景：远山 + 地平线
    : `<path d="M0 ${horizon} L${w * 0.28} ${horizon - h * 0.24} L${w * 0.46} ${horizon - h * 0.08} L${w * 0.66} ${horizon - h * 0.3} L${w} ${horizon} Z" fill="rgba(0,0,0,0.45)"/>
       <circle cx="${w * 0.74}" cy="${h * 0.24}" r="${Math.min(w, h) * 0.09}" fill="${accent}" fill-opacity="0.5"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.42" r="0.75">
      <stop offset="55%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.55)"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  ${subject}
  <rect width="${w}" height="${h}" fill="url(#v)"/>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="rgba(255,255,255,0.14)"/>
  <text x="14" y="${h - 14}" font-family="ui-monospace, Menlo, monospace" font-size="12"
        fill="rgba(255,255,255,0.62)" letter-spacing="0.06em">${label}</text>
</svg>`;
}

/** 分镜节点用的九宫格占位 */
function storyboard({ w, h, cols, rows, accent }) {
  const cw = w / cols;
  const ch = h / rows;
  let cells = '';
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      const shade = 0.1 + ((i * 7) % 5) * 0.045;
      cells += `<rect x="${c * cw}" y="${r * ch}" width="${cw}" height="${ch}" fill="rgba(255,255,255,${shade.toFixed(3)})"/>
      <circle cx="${c * cw + cw / 2}" cy="${r * ch + ch / 2}" r="${Math.min(cw, ch) * 0.16}" fill="${accent}" fill-opacity="${(0.2 + (i % 3) * 0.14).toFixed(2)}"/>
      <rect x="${c * cw + 0.5}" y="${r * ch + 0.5}" width="${cw - 1}" height="${ch - 1}" fill="none" stroke="rgba(255,255,255,0.13)"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#0d1018"/>
  ${cells}
</svg>`;
}

const files = {
  'char-elder.svg': frame({ w: 520, h: 720, from: '#2b2440', to: '#0d0b14', accent: '#a259ff', label: '角色 · 老者 / 占位图', kind: 'portrait' }),
  'char-guard.svg': frame({ w: 520, h: 720, from: '#1c2f45', to: '#0b1018', accent: '#4196ff', label: '角色 · 卫兵 / 占位图', kind: 'portrait' }),
  'char-envoy.svg': frame({ w: 520, h: 720, from: '#3b2230', to: '#140c12', accent: '#ff5d70', label: '角色 · 使者 / 占位图', kind: 'portrait' }),
  'scene-peak.svg': frame({ w: 960, h: 540, from: '#152436', to: '#080c12', accent: '#7ee0c0', label: '场景 · 雪峰 / 占位图', kind: 'scene' }),
  'scene-gate.svg': frame({ w: 960, h: 540, from: '#2a2036', to: '#0b0910', accent: '#c194ff', label: '场景 · 关城夜 / 占位图', kind: 'scene' }),
  'storyboard-3x3.svg': storyboard({ w: 720, h: 720, cols: 3, rows: 3, accent: '#4196ff' }),
};

for (const [name, svg] of Object.entries(files)) {
  writeFileSync(join(OUT, name), svg);
  console.log('wrote', name);
}
