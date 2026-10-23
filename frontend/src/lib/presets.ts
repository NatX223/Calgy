// Calgy appliance preset library (phase 1). Values approximate; all user-editable.
// tiers = [low, typical, high] in W (steady/cycling) or Wh per full charge (charging).
// use = default hours/day (steady/cycling) or charges/day (charging). duty = % (cycling only).

export type UsageType = 'steady' | 'cycling' | 'charging';
export type CategoryId = 'cooling' | 'kitchen' | 'entertainment' | 'lighting' | 'laundry' | 'water' | 'tech' | 'personal' | 'other';

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'cooling', label: 'Cooling' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'laundry', label: 'Laundry & Cleaning' },
  { id: 'water', label: 'Water' },
  { id: 'tech', label: 'Work & Tech' },
  { id: 'personal', label: 'Personal care' },
  { id: 'other', label: 'Other' },
];

export type Preset = {
  id: string; name: string; cat: CategoryId; type: UsageType;
  tiers: [number, number, number]; use: number; duty: number | null; icon: string; help?: string;
};

const P = (id: string, name: string, cat: CategoryId, type: UsageType, lo: number, typ: number, hi: number, use: number, duty: number | null, icon: string, help?: string): Preset =>
  ({ id, name, cat, type, tiers: [lo, typ, hi], use, duty, icon, help });

export const PRESETS: Preset[] = [
  P('standing-fan', 'Standing fan', 'cooling', 'steady', 45, 60, 75, 8, null, '🌀'),
  P('ceiling-fan', 'Ceiling fan', 'cooling', 'steady', 50, 65, 80, 8, null, '🌀'),
  P('table-fan', 'Table fan', 'cooling', 'steady', 25, 35, 50, 6, null, '🌀'),
  P('recharge-fan', 'Rechargeable fan', 'cooling', 'charging', 20, 40, 60, 1, null, '🔋'),
  P('ac-1hp', 'AC 1HP (non-inverter)', 'cooling', 'cycling', 750, 900, 1100, 6, 70, '❄️'),
  P('ac-15hp', 'AC 1.5HP (non-inverter)', 'cooling', 'cycling', 1100, 1300, 1600, 6, 70, '❄️'),
  P('ac-15hp-inv', 'AC 1.5HP (inverter)', 'cooling', 'cycling', 500, 800, 1200, 6, 60, '❄️'),
  P('fridge', 'Fridge (small/medium)', 'kitchen', 'cycling', 80, 120, 180, 24, 40, '🧊'),
  P('chest-freezer', 'Chest freezer', 'kitchen', 'cycling', 100, 150, 250, 24, 45, '🧊'),
  P('fridge-freezer', 'Fridge-freezer (double door)', 'kitchen', 'cycling', 120, 180, 250, 24, 40, '🧊'),
  P('microwave', 'Microwave', 'kitchen', 'steady', 800, 1000, 1200, 0.25, null, '♨️'),
  P('kettle', 'Electric kettle', 'kitchen', 'steady', 1500, 1800, 2200, 0.2, null, '☕'),
  P('blender', 'Blender', 'kitchen', 'steady', 300, 450, 600, 0.1, null, '🥤'),
  P('cooker', 'Electric cooker / hotplate', 'kitchen', 'cycling', 1000, 1500, 2000, 1, 70, '🍲'),
  P('rice-cooker', 'Rice cooker', 'kitchen', 'steady', 500, 600, 700, 0.5, null, '🍚'),
  P('toaster', 'Toaster / sandwich maker', 'kitchen', 'steady', 700, 850, 1000, 0.1, null, '🍞'),
  P('tv-32', 'LED TV 32"', 'entertainment', 'steady', 30, 45, 60, 5, null, '📺'),
  P('tv-50', 'LED TV 43–55"', 'entertainment', 'steady', 60, 100, 150, 5, null, '📺'),
  P('decoder', 'Decoder (DStv/GOtv)', 'entertainment', 'steady', 10, 18, 25, 5, null, '📡'),
  P('sound', 'Sound system / home theatre', 'entertainment', 'steady', 30, 60, 100, 2, null, '🔊'),
  P('console', 'Game console', 'entertainment', 'steady', 100, 150, 200, 2, null, '🎮'),
  P('led', 'LED bulb', 'lighting', 'steady', 5, 9, 15, 6, null, '💡'),
  P('fluorescent', 'Fluorescent tube', 'lighting', 'steady', 18, 36, 40, 6, null, '💡'),
  P('incandescent', 'Incandescent bulb', 'lighting', 'steady', 40, 60, 100, 6, null, '💡'),
  P('security', 'Security / outdoor light', 'lighting', 'steady', 10, 20, 50, 12, null, '🔦'),
  P('lamp', 'Rechargeable lamp', 'lighting', 'charging', 5, 10, 20, 1, null, '🏮'),
  P('iron', 'Pressing iron', 'laundry', 'cycling', 1000, 1200, 2000, 0.5, 50, '👔'),
  P('washer', 'Washing machine', 'laundry', 'steady', 400, 600, 1000, 0.4, null, '🧺', '1h, 3 times a week ≈ 0.4h a day'),
  P('vacuum', 'Vacuum cleaner', 'laundry', 'steady', 800, 1200, 1600, 0.25, null, '🧹'),
  P('pump-05', 'Pumping machine 0.5HP', 'water', 'steady', 370, 450, 750, 0.5, null, '💧'),
  P('pump-1', 'Pumping machine 1HP', 'water', 'steady', 750, 900, 1100, 0.5, null, '💧'),
  P('heater', 'Water heater', 'water', 'cycling', 1500, 2000, 3000, 1, 60, '🚿'),
  P('router', 'Router / MiFi', 'tech', 'steady', 6, 10, 15, 24, null, '📶'),
  P('starlink', 'Starlink / satellite internet', 'tech', 'steady', 50, 65, 75, 24, null, '🛰️'),
  P('laptop', 'Laptop (charging)', 'tech', 'charging', 40, 60, 90, 1, null, '💻'),
  P('desktop', 'Desktop PC', 'tech', 'steady', 100, 200, 400, 6, null, '🖥️'),
  P('monitor', 'Monitor', 'tech', 'steady', 20, 30, 45, 6, null, '🖥️'),
  P('phone', 'Smartphone', 'tech', 'charging', 10, 15, 25, 1, null, '📱'),
  P('tablet', 'Tablet', 'tech', 'charging', 25, 35, 45, 0.5, null, '📱'),
  P('pb-10', 'Power bank 10,000mAh', 'tech', 'charging', 40, 45, 50, 0.5, null, '🔋'),
  P('pb-20', 'Power bank 20,000mAh', 'tech', 'charging', 80, 90, 100, 0.5, null, '🔋'),
  P('hairdryer', 'Hair dryer', 'personal', 'steady', 1000, 1500, 2000, 0.2, null, '💨'),
  P('clipper', 'Hair clipper', 'personal', 'charging', 5, 8, 12, 0.3, null, '✂️'),
];

// "Start with a typical Lagos flat" quick start: [presetId, quantity]
export const LAGOS_FLAT: [string, number][] = [
  ['standing-fan', 2], ['led', 4], ['tv-32', 1], ['decoder', 1], ['fridge', 1], ['router', 1], ['phone', 2], ['laptop', 1],
];
