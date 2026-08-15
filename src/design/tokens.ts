/**
 * Scanline consumer design tokens.
 * One source of truth for color, type, spacing, radius, and motion.
 * No color or size literals belong anywhere outside this file.
 */

export const color = {
  /** Surfaces */
  bg: '#F7F7F8', // app background, warm off-white
  surface: '#FFFFFF',
  pill: '#F0F0F2', // filled rows and chips, like the reference list rows
  pillPressed: '#E8E8EB',

  /** Text */
  ink: '#141518',
  sub: '#71747B',

  /** Brand + roles */
  brand: '#FB6F1E', // the Kart orange, from the logo
  brandTint: 'rgba(251, 111, 30, 0.12)',
  teal: '#0F6E6A', // confirmations
  tealTint: 'rgba(15, 110, 106, 0.10)',
  amber: '#C77D22', // gentle hints only, never red
  amberTint: 'rgba(199, 125, 34, 0.13)',
  record: '#E0483E', // recording dot

  /** Primary action, like the reference apps' black CTA */
  cta: '#141518',

  black: '#000000',
  white: '#FFFFFF',

  hairline: 'rgba(20, 21, 24, 0.08)',
  scrim: 'rgba(10, 11, 13, 0.42)',

  /** Scan screen (dark feed) */
  feed: '#0E1013',
  feedRaise: 'rgba(255, 255, 255, 0.07)',
  onFeed: '#F4F5F6',
  onFeedSub: 'rgba(244, 245, 246, 0.64)',

  /** Glass tints */
  glassLight: 'rgba(255, 255, 255, 0.72)',
  glassDark: 'rgba(18, 20, 24, 0.52)',
} as const;

/** System font, weights carry the hierarchy like native iOS. */
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 40, fontWeight: '800' as const, letterSpacing: 0.2 },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '700' as const, letterSpacing: 0.1 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 17, lineHeight: 23, fontWeight: '400' as const },
  sub: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  caption: { fontSize: 13, lineHeight: 17, fontWeight: '500' as const },
} as const;

export const space = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  chip: 12,
  tile: 14,
  row: 22,
  card: 24,
  sheet: 32,
  pill: 999,
} as const;

export const hit = { min: 44 } as const;

export const motion = {
  spring: { duration: 320, dampingRatio: 1 } as const,
  springFast: { duration: 160, dampingRatio: 1 } as const,
  pressScale: 0.96,
  sweepDurationMs: 1400,
  /** CaptureGuide's fade in and out around the progress ring. */
  guideFadeInMs: 260,
  guideFadeOutMs: 200,
} as const;

/**
 * Two elevations only. Cards pair a whisper of shadow with a hairline edge;
 * floating chrome gets the deeper, softer lift. Nothing else casts.
 */
export const shadow = {
  float: {
    shadowColor: color.black,
    shadowOpacity: 0.1,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  raise: {
    shadowColor: color.black,
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
} as const;

export const cardEdge = {
  borderWidth: 1,
  borderColor: 'rgba(20, 21, 24, 0.045)',
} as const;

/**
 * Camera overlay tints, for chrome drawn directly on the live feed: ItemHighlights' outline
 * around a tracked item, and CaptureGuide's progress ring.
 *
 * Deliberately not `color.teal`/`color.amber`: those are tuned to sit on the app's own
 * off-white chrome. This overlay sits directly on an uncontrolled live camera feed instead, so
 * it borrows iOS's own saturated system green and amber, which stay legible against whatever
 * happens to be behind them, rather than the app's calmer confirmation/hint colors.
 */
export const overlay = {
  countedStroke: 'rgba(52, 199, 89, 0.95)',
  countedFill: 'rgba(52, 199, 89, 0.22)',
  closerStroke: 'rgba(255, 179, 0, 0.95)',
  closerFill: 'rgba(255, 179, 0, 0.20)',
  formingStroke: 'rgba(255, 255, 255, 0.45)',
  /** CaptureGuide's always-visible ring track, underneath the per-sector progress arcs. */
  guideTrack: 'rgba(255, 255, 255, 0.14)',
  /** CaptureGuide's arc for a sector not yet covered. */
  guidePending: 'rgba(255, 255, 255, 0.28)',
} as const;

/**
 * CaptureGuide's progress ring geometry: the SVG arc's radius and stroke width, the gap
 * between adjacent sector arcs in radians, and how far down the feed the ring sits.
 */
export const captureGuide = {
  ringRadius: 46,
  ringStroke: 6,
  sectorGapRadians: 0.12,
  top: '38%',
} as const;

/**
 * Legibility treatment for white text laid directly over the live camera feed, with nothing
 * behind it guaranteeing contrast: a card here would cover the cart the user is being asked to
 * look at, so the text has to carry its own contrast instead. Shared by anything that labels the
 * feed itself, not just one component; spread this into a text style rather than restating the
 * shadow values at each call site.
 */
export const feedTextShadow = {
  textShadowColor: 'rgba(0, 0, 0, 0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
} as const;
