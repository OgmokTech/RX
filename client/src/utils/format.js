import dayjs from 'dayjs';

const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
export const peso = (n) => pesoFmt.format(Number(n ?? 0));
export const dateTime = (d) => (d ? dayjs(d).format('MMM D, YYYY, h:mm A') : '—');
export const date = (d) => (d ? dayjs(d).format('MMM D, YYYY') : '—');
export const time = (d) => (d ? dayjs(d).format('h:mm A') : '—');
export const label = (s) => (s ? s.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()) : '');
