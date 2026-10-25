import mongoose from 'mongoose';

const telemedicineSchema = new mongoose.Schema(
  {
    appointmentId: { type: String, required: true, unique: true },
    roomName: { type: String, required: true },
    provider: { type: String, default: 'jitsi' },
    events: [{ userId: String, role: String, type: { type: String }, at: { type: Date, default: Date.now }, _id: false }],
    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: true, versionKey: false }
);

export const TelemedicineSession = mongoose.model('TelemedicineSession', telemedicineSchema);
