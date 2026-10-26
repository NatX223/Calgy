// Fuel purchases (the spend log's fuel entries), newest first by `purchasedAt`.
import { logCollection } from "./collection";

export const fuelPurchases = logCollection("fuelPurchases");
