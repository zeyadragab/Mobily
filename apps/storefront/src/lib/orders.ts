"use client";

export type SavedOrder = { number: string; token: string; at: string };
const KEY = "orders.v1";

export function loadOrders(): SavedOrder[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as SavedOrder[]) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveOrder(o: SavedOrder) {
  try {
    const rest = loadOrders().filter((x) => x.number !== o.number);
    localStorage.setItem(KEY, JSON.stringify([o, ...rest].slice(0, 20)));
  } catch {
    /* storage blocked: the confirmation page still shows the link */
  }
}

export const STATUS_AR: Record<string, string> = {
  reserved: "تم الحجز بانتظار التأكيد",
  confirmed: "تم تأكيد الطلب",
  ready: "جاهز للاستلام / للشحن",
  delivered: "تم التسليم",
  cancelled: "ملغي",
  expired: "انتهى الحجز",
};
