// Delivery mode: which communes one bakehouse can serve. Ported from design/logic-reference.js.
import { km } from './scoring.js';

export const RADIUS = { min: 5, max: 30, default: 15 }; // km
export const COUNT = { min: 2, max: 40, default: 12 }; // contiguous communes

/** Every commune whose centre is within radiusKm of the bakehouse. */
export const withinDistance = (base, communes, radiusKm) => communes.filter((c) => km(base, c) <= radiusKm);

/**
 * One connected block of touching communes, starting at the bakehouse and always adding the bordering
 * commune nearest to it. byCode: Map code -> commune; adjacency: Map code -> [neighbour codes].
 */
export function contiguousBlock(baseCode, n, byCode, adjacency) {
  const base = byCode.get(baseCode);
  const area = new Set([baseCode]);
  while (area.size < n) {
    let best = null;
    let bestD = Infinity;
    for (const code of area) {
      for (const nb of adjacency.get(code) || []) {
        if (area.has(nb) || !byCode.has(nb)) continue;
        const d = km(base, byCode.get(nb));
        if (d < bestD) {
          bestD = d;
          best = nb;
        }
      }
    }
    if (!best) break; // island or end of loaded data
    area.add(best);
  }
  return area;
}

// Road distance and driving time are estimated, not routed (no routing server): straight line × ROAD_FACTOR,
// driven at ROAD_SPEED_KMH, a typical average on country roads through villages.
export const ROAD_FACTOR = 1.3;
export const ROAD_SPEED_KMH = 50;

/** Estimated road trip for a straight-line distance: { km, minutes }. */
export const roadTrip = (straightKm) => {
  const roadKm = straightKm * ROAD_FACTOR;
  return { km: roadKm, minutes: (60 * roadKm) / ROAD_SPEED_KMH };
};

/**
 * Reach stats for a set of communes served from the bakehouse. radiusKm (distance mode): the area is the
 * circle, so it spans 2 × radius both ways; otherwise the span of the commune centres.
 */
export function reach(codes, byCode, baseCode, radiusKm = null) {
  const base = byCode.get(baseCode);
  let n = 0;
  let noBakery = 0;
  let pop = 0;
  let popNoBakery = 0;
  let bakeries = 0;
  let furthestKm = 0;
  let [south, north, west, east] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const code of codes) {
    const c = byCode.get(code);
    n++;
    pop += c.pop;
    bakeries += c.bakeries;
    if (c.bakeries === 0) {
      noBakery++;
      popNoBakery += c.pop;
    }
    furthestKm = Math.max(furthestKm, km(base, c));
    south = Math.min(south, c.lat);
    north = Math.max(north, c.lat);
    west = Math.min(west, c.lon);
    east = Math.max(east, c.lon);
  }
  const northSouthKm = radiusKm ? 2 * radiusKm : n ? km({ lat: south, lon: base.lon }, { lat: north, lon: base.lon }) : 0;
  const eastWestKm = radiusKm ? 2 * radiusKm : n ? km({ lat: base.lat, lon: west }, { lat: base.lat, lon: east }) : 0;
  return { n, noBakery, pop, popNoBakery, bakeries, furthestKm, northSouthKm, eastWestKm };
}

/** Inhabitants without a bakery within radiusKm of each candidate (candidates and pool: communes). */
export function bestByDistance(candidates, pool, radiusKm) {
  const latPad = radiusKm / 111;
  const out = [];
  for (const c of candidates) {
    const lonPad = radiusKm / (111 * Math.cos((c.lat * Math.PI) / 180));
    let popNoBakery = 0;
    for (const x of pool) {
      if (x.bakeries !== 0 || Math.abs(x.lat - c.lat) > latPad || Math.abs(x.lon - c.lon) > lonPad) continue;
      if (km(c, x) <= radiusKm) popNoBakery += x.pop;
    }
    out.push({ c, popNoBakery });
  }
  return out;
}
