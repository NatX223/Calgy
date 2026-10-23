// Formatting + parsing helpers shared by every Calgy screen.
// Ported 1:1 from the design prototypes so labels and rounding match.

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => iso(new Date());
export const ymKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const daysIn = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export const parseIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Digits only. */
export const digits = (s: unknown) => String(s ?? "").replace(/[^\d]/g, "");
/** Digits plus a single decimal point. */
export const dec = (s: unknown) => {
  const t = String(s ?? "").replace(/[^\d.]/g, "");
  const i = t.indexOf(".");
  return i < 0 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, "");
};
export const num = (s: unknown) => {
  const n = parseFloat(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
/** Live thousands separators for ₦ inputs. */
export const commas = (s: unknown) => {
  const d = digits(s);
  return d ? Number(d).toLocaleString("en-NG") : "";
};
export const naira = (n: number) => "₦" + Math.round(n).toLocaleString("en-NG");

/** Drop trailing zeros from a fixed-point string. */
export const trim = (s: string) => s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
/** ₦48.2k / ₦1.25M style. */
export const short = (n: number) =>
  n >= 1e6
    ? "₦" + trim((n / 1e6).toFixed(2)) + "M"
    : n >= 1e3
      ? "₦" + trim((n / 1e3).toFixed(n < 1e5 ? 1 : 0)) + "k"
      : "₦" + Math.round(n);
/** Round to ₦100 under 10k, else ₦1,000. */
export const nice = (n: number) => (n < 10000 ? Math.round(n / 100) * 100 : Math.round(n / 1000) * 1000);
export const fmtQ = (q: number) => trim(Number(q).toFixed(1));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Appliance-side helpers
export const trimN = (n: number) => String(Math.round(n * 100) / 100);
/** Units (kWh) to 1 dp. */
export const fU = (n: number) => n.toLocaleString("en-NG", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Round ₦ to 100 for periods ≥28 days, else 10. */
export const rN = (n: number, days: number) => (days >= 28 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10);
export const shortN = (n: number) => (n >= 1e3 ? "₦" + String(Math.round(n / 100) / 10).replace(/\.0$/, "") + "k" : "₦" + n);
export const hrsLabel = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${trimN(h)}h`);
