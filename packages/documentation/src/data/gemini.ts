import catalogue from './bright-stars.json';

/**
 * The Gemini figure the landing page draws, projected from catalogue coordinates.
 *
 * Castor's chain stands for the code a session writes and Pollux's chain for the record it
 * leaves: each written call on Castor's side is paired with its row on Pollux's side.
 */

/** A star of the figure: right ascension in hours, declination in degrees, visual magnitude. */
interface CatalogueStar {
  ra: number;
  dec: number;
  mag: number;
}

// SIMBAD (Harvard mirror), ICRS coordinates at epoch J2000.0; right ascension in decimal hours,
// declination in decimal degrees, magnitude is the catalogue V magnitude.
const STARS: Record<string, CatalogueStar> = {
  α: { ra: 7.577, dec: 31.888, mag: 1.58 },
  β: { ra: 7.755, dec: 28.026, mag: 1.14 },
  γ: { ra: 6.629, dec: 16.399, mag: 1.92 },
  δ: { ra: 7.335, dec: 21.982, mag: 3.53 },
  ε: { ra: 6.732, dec: 25.131, mag: 2.98 },
  ζ: { ra: 7.068, dec: 20.57, mag: 3.79 },
  η: { ra: 6.248, dec: 22.507, mag: 3.28 },
  μ: { ra: 6.383, dec: 22.514, mag: 2.87 },
  ν: { ra: 6.483, dec: 20.212, mag: 4.14 },
  ξ: { ra: 6.755, dec: 12.896, mag: 3.36 },
  κ: { ra: 7.741, dec: 24.398, mag: 3.57 },
  ι: { ra: 7.429, dec: 27.798, mag: 3.79 },
  τ: { ra: 7.186, dec: 30.245, mag: 4.42 },
  θ: { ra: 6.88, dec: 33.961, mag: 3.6 },
  λ: { ra: 7.302, dec: 16.54, mag: 3.56 },
  υ: { ra: 7.599, dec: 26.896, mag: 4.06 },
};

/**
 * The figure's lines, each a chain of star designations. They follow Stellarium's modern sky
 * culture figure for Gemini. The lines are a convention: the IAU standardises constellation
 * boundaries, not the stick figures drawn inside them.
 */
const CHAINS = ['ατεμη', 'εν', 'τθ', 'τιυ', 'βυδζγ', 'δλξ', 'υκ'];

/**
 * Star pairs that can carry one judged call each, in the order the page fills them: `code`
 * is a star of Castor's figure and `record` one of Pollux's. The pairs are chosen so their
 * dotted links and labels fall in open sky and do not run into each other.
 */
export const PAIRS = [
  { code: 'τ', record: 'δ' },
  { code: 'ε', record: 'ζ' },
  { code: 'ν', record: 'ξ' },
  { code: 'η', record: 'γ' },
] as const;

/**
 * The sky window a chart shows and the size it is drawn at.
 *
 * The chart is a stereographic projection centred on the window's middle (the midpoint of the
 * right-ascension and declination bounds), east to the left. One degree of arc spans the same
 * number of pixels in both directions at the centre.
 */
export interface ChartWindow {
  width: number;
  height: number;
  /**
   * Right ascension bounds in hours; east is left, so `raLeft > raRight`. Their midpoint is the
   * centre meridian, and they bound the extent of the grid. The width
   * of the sky shown follows from `width` and the scale.
   */
  raLeft: number;
  raRight: number;
  /**
   * Declination in degrees at the top and bottom of the centre meridian. Their midpoint is the
   * centre parallel, and their span over `height` fixes the pixel scale.
   */
  decTop: number;
  decBottom: number;
  /** The faintest visual magnitude of the surrounding catalogue stars to draw. */
  faintest: number;
  /** Horizontal position of the declination labels, in pixels; the right margin when absent. */
  tickX?: number;
  /**
   * Lens distortion applied after the projection, 0 for none. Points are pulled toward the
   * window's centre the further out they lie, so the grid bows like a globe's. Stars and grid
   * move together, so their relative positions stay those of the projection.
   */
  bulge?: number;
}

/** A drawn star with its position, radius, and designation. */
export interface ChartStar {
  name: string;
  x: number;
  y: number;
  r: number;
}

/** Everything a chart needs to draw, in the window's pixel coordinates. */
export interface Chart {
  grid: string[];
  ticks: { x: number; y: number; label: string }[];
  /** The surrounding sky: real stars from the bright star catalogue, sized by magnitude. */
  field: { x: number; y: number; r: number; opacity: number }[];
  /** First-magnitude neighbours worth naming. */
  named: { x: number; y: number; label: string }[];
  /** The ecliptic, as an SVG path. */
  ecliptic: string;
  lines: string[];
  stars: ChartStar[];
}

/** Bright neighbours of Gemini by their catalogue position (hours, degrees). */
const NEIGHBOURS: [number, number, string][] = [
  [6.752, -16.72, 'Sirius'],
  [5.278, 46.0, 'Capella'],
  [5.242, -8.2, 'Rigel'],
  [7.655, 5.23, 'Procyon'],
  [5.92, 7.41, 'Betelgeuse'],
  [4.599, 16.51, 'Aldebaran'],
  [10.14, 11.97, 'Regulus'],
  [5.438, 28.61, 'Elnath'],
];

/** The obliquity of the ecliptic at J2000, in degrees. */
const OBLIQUITY = 23.4393;

const fixed = (n: number) => Math.round(n * 10) / 10;

const RAD = Math.PI / 180;

/**
 * Projects the figure, a coordinate grid, and a background star field into a window.
 *
 * Stereographic projection about the window's centre (a0, d0), with Δ = a - a0:
 * k = 2 / (1 + sin d0 sin d + cos d0 cos d cos Δ), east = k cos d sin Δ,
 * north = k (cos d0 sin d - sin d0 cos d cos Δ); x = width/2 - s east, y = height/2 - s north.
 * On the centre meridian north = 2 tan((d - d0) / 2), so s = height / (that value at `decTop`
 * minus that value at `decBottom`).
 *
 * @param w - The sky window and drawing size.
 * @returns The chart's geometry in pixel coordinates.
 */
export function chart(w: ChartWindow): Chart {
  const a0 = ((w.raLeft + w.raRight) / 2) * 15 * RAD;
  const d0 = ((w.decTop + w.decBottom) / 2) * RAD;
  const half = (deg: number) => 2 * Math.tan((deg * RAD - d0) / 2);
  const scale = w.height / (half(w.decTop) - half(w.decBottom));
  const raw = (ra: number, dec: number) => {
    const d = dec * RAD;
    const da = ra * 15 * RAD - a0;
    const k = 2 / (1 + Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da));
    const dx = -scale * k * Math.cos(d) * Math.sin(da);
    const dy =
      -scale * k * (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da));
    // The lens: radius r becomes r / sqrt(1 + bulge r^2), with r measured in half-diagonals and
    // the result rescaled so the middle of the window keeps roughly its size.
    const bulge = w.bulge ?? 0;
    const r2 = (dx * dx + dy * dy) / ((w.width * w.width + w.height * w.height) / 4);
    const lens = Math.sqrt((1 + bulge * 0.12) / (1 + bulge * r2));
    return { x: w.width / 2 + dx * lens, y: w.height / 2 + dy * lens };
  };
  const project = (ra: number, dec: number) => {
    const p = raw(ra, dec);
    return { x: fixed(p.x), y: fixed(p.y) };
  };

  // Grid curves are sampled densely; points further than this outside the window are dropped.
  const reach = 40;
  const near = (p: { x: number; y: number }) =>
    p.x > -reach && p.x < w.width + reach && p.y > -reach && p.y < w.height + reach;
  const path = (points: { x: number; y: number }[]) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('');
  // Grid curves are hairlines, so whole pixels are precise enough and keep the markup small.
  const whole = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  const clipped = (points: { x: number; y: number }[]) => {
    const runs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
    for (const p of points) {
      if (near(p)) run.push(p);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
    return runs.map((r) => path(r.map(whole))).join('');
  };
  const bisect = (f: (t: number) => number, lo: number, hi: number, target: number) => {
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < target === f(lo) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const inside = (p: { x: number; y: number }, margin: number) =>
    p.x >= margin * 2 && p.x <= w.width - margin && p.y >= margin && p.y <= w.height - margin;

  const grid: string[] = [];
  const ticks: Chart['ticks'] = [];
  const edge = 32;
  // The grid is drawn well past the window on every side, so its lines run off the edges
  // instead of ending inside the picture.
  const over = { ra: w.bulge ? 5 : 3, dec: w.bulge ? 40 : 25 };
  for (
    let dec = Math.ceil((w.decBottom - over.dec) / 5) * 5;
    dec < Math.min(86, w.decTop + over.dec);
    dec += 5
  ) {
    const steps = 72;
    const east = w.raLeft + over.ra;
    const west = w.raRight - over.ra;
    grid.push(
      clipped(
        Array.from({ length: steps + 1 }, (_, i) =>
          project(east - (i * (east - west)) / steps, dec),
        ),
      ),
    );
    // The label sits where the parallel meets the right margin, or at the grid's end if it stops short.
    const ra =
      raw(w.raRight, dec).x <= (w.tickX ?? w.width - edge)
        ? w.raRight
        : bisect((r) => raw(r, dec).x, w.raRight, w.raLeft, w.tickX ?? w.width - edge);
    const at = project(ra, dec);
    const label = { x: fixed(at.x - 4), y: fixed(at.y - 6) };
    if (inside(label, 14))
      ticks.push({ ...label, label: `${dec > 0 ? '+' : dec < 0 ? '−' : ''}${Math.abs(dec)}°` });
  }
  for (
    let ra10 = Math.ceil((w.raRight - over.ra) * 2) * 5;
    ra10 < (w.raLeft + over.ra) * 10;
    ra10 += 5
  ) {
    const ra = ra10 / 10;
    const steps = 72;
    const lo = Math.max(-80, w.decBottom - over.dec);
    const hi = Math.min(89, w.decTop + over.dec);
    grid.push(
      clipped(
        Array.from({ length: steps + 1 }, (_, i) => project(ra, lo + (i * (hi - lo)) / steps)),
      ),
    );
    if (ra10 % 10 === 0) {
      const at = project(
        ra,
        bisect((d) => raw(ra, d).y, lo, hi, edge),
      );
      const label = { x: at.x - 4, y: at.y };
      if (inside(label, 14)) ticks.push({ ...label, label: `${ra}h` });
    }
  }

  // The background is the real sky: every catalogue star down to the window's limit that lands
  // in view, apart from the sixteen the figure already draws.
  const drawn = Object.values(STARS);
  const visible = (catalogue.stars as [number, number, number][])
    .filter(([, , mag]) => mag <= w.faintest)
    .filter(
      ([ra, dec]) => !drawn.some((s) => Math.abs(s.ra - ra) < 0.01 && Math.abs(s.dec - dec) < 0.1),
    )
    .map(([ra, dec, mag]) => ({ ra, dec, mag, ...project(ra, dec) }))
    .filter(near);
  const field = visible.map(({ x, y, mag }) => ({
    x,
    y,
    r: fixed(Math.max(0.6, 4.4 - mag * 0.6)),
    opacity: fixed(Math.min(1, Math.max(0.3, 1.15 - mag * 0.13)) * 10) / 10,
  }));
  const named = NEIGHBOURS.flatMap(([ra, dec, label]) => {
    const at = project(ra, dec);
    return inside(at, 40) ? [{ ...at, label }] : [];
  });
  // On the ecliptic, tan(dec) = sin(ra) tan(obliquity).
  const ecliptic = clipped(
    Array.from({ length: 241 }, (_, i) => {
      const ra = w.raLeft + 5 - (i * (w.raLeft - w.raRight + 10)) / 240;
      return project(ra, Math.atan(Math.sin(ra * 15 * RAD) * Math.tan(OBLIQUITY * RAD)) / RAD);
    }),
  );

  const at = (name: string) => project(STARS[name].ra, STARS[name].dec);

  return {
    grid,
    ticks,
    field,
    named,
    ecliptic,
    lines: CHAINS.map((chain) => path([...chain].map(at))),
    stars: Object.entries(STARS).map(([name, star]) => ({
      name,
      ...at(name),
      r: fixed(Math.max(2.2, 9.5 - star.mag * 1.75)),
    })),
  };
}
