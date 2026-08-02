/**
 * Re-export generated Prisma client + enums/types for the app.
 * Run `npx prisma generate` after schema changes.
 */
export {
  PrismaClient,
  Prisma,
  ProductStatus,
  Size,
  OrderStatus,
  ReviewStatus,
  AdminRole,
  CouponType,
} from "../../generated/prisma/index.js";

export type {
  Category,
  Product,
  ProductSize,
  ProductImage,
  Order,
  OrderLine,
  Customer,
  Admin,
  Review,
  Faq,
  PricingSettings,
  Coupon,
  WishlistItem,
  PasswordResetToken,
  AuditLog,
  GiftCard,
  LoyaltyTransaction,
} from "../../generated/prisma/index.js";
