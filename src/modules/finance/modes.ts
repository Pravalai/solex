/** Payment modes accepted for customer receipts. No database imports, so client forms can use it too. */
export const PAYMENT_MODES = ["NEFT", "RTGS", "UPI", "CHEQUE", "HOME_LOAN_DISBURSAL"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
