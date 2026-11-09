import { parseMoneyToMinor, parsePercentToBps } from "../lib/money";
import { parseList } from "../lib/text";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export const str = (fd: FormData, key: string): string => String(fd.get(key) ?? "").trim();
export const optStr = (fd: FormData, key: string): string | null => {
  const v = str(fd, key);
  return v === "" ? null : v;
};
export const bool = (fd: FormData, key: string): boolean => {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
};
export const int = (fd: FormData, key: string): number | null => {
  const v = str(fd, key);
  if (v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};
export const list = (fd: FormData, key: string): string[] => parseList(str(fd, key));
export const ids = (fd: FormData, key: string): number[] =>
  fd
    .getAll(key)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
export const values = (fd: FormData, key: string): string[] => fd.getAll(key).map((v) => String(v)).filter(Boolean);
export const money = (fd: FormData, key: string): number | null => parseMoneyToMinor(str(fd, key));
export const percent = (fd: FormData, key: string): number | null => parsePercentToBps(str(fd, key));
