// Pure slot generator — no I/O, so it is unit-tested directly (tests/availability.test.js).

/**
 * @param {object} args
 * @param {string} args.date            'YYYY-MM-DD' in clinic local time
 * @param {string} args.utcOffset       '+08:00'
 * @param {{start_time:string,end_time:string,slot_minutes:number}[]} args.schedules
 * @param {{starts_at:Date|string,ends_at:Date|string}[]} args.booked
 * @param {{start:Date|string,end:Date|string}[]} args.timeOff
 * @param {Date} [args.now]
 * @returns {{start:string,end:string,available:boolean}[]}
 */
export function generateSlots({ date, utcOffset, schedules, booked = [], timeOff = [], now = new Date() }) {
  const busy = [
    ...booked.map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()]),
    ...timeOff.map((t) => [new Date(t.start).getTime(), new Date(t.end).getTime()]),
  ];
  const overlaps = (s, e) => busy.some(([bs, be]) => s < be && e > bs);
  const slots = [];

  for (const sch of schedules) {
    const stepMs = sch.slot_minutes * 60_000;
    const blockEnd = new Date(`${date}T${sch.end_time.slice(0, 8)}${utcOffset}`).getTime();
    for (let t = new Date(`${date}T${sch.start_time.slice(0, 8)}${utcOffset}`).getTime(); t + stepMs <= blockEnd; t += stepMs) {
      const end = t + stepMs;
      slots.push({
        start: new Date(t).toISOString(),
        end: new Date(end).toISOString(),
        available: t > now.getTime() && !overlaps(t, end),
      });
    }
  }
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

/** Weekday (0=Sun) of a calendar date, independent of the server's timezone. */
export const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
