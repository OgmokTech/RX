import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    from: { type: String, required: true },
    bodyEnc: { type: String, required: true }, // AES-256-GCM — medical conversations are sensitive
    readAt: Date,
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// Cursor pagination: newest first within a conversation
messageSchema.index({ conversationId: 1, createdAt: -1 });

export const Message = mongoose.model('Message', messageSchema);
