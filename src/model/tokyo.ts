// The map of the Tokyo experiment (Tero et al. 2010, Science 327: 439–442, Fig. 1 and 2), for the scene "Tokyo rail
// network" (ADR 0024, 0029). The paper and its supplement give no list of cities and no coordinates. The coordinator
// fitted the food sources of Fig. 1A and the 33 nodes of the graphs of Fig. 2 to railway stations (ADR 0024); the nodes
// lie a median of 1.5 km from their station.
//
// Sources of the numbers:
// - Station positions: Wikidata (CC0). Two nodes fit no station within 3 km ("Naruto or Togane", "Ichinomiya or
//   Mobara"): they have the positions of the nodes of the paper's graphs.
// - Coastline: © OpenStreetMap contributors, Open Database License 1.0 (relation 6677259, Honshu), cut to the map and
//   simplified to 2 km (Douglas–Peucker).
//
// The map frame: x to the east and y to the south, from the point 139.97° E, 35.76° N, in units of 285 km
// (equirectangular: x = (lon − 139.97) · 90.333 / 285, y = −(lat − 35.76) · 110.95 / 285). The map spans
// x −0.3201 to 0.3201 and y −0.362 to 0.362: 182 km × 206 km, as the panels of Fig. 1 (17 cm wide).
import type { EnvShape } from './presets';

/** km per unit of the map frame. */
export const TOKYO_KM_PER_UNIT = 285;

/**
 * The map frame times this is the frame of a dish (unit: the short side of the grid), so that the walls at the corners
 * of the map lie inside the dish: the corners are 0.4832 units from the centre, a wall adds its radius, and the dish
 * has a radius of 0.4725.
 */
export const TOKYO_SCALE = 0.965;

/** The sides of the map in the map frame: west, north, east, south. */
export const TOKYO_MAP = [-0.3201, -0.362, 0.3201, 0.362] as const;

/** A food source: 2.6 km on the map, 2.4 mm on the plate, as the dots of Fig. 1A (5 to 8 px of 215). */
export const TOKYO_FOOD_RADIUS = 0.009;
/** A wall of the coast: thin, so that the Miura peninsula (8 km) stays open between its coasts. */
export const TOKYO_WALL_RADIUS = 0.004;

/**
 * Tokyo is seven food sources, "to match the importance of Tokyo" in the model of the paper (Fig. 4): one at the
 * station and six around it, each two radii from the centre.
 */
export const TOKYO_DABS = [
  [0, 0],
  [0.018, 0],
  [-0.018, 0],
  [0.009, 0.0156],
  [0.009, -0.0156],
  [-0.009, 0.0156],
  [-0.009, -0.0156],
] as const;

/**
 * The 36 food sources of Fig. 1A, Tokyo first: name of the station's city, x, y in the map frame. The first 33 are the
 * nodes of Fig. 2, on which the paper measures its networks; the last three are in Fig. 1 only.
 */
export const TOKYO_CITIES = [
  ['Tokyo', -0.0644, 0.0308], // 139.7669° E, 35.6808° N
  ['Maebashi', -0.2843, -0.2426], // 139.0730° E, 36.3832° N
  ['Takasaki', -0.3034, -0.219], // 139.0128° E, 36.3225° N
  ['Kiryu', -0.2019, -0.2535], // 139.3331° E, 36.4111° N
  ['Ashikaga', -0.1629, -0.2227], // 139.4560° E, 36.3321° N
  ['Oyama', -0.0518, -0.2155], // 139.8065° E, 36.3136° N
  ['Mito', 0.1604, -0.2378], // 140.4759° E, 36.3709° N
  ['Kumagaya', -0.1838, -0.1478], // 139.3900° E, 36.1397° N
  ['Tsuchiura', 0.0748, -0.1238], // 140.2059° E, 36.0779° N
  ['Ageo', -0.1208, -0.0829], // 139.5889° E, 35.9729° N
  ['Urawa', -0.0992, -0.0383], // 139.6571° E, 35.8585° N
  ['Kashiwa', 0.0004, -0.0398], // 139.9713° E, 35.8623° N
  ['Katori', 0.1661, -0.0524], // 140.4941° E, 35.8946° N
  ['Narita', 0.1091, -0.0069], // 140.3141° E, 35.7778° N
  ['Sakura', 0.0812, 0.0196], // 140.2260° E, 35.7097° N
  ['Funabashi', 0.0048, 0.0227], // 139.9852° E, 35.7017° N
  ['Asahi', 0.2172, 0.0149], // 140.6551° E, 35.7218° N
  ['Choshi', 0.2718, 0.012], // 140.8275° E, 35.7292° N
  ['Hachioji', -0.2, 0.0407], // 139.3389° E, 35.6556° N
  ['Sagamihara', -0.19, 0.0695], // 139.3705° E, 35.5814° N
  ['Chiba', 0.0454, 0.0572], // 140.1132° E, 35.6131° N
  ['Naruto or Togane', 0.1435, 0.0623], // 140.4226° E, 35.5999° N
  ['Yokohama', -0.1101, 0.1145], // 139.6228° E, 35.4658° N
  ['Ichihara', 0.0379, 0.0962], // 140.0895° E, 35.5129° N
  ['Kisarazu', -0.0139, 0.1473], // 139.9262° E, 35.3816° N
  ['Ichinomiya or Mobara', 0.1183, 0.1419], // 140.3433° E, 35.3955° N
  ['Hiratsuka', -0.1963, 0.1683], // 139.3506° E, 35.3278° N
  ['Chigasaki', -0.1786, 0.1673], // 139.4067° E, 35.3303° N
  ['Odawara', -0.2583, 0.1961], // 139.1550° E, 35.2564° N
  ['Kamakura', -0.133, 0.1717], // 139.5504° E, 35.3191° N
  ['Yokosuka', -0.0998, 0.1852], // 139.6550° E, 35.2842° N
  ['Katsuura', 0.1084, 0.2363], // 140.3120° E, 35.1529° N
  ['Tateyama', -0.0342, 0.2975], // 139.8619° E, 34.9959° N
  ['Utsunomiya', -0.0227, -0.3109], // 139.8983° E, 36.5586° N
  ['Hitachi', 0.2192, -0.3232], // 140.6616° E, 36.5902° N
  ['Ito', -0.2782, 0.3057], // 139.0922° E, 34.9748° N
] as const;

/** The cities of Fig. 2: the paper's measures (cost, efficiency, fault tolerance) are on these 33. */
export const TOKYO_MEASURED = 33;

/**
 * The coast from the south edge of the map to its north edge, with the land on its west side. Where the simplified line
 * came within 0.019 units (5.4 km) of a city, it follows a circle of that radius around the city on the seaward side:
 * the simplified line passed over some harbour cities, and a food source needs open ground around it. The circle
 * around Tokyo has a radius of 0.033 units (9.4 km), so that it holds the seven food sources of Tokyo.
 */
const COAST: readonly (readonly [number, number])[] = [
  [-0.2815, 0.362],
  [-0.2628, 0.3383],
  [-0.2609, 0.3136],
  [-0.2593, 0.3078],
  [-0.2596, 0.3019],
  [-0.2617, 0.2963],
  [-0.2655, 0.2916],
  [-0.2705, 0.2883],
  [-0.2762, 0.2868],
  [-0.2756, 0.2784],
  [-0.2855, 0.2748],
  [-0.2706, 0.2388],
  [-0.2564, 0.2408],
  [-0.2592, 0.2151],
  [-0.2535, 0.2145],
  [-0.2482, 0.2122],
  [-0.2438, 0.2084],
  [-0.2408, 0.2035],
  [-0.2394, 0.1979],
  [-0.2397, 0.1921],
  [-0.212, 0.1789],
  [-0.208, 0.1833],
  [-0.2028, 0.1862],
  [-0.1969, 0.1873],
  [-0.191, 0.1865],
  [-0.1867, 0.1845],
  [-0.1809, 0.1862],
  [-0.1749, 0.1859],
  [-0.1692, 0.1838],
  [-0.1646, 0.1801],
  [-0.1613, 0.1751],
  [-0.1517, 0.1753],
  [-0.1498, 0.1806],
  [-0.1465, 0.1851],
  [-0.142, 0.1885],
  [-0.1367, 0.1903],
  [-0.1311, 0.1906],
  [-0.1256, 0.1892],
  [-0.1086, 0.2119],
  [-0.1157, 0.2396],
  [-0.0926, 0.2418],
  [-0.0993, 0.2238],
  [-0.0776, 0.2136],
  [-0.0803, 0.2001],
  [-0.0707, 0.1972],
  [-0.0821, 0.1921],
  [-0.0808, 0.1865],
  [-0.0813, 0.1808],
  [-0.0835, 0.1755],
  [-0.0871, 0.171],
  [-0.0919, 0.1679],
  [-0.0974, 0.1663],
  [-0.1032, 0.1665],
  [-0.0988, 0.1485],
  [-0.1103, 0.1417],
  [-0.0952, 0.139],
  [-0.0885, 0.1249],
  [-0.0934, 0.1235],
  [-0.0913, 0.1175],
  [-0.0914, 0.1111],
  [-0.0936, 0.1051],
  [-0.0893, 0.103],
  [-0.0816, 0.1151],
  [-0.0543, 0.0976],
  [-0.0582, 0.074],
  [-0.0699, 0.0752],
  [-0.0579, 0.0703],
  [-0.0599, 0.0635],
  [-0.0503, 0.0606],
  [-0.042, 0.055],
  [-0.0358, 0.0472],
  [-0.023, 0.0558],
  [-0.0097, 0.0465],
  [-0.0151, 0.0336],
  [-0.0114, 0.0326],
  [-0.0071, 0.0375],
  [-0.0014, 0.0406],
  [0.005, 0.0417],
  [0.0114, 0.0405],
  [0.0266, 0.0542],
  [0.0266, 0.06],
  [0.0283, 0.0655],
  [0.0315, 0.0702],
  [0.0361, 0.0737],
  [0.0414, 0.0758],
  [0.0384, 0.0761],
  [0.0386, 0.0772],
  [0.0322, 0.0781],
  [0.0264, 0.081],
  [0.022, 0.0857],
  [0.0195, 0.0916],
  [0.019, 0.0981],
  [0.0207, 0.1043],
  [0.0168, 0.1138],
  [0.0103, 0.108],
  [0.0074, 0.1194],
  [0.0038, 0.111],
  [-0.0221, 0.1285],
  [-0.0221, 0.1302],
  [-0.0266, 0.1332],
  [-0.03, 0.1372],
  [-0.0322, 0.1421],
  [-0.0329, 0.1474],
  [-0.0321, 0.1527],
  [-0.0393, 0.1498],
  [-0.0347, 0.1611],
  [-0.0419, 0.1561],
  [-0.0432, 0.1706],
  [-0.059, 0.1741],
  [-0.0381, 0.1836],
  [-0.0316, 0.2038],
  [-0.0491, 0.2294],
  [-0.0405, 0.2627],
  [-0.0506, 0.2812],
  [-0.0477, 0.2841],
  [-0.0507, 0.2881],
  [-0.0526, 0.2928],
  [-0.0532, 0.2979],
  [-0.0524, 0.3029],
  [-0.069, 0.3094],
  [-0.0422, 0.3336],
  [-0.0133, 0.3312],
  [0.0046, 0.2901],
  [0.0361, 0.2716],
  [0.0477, 0.2509],
  [0.0914, 0.2447],
  [0.0948, 0.2496],
  [0.0996, 0.2531],
  [0.1053, 0.255],
  [0.1113, 0.2551],
  [0.117, 0.2533],
  [0.1218, 0.2498],
  [0.1253, 0.2449],
  [0.1272, 0.2392],
  [0.1272, 0.2332],
  [0.1253, 0.2276],
  [0.1345, 0.2169],
  [0.1352, 0.1506],
  [0.137, 0.145],
  [0.1371, 0.1392],
  [0.1354, 0.1336],
  [0.1354, 0.1327],
  [0.1669, 0.0711],
  [0.2119, 0.0332],
  [0.2181, 0.0339],
  [0.2242, 0.0326],
  [0.2295, 0.0294],
  [0.2335, 0.0246],
  [0.255, 0.0209],
  [0.2587, 0.0258],
  [0.2638, 0.0292],
  [0.2697, 0.0309],
  [0.2758, 0.0306],
  [0.2815, 0.0283],
  [0.2862, 0.0244],
  [0.2894, 0.0192],
  [0.2908, 0.0132],
  [0.2902, 0.0071],
  [0.2876, 0.0015],
  [0.2835, -0.003],
  [0.2781, -0.0059],
  [0.2721, -0.007],
  [0.2535, -0.0271],
  [0.2355, -0.0787],
  [0.2285, -0.0479],
  [0.2163, -0.0649],
  [0.2294, -0.0657],
  [0.2316, -0.0789],
  [0.2008, -0.1317],
  [0.1865, -0.2028],
  [0.2083, -0.2403],
  [0.2034, -0.283],
  [0.2134, -0.3051],
  [0.2194, -0.3042],
  [0.2255, -0.3053],
  [0.2309, -0.3082],
  [0.235, -0.3127],
  [0.2376, -0.3183],
  [0.2382, -0.3244],
  [0.2368, -0.3304],
  [0.2336, -0.3356],
  [0.2289, -0.3395],
  [0.239, -0.362],
];

/**
 * The scene's food and walls in the frame of a dish (EnvShape): Tokyo's seven food sources first, then the cities.
 * `starts`: cities whose food comes before all others, in this order, one food for each (for Tokyo the one at the
 * station). The start layout on food puts the colony of a strain on each of them (ADR 0032).
 */
export function tokyoShapes(starts: readonly string[] = []): EnvShape[] {
  const k = TOKYO_SCALE;
  const at = (x: number, y: number): [number, number] => [x * k, y * k];
  const first: (EnvShape | undefined)[] = starts.map(() => undefined);
  const rest: EnvShape[] = [];
  for (const [name, x, y] of TOKYO_CITIES)
    (name === 'Tokyo' ? TOKYO_DABS : [[0, 0] as const]).forEach(([dx, dy], dab) => {
      const food: EnvShape = { kind: 'food', at: at(x + dx, y + dy), r: TOKYO_FOOD_RADIUS * k };
      const start = dab === 0 ? starts.indexOf(name) : -1;
      if (start < 0) rest.push(food);
      else first[start] = food;
    });
  const shapes: EnvShape[] = [...first.filter((f) => f !== undefined), ...rest];
  const wall = (a: readonly [number, number], b: readonly [number, number]) =>
    shapes.push({ kind: 'wall', at: at(a[0], a[1]), to: at(b[0], b[1]), r: TOKYO_WALL_RADIUS * k });
  COAST.forEach((p, i) => {
    const next = COAST[i + 1];
    if (next) wall(p, next);
  });
  // The west, north and south edges of the map. The coast closes the east side.
  const [west, north, , south] = TOKYO_MAP;
  const [start, end] = [COAST[0] ?? [west, south], COAST[COAST.length - 1] ?? [west, north]];
  wall([west, north], [end[0], north]);
  wall([west, north], [west, south]);
  wall([west, south], [start[0], south]);
  return shapes;
}
