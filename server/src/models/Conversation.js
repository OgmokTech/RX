import mongoose from 'mongoose';

// Participants are denormalized (name/role) so the inbox renders with zero joins.
const conversationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // sorted user ids → one thread per pair
    participants: [{ userId: String, name: String, role: String, _id: false }],
    lastMessage: { preview: String, at: Date, from: String },
    unread: { type: Map, of: Number, default: {} },      // userId → unread count
  },
  { timestamps: true, versionKey: false }
);

conversationSchema.index({ 'participants.userId': 1, 'lastMessage.at': -1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);
