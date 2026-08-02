import type { FastifyInstance } from "fastify";

/** Static legal copy for storefront policy pages */
export async function legalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/legal/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const pages: Record<string, { title: string; body: string }> = {
      shipping: {
        title: "Shipping Policy",
        body: `Aura.Frame ships posters across India.

• Free shipping on orders ₹499 and above; otherwise a flat ₹80 shipping charge applies.
• Same-day dispatch targets for Bengaluru and Coimbatore when ordered before cut-off (WhatsApp confirmation required).
• Standard delivery: 3–7 business days depending on location.
• You will receive tracking details on WhatsApp once your order is shipped.
• Double-sided mounting tape is included with every poster order.`,
      },
      returns: {
        title: "Returns & Refunds",
        body: `Because posters are made-to-order prints, returns are limited.

• Damaged or incorrect items: contact us within 48 hours of delivery with photos via WhatsApp.
• We will replace defective prints at no cost or offer store credit.
• Change-of-mind returns are not accepted once printing has started.
• Prepaid WhatsApp orders that are cancelled before confirmation can be refunded via the original payment method discussed on WhatsApp.`,
      },
      privacy: {
        title: "Privacy Policy",
        body: `We collect name, email, phone, and shipping address to fulfill orders.

• Data is stored securely and used only for order processing, support, and account features.
• We do not sell personal data.
• Google sign-in shares your Google profile email/name with us when you choose that option.
• You may request account deletion by contacting support.`,
      },
      terms: {
        title: "Terms of Service",
        body: `By ordering from Aura.Frame you agree that:

• Prices and combo offers are as shown at checkout and confirmed via WhatsApp prepaid payment.
• Product images are illustrative; print colors may vary slightly.
• Stock is limited; unavailable items may be substituted only with your consent.
• Abuse of coupons, gift cards, or accounts may result in order cancellation.`,
      },
    };

    const page = pages[slug];
    if (!page) return reply.code(404).send({ error: "Page not found" });
    return page;
  });
}
