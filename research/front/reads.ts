// What the sensors of the front read under each form of the drift (part E2d, ADR 0074), on one state: a run of the dish
// (e2c-proto.ts, the rule set of step 9) with the form `driftOn` to each step of `marks`, then for every agent on a tube
// cell beside a cell without a tube, its three sensors read under every form, relative to the pressure of the agent's
// cell. Prototype code. Per kind of agent (a sink or not) and of sensor (on a tube or not), the median of what each form
// reads and the share of sensors that read below the agent's cell (they pull the agent there). Usage:
//   node --import ./research/flow/register.mjs research/front/reads.ts seeds=1-3 marks=500,1500 driftOn=all scent=0
import { dish } from './layouts';
import { Sim, frontFrom, params } from './sim';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const RULE =
  'speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app drift=1.5 paidBy=rank fresh=box sums=fixed sinkTube=1';
const own = ['seeds', 'marks', 'scent', 'side'];
const rule = Object.fromEntries(RULE.split(' ').map((a) => a.split('=') as [string, string]));
const front = frontFrom({ ...rule, ...Object.fromEntries(Object.entries(args).filter(([k]) => !own.includes(k))) }, []);
const [from = 1, to = from] = (args.seeds ?? '1-3').split('-').map(Number);
const marks = (args.marks ?? '500,1500').split(',').map(Number);
const side = Number(args.side ?? 160);
const FORMS = ['all', 'net', 'mirror', 'take', 'sinks', 'rim'] as const;
const DEG = Math.PI / 180;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[Math.floor((s.length - 1) / 2)]!;
};

for (let seed = from; seed <= to; seed++) {
  const layout = dish(side, [[side / 2, side / 2, 5]]);
  const sim = new Sim(layout, params({ seed, startStep: 18000, front, scentSteps: Number(args.scent ?? 0) }));
  const inside = sim as unknown as { lanes: number; nb: Int32Array };
  for (let k = 1; k <= Math.max(...marks); k++) {
    sim.advance();
    if (!marks.includes(k)) continue;
    const { G } = sim;
    const lanes = inside.lanes;
    const pm = (c: number) => {
      let p = 0;
      for (let l = 0; l < lanes; l++) p += sim.P[l]![c]!;
      return p / lanes;
    };
    const tube = (c: number) => c >= 0 && layout.open[c] === 1 && G[c]! > 0;
    let [sw, sp] = [0, 0];
    let [rn, rp] = [0, 0];
    const rimOf = (c: number) => {
      for (let e = 0; e < 4; e++) {
        const m = inside.nb[c * 4 + e]!;
        if (m >= 0 && !(G[m]! > 0)) return true;
      }
      return false;
    };
    for (let c = 0; c < sim.cells; c++) {
      if (!tube(c)) continue;
      if (sim.take[c]! > 0) {
        sw += sim.take[c]!;
        sp += sim.take[c]! * pm(c);
      }
      if (rimOf(c)) {
        rn++;
        rp += pm(c);
      }
    }
    const sinkLevel = sp / sw;
    const rimLevel = rp / rn;
    // reads[kind][form]: the values of the sensors off the tubes; on the tubes every form but 'all' reads p(s) − p(a).
    const reads = new Map<string, number[]>();
    const add = (key: string, v: number) => {
      const list = reads.get(key) ?? [];
      list.push(v);
      reads.set(key, list);
    };
    const so = sim.p.sensorOffset;
    for (let i = 0; i < sim.cap; i++) {
      if (!sim.alive[i]) continue;
      const [px, py, h] = [sim.ax[i]!, sim.ay[i]!, sim.ah[i]!];
      const a = sim.cellOf(px, py);
      if (!tube(a) || !rimOf(a)) continue;
      const kind = sim.take[a]! > 0 ? 'sink' : 'rim';
      const pa = pm(a);
      for (const turn of [0, -22.5, 22.5]) {
        const [qx, qy] = [px + so * Math.cos(h + turn * DEG), py + so * Math.sin(h + turn * DEG)];
        const s = sim.cellOf(qx, qy);
        if (s < 0 || !layout.open[s]) continue;
        if (tube(s)) {
          add(`${kind} on`, pm(s) - pa);
          continue;
        }
        const m = sim.cellOf(2 * px - qx, 2 * py - qy);
        const values: Record<(typeof FORMS)[number], number> = {
          all: pm(s) - pa,
          net: 0,
          mirror: tube(m) ? pa - pm(m) : 0,
          take: -(so * sim.take[a]!) / G[a]!,
          sinks: sinkLevel - pa,
          rim: rimLevel - pa,
        };
        for (const f of FORMS) add(`${kind} off ${f}`, values[f]);
      }
    }
    const line = [...reads]
      .sort()
      .map(
        ([key, v]) =>
          `${key} ${median(v).toFixed(1)} (${String(v.length)}, ${String(Math.round((100 * v.filter((x) => x < 0).length) / v.length))} % below)`,
      );
    // The front: agents on the territory beside an open cell outside it (they push it open), on a tube or not.
    let [pushers, pushersOn, off] = [0, 0, 0];
    for (let c = 0; c < sim.cells; c++) {
      if (!sim.occ[c]) continue;
      if (!tube(c)) off++;
      const [x, y] = [c % sim.w, Math.floor(c / sim.w)];
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++)
        for (let dx = -1; dx <= 1 && !edge; dx++) {
          const [xx, yy] = [x + dx, y + dy];
          if (xx < 0 || yy < 0 || xx >= sim.w || yy >= sim.h) continue;
          const m = yy * sim.w + xx;
          if (layout.open[m] && !sim.territory[m]) edge = true;
        }
      if (!edge) continue;
      pushers++;
      if (tube(c)) pushersOn++;
    }
    console.log(
      `seed ${String(seed)} step ${String(k)} alive ${String(sim.aliveCount)} sinks at ${sinkLevel.toFixed(1)}, rim at ${rimLevel.toFixed(1)}; pushers ${String(pushers)} (${String(pushersOn)} on a tube), agents off the tubes ${String(off)}`,
    );
    for (const l of line) console.log(`  ${l}`);
  }
}
