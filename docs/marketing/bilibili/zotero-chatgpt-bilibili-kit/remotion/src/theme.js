// Design tokens for the current zotero-chatgpt Bilibili promo film.
export const theme = {
  color: {
    paper: '#F7F5F1',
    paperBright: '#FCFBF8',
    paperDeep: '#EFEBE4',
    ink: '#1D1D1F',
    inkSoft: '#6E6E73',
    inkFaint: '#9A9AA0',
    line: '#D7D3CD',
    red: '#B4161F',
    redBright: '#CE2430',
    redSoft: '#F2D7D9',
    white: '#FFFFFF',
    glass: 'rgba(255,255,255,0.72)',
  },
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif',
  fontLatin: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
  fps: 30,
  width: 1920,
  height: 1080,
  safeMargin: 96,
  layout: {contentMax: 1560, left: 160, right: 160, top: 120, bottom: 120},
  radius: {large: 56, medium: 36, small: 18, pill: 999},
  surface: {
    blur: 30,
    shadow: '0 24px 70px rgba(29,29,31,0.14), 0 4px 14px rgba(29,29,31,0.07)',
    card: '0 30px 84px rgba(29,29,31,0.17), 0 6px 18px rgba(29,29,31,0.08)',
    soft: '0 10px 28px rgba(29,29,31,0.09)',
    chip: '0 8px 22px rgba(29,29,31,0.08)',
  },
  type: {
    hero: {size: 128, weight: 650, tracking: -3.5, lineHeight: 0.98},
    h1: {size: 84, weight: 630, tracking: -2.2, lineHeight: 1.04},
    h2: {size: 56, weight: 600, tracking: -1.0, lineHeight: 1.12},
    body: {size: 34, weight: 430, tracking: -0.2, lineHeight: 1.34},
    micro: {size: 22, weight: 500, tracking: 0.1, lineHeight: 1.3},
  },
  spring: {
    gentle: {damping: 18, stiffness: 120, mass: 0.9},
    snappy: {damping: 22, stiffness: 210, mass: 0.75},
  },
};

// The product footage is 1200x754. Keeping the card at the same ratio means
// `object-fit: cover` shows the entire frame without distortion or cropping.
export const PRODUCT_ASPECT = 1200 / 754;
