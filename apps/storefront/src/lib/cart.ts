"use client";

import { useSyncExternalStore } from "react";

export type CartLine = {
  variant_id: string;
  product_id: string;
  name: string;
  variant: string;
  price: number;
  qty: number;
  image_url?: string | null;
  available?: number;
};

const KEY = "cart.v1";
const MAX_QTY = 5;
const EMPTY: CartLine[] = [];
let cache: CartLine[] | null = null;
const listeners = new Set<() => void>();

function read(): CartLine[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as CartLine[]) : [];
    cache = Array.isArray(parsed) ? parsed.filter((l) => l && l.variant_id && l.qty > 0) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: CartLine[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: cart still works for this tab */
  }
  listeners.forEach((l) => l());
}

export function useCart() {
  const lines = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => EMPTY,
  );
  return {
    lines,
    count: lines.reduce((s, l) => s + l.qty, 0),
    total: lines.reduce((s, l) => s + l.qty * l.price, 0),
  };
}

export const cart = {
  add(line: Omit<CartLine, "qty">, qty = 1) {
    const cur = read();
    const ex = cur.find((l) => l.variant_id === line.variant_id);
    const limit = Math.min(MAX_QTY, line.available ?? MAX_QTY);
    const nextQty = Math.min(limit, (ex?.qty ?? 0) + qty);
    if (nextQty <= (ex?.qty ?? 0)) return;
    write(
      ex
        ? cur.map((l) => (l.variant_id === line.variant_id ? { ...l, ...line, qty: nextQty } : l))
        : [...cur, { ...line, qty: nextQty }],
    );
  },
  setQty(variantId: string, qty: number) {
    const q = Math.max(0, Math.min(MAX_QTY, qty));
    write(read().flatMap((l) => {
      if (l.variant_id !== variantId) return [l];
      if (q === 0) return [];
      const available = l.available ?? MAX_QTY;
      return [{ ...l, qty: Math.min(q, Math.max(l.qty, available)) }];
    }));
  },
  clear() {
    write([]);
  },
};

export const CART_MAX_QTY = MAX_QTY;
