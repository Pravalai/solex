/** Pure unit pricing. The same function prices seed data and is unit-tested. */

export type PricingInput = {
  superSqft: number;
  floor: number;
  facing: string;
  config: string;
  baseRatePerSqft: number;
};

export type PriceBreakdown = {
  basicAmount: number;
  floorRiseAmount: number;
  plcAmount: number;
  parkingAmount: number;
  otherCharges: number;
  listPrice: number;
};

/** Floor rise: ₹40/sqft for each floor above the 4th. */
export const FLOOR_RISE_PER_SQFT = 40;
export const FLOOR_RISE_FROM = 4;
/** Preferential location charge per sqft, by facing. */
export const PLC_PER_SQFT: Record<string, number> = {
  "Park facing": 150,
  Corner: 100,
  "Inner court": 50,
  "Road facing": 0,
};
export const PARKING_PER_BAY = 3_50_000;
export const CLUB_MEMBERSHIP = 2_00_000;
export const IFMS_PER_SQFT = 50;

export function parkingBaysFor(config: string): number {
  return config.startsWith("2") ? 1 : 2;
}

export function priceUnit(input: PricingInput): PriceBreakdown {
  const basicAmount = input.superSqft * input.baseRatePerSqft;
  const floorRiseAmount = Math.max(0, input.floor - FLOOR_RISE_FROM) * FLOOR_RISE_PER_SQFT * input.superSqft;
  const plcAmount = (PLC_PER_SQFT[input.facing] ?? 0) * input.superSqft;
  const parkingAmount = parkingBaysFor(input.config) * PARKING_PER_BAY;
  const otherCharges = CLUB_MEMBERSHIP + IFMS_PER_SQFT * input.superSqft;
  return {
    basicAmount,
    floorRiseAmount,
    plcAmount,
    parkingAmount,
    otherCharges,
    listPrice: basicAmount + floorRiseAmount + plcAmount + parkingAmount + otherCharges,
  };
}
