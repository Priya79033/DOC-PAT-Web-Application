const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
// true when `now` falls inside one of the doctor's weekly consultation slots ({day:0-6, from:'HH:MM', to:'HH:MM'})
export const inSlot = (slots = [], now = new Date()) => { const m = now.getHours() * 60 + now.getMinutes(); return slots.some((s) => s.day === now.getDay() && toMin(s.from) <= m && m < toMin(s.to)); };
export const dueForReminder = (when, now = new Date()) => {
  const ms = new Date(when).getTime() - now.getTime();
  return ms > 0 && ms <= 24 * 60 * 60 * 1000;
};
