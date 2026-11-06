/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      cursor: {
        'default': 'var(--cursor-default, default)',
        'pointer': 'var(--cursor-pointer, pointer)',
        'text': 'var(--cursor-text, text)',
        'not-allowed': 'var(--cursor-not-allowed, not-allowed)',
        'move': 'var(--cursor-move, move)',
        'crosshair': 'var(--cursor-crosshair, crosshair)',
        'ew-resize': 'var(--cursor-ew-resize, ew-resize)',
        'ns-resize': 'var(--cursor-ns-resize, ns-resize)',
        'nwse-resize': 'var(--cursor-nwse-resize, nwse-resize)',
        'nesw-resize': 'var(--cursor-nesw-resize, nesw-resize)',
        'help': 'var(--cursor-help, help)',
      },
      colors: {
        /* Theme layer */
        'canvas-bg': 'var(--theme-bg)',
        'canvas-surface': 'var(--theme-surface)',
        'canvas-card': 'var(--theme-card)',
        'canvas-border': 'var(--theme-border)',
        'canvas-hover': 'var(--theme-hover)',
        'canvas-text': 'var(--theme-text)',
        'canvas-text-secondary': 'var(--theme-text-secondary)',
        'canvas-text-muted': 'var(--theme-text-muted)',

        /* Brand */
        'brand': 'var(--brand)',
        'brand-light': 'var(--brand-light)',
        'brand-pale': 'var(--brand-pale)',

        /* Node type colors */
        'node-text': 'var(--node-text)',
        'node-text-light': 'var(--node-text-light)',
        'node-image': 'var(--node-image)',
        'node-image-light': 'var(--node-image-light)',
        'node-video': 'var(--node-video)',
        'node-video-light': 'var(--node-video-light)',
        'node-audio': 'var(--node-audio)',
        'node-audio-light': 'var(--node-audio-light)',
        'node-panorama': 'var(--node-panorama)',
        'node-panorama-light': 'var(--node-panorama-light)',

        /* Semantic */
        'success': 'var(--success)',
        'success-light': 'var(--success-light)',
        'success-text': 'var(--success-text)',
        'danger': 'var(--danger)',
        'danger-light': 'var(--danger-light)',
        'danger-pale': 'var(--danger-pale)',
        'info': 'var(--info)',
        'info-light': 'var(--info-light)',
        'warning': 'var(--warning)',
        'warning-light': 'var(--warning-light)',

        /* Border variants */
        'border-subtle': 'var(--border-subtle)',
        'border-secondary': 'var(--border-secondary)',

        /* Scrollbar */
        'scrollbar-thumb': 'var(--scrollbar-thumb)',
        'scrollbar-thumb-hover': 'var(--scrollbar-thumb-hover)',

        /* Stock Tailwind accent families, aliased to CSS variables so the light
           (macaron) theme re-tints every `text-red-400` / `bg-emerald-500/10` style
           utility from one place. Dark values equal the stock Tailwind hexes, so the
           dark theme renders exactly as before. Scales live in src/styles/base.css.
           Only the shades the app actually uses are declared — adding a new shade to
           markup means adding it here and in both theme blocks. */
        'indigo': {
          '50': 'rgb(var(--tw-indigo-50) / <alpha-value>)',
          '100': 'rgb(var(--tw-indigo-100) / <alpha-value>)',
          '200': 'rgb(var(--tw-indigo-200) / <alpha-value>)',
          '300': 'rgb(var(--tw-indigo-300) / <alpha-value>)',
          '400': 'rgb(var(--tw-indigo-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-indigo-500) / <alpha-value>)',
          '600': 'rgb(var(--tw-indigo-600) / <alpha-value>)',
        },
        'purple': {
          '400': 'rgb(var(--tw-purple-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-purple-500) / <alpha-value>)',
          '600': 'rgb(var(--tw-purple-600) / <alpha-value>)',
        },
        'violet': {
          '300': 'rgb(var(--tw-violet-300) / <alpha-value>)',
          '400': 'rgb(var(--tw-violet-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-violet-500) / <alpha-value>)',
          '600': 'rgb(var(--tw-violet-600) / <alpha-value>)',
        },
        'fuchsia': {
          '400': 'rgb(var(--tw-fuchsia-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-fuchsia-500) / <alpha-value>)',
          '600': 'rgb(var(--tw-fuchsia-600) / <alpha-value>)',
        },
        'pink': {
          '400': 'rgb(var(--tw-pink-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-pink-500) / <alpha-value>)',
        },
        'red': {
          '200': 'rgb(var(--tw-red-200) / <alpha-value>)',
          '300': 'rgb(var(--tw-red-300) / <alpha-value>)',
          '400': 'rgb(var(--tw-red-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-red-500) / <alpha-value>)',
        },
        'amber': {
          '200': 'rgb(var(--tw-amber-200) / <alpha-value>)',
          '300': 'rgb(var(--tw-amber-300) / <alpha-value>)',
          '400': 'rgb(var(--tw-amber-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-amber-500) / <alpha-value>)',
        },
        'yellow': {
          '400': 'rgb(var(--tw-yellow-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-yellow-500) / <alpha-value>)',
        },
        'emerald': {
          '100': 'rgb(var(--tw-emerald-100) / <alpha-value>)',
          '200': 'rgb(var(--tw-emerald-200) / <alpha-value>)',
          '300': 'rgb(var(--tw-emerald-300) / <alpha-value>)',
          '400': 'rgb(var(--tw-emerald-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-emerald-500) / <alpha-value>)',
        },
        'green': {
          '300': 'rgb(var(--tw-green-300) / <alpha-value>)',
          '400': 'rgb(var(--tw-green-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-green-500) / <alpha-value>)',
        },
        'blue': {
          '400': 'rgb(var(--tw-blue-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-blue-500) / <alpha-value>)',
        },
        'sky': {
          '100': 'rgb(var(--tw-sky-100) / <alpha-value>)',
          '200': 'rgb(var(--tw-sky-200) / <alpha-value>)',
          '300': 'rgb(var(--tw-sky-300) / <alpha-value>)',
          '400': 'rgb(var(--tw-sky-400) / <alpha-value>)',
        },
        'orange': {
          '400': 'rgb(var(--tw-orange-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-orange-500) / <alpha-value>)',
        },
        'cyan': {
          '400': 'rgb(var(--tw-cyan-400) / <alpha-value>)',
          '500': 'rgb(var(--tw-cyan-500) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}
