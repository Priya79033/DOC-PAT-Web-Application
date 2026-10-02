import { Appointment } from './models.js';
import { notify } from './lib.js';
import { dueForReminder } from './availability.js';
// Hourly: remind patients of accepted appointments in the next 24 hours (once each).
export const startReminders = () => setInterval(async () => {
  try {
    const soon = await Appointment.find({ status: 'ACCEPTED', reminded: false, when: { $gt: new Date(), $lte: new Date(Date.now() + 24 * 36e5) } });
    for (const a of soon) if (dueForReminder(a.when)) { await notify(a.patient, 'Appointment reminder', `You have an appointment on ${a.when.toLocaleString()}.`, ['sms']); await Appointment.updateOne({ _id: a._id }, { reminded: true }); }
  } catch (e) { console.error('reminder job failed', e.message); }
}, 60 * 60e3);
