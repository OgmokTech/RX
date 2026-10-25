import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSlots, weekdayOf } from '../src/modules/doctors/availability.js';

const base = { date: '2030-01-07', utcOffset: '+08:00', now: new Date('2030-01-01T00:00:00Z') };

test('weekdayOf returns calendar weekday regardless of server timezone', () => {
  assert.equal(weekdayOf('2030-01-07'), 1); // Monday
});

test('generates 30-minute slots within a block', () => {
  const slots = generateSlots({ ...base, schedules: [{ start_time: '08:00:00', end_time: '10:00:00', slot_minutes: 30 }] });
  assert.equal(slots.length, 4);
  assert.equal(slots[0].start, '2030-01-07T00:00:00.000Z'); // 08:00 Manila = 00:00 UTC
  assert.ok(slots.every((s) => s.available));
});

test('booked and time-off periods mark slots unavailable', () => {
  const slots = generateSlots({
    ...base,
    schedules: [{ start_time: '08:00', end_time: '10:00', slot_minutes: 30 }],
    booked: [{ starts_at: '2030-01-07T00:30:00Z', ends_at: '2030-01-07T01:00:00Z' }],
    timeOff: [{ start: '2030-01-07T01:30:00Z', end: '2030-01-07T02:00:00Z' }],
  });
  assert.deepEqual(slots.map((s) => s.available), [true, false, true, false]);
});

test('slots in the past are unavailable', () => {
  const slots = generateSlots({ ...base, now: new Date('2030-01-07T00:45:00Z'), schedules: [{ start_time: '08:00', end_time: '09:30', slot_minutes: 30 }] });
  assert.deepEqual(slots.map((s) => s.available), [false, false, true]);
});
