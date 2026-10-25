// Strategy pattern: swap 'mock' for a real provider (PayMongo for GCash/Maya/cards in PH,
// or Stripe) without touching the billing routes. Each adapter exposes charge().
import crypto from 'node:crypto';

const providers = {
  mock: {
    async charge({ amount, method }) {
      // Simulates an instant successful e-wallet/card payment for development
      return { status: 'succeeded', reference: `MOCK-${method.toUpperCase()}-${crypto.randomBytes(4).toString('hex')}`, amount };
    },
  },
  // paymongo: { async charge({ amount, method, description }) { /* create PaymentIntent via REST */ } },
};

export const paymentGateway = providers[process.env.PAYMENT_PROVIDER || 'mock'];
