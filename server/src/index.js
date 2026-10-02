import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';
import { startReminders } from './reminders.js';

await mongoose.connect(process.env.MONGO_URI);
startReminders();
const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`API on ${port}`));
