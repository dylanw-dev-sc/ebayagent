import { eq } from "drizzle-orm";
import type { SizePrefs } from "../../lib/domain/types";
import { resetOverride, type OverridableField, type ProfileOverrides } from "../../lib/profiles/resolve";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { loadProfiles } from "./context";
import { refreshDerivedData } from "./evaluation";
import { ValidationError } from "./preferences";

export function listProfiles(db: AppDb) {
  return loadProfiles(db);
}

export function getProfile(db: AppDb, id: number) {
  return loadProfiles(db).find((p) => p.id === id) ?? null;
}

function getOverrides(db: AppDb, id: number): ProfileOverrides {
  const row = db.select().from(s.searchProfiles).where(eq(s.searchProfiles.id, id)).get();
  if (!row) throw new ValidationError("Search profile not found.");
  return row.overrides ?? {};
}

function saveOverrides(db: AppDb, id: number, overrides: ProfileOverrides): void {
  db.update(s.searchProfiles).set({ overrides, updatedAt: new Date() }).where(eq(s.searchProfiles.id, id)).run();
  refreshDerivedData(db);
}

export function createProfile(db: AppDb, input: { name: string; description?: string | null; overrides?: ProfileOverrides; enabled?: boolean }): number {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Profile name is required.");
  const max = db.select().from(s.searchProfiles).all().reduce((m, p) => Math.max(m, p.sortOrder), 0);
  const id = db
    .insert(s.searchProfiles)
    .values({ name, description: input.description ?? null, overrides: input.overrides ?? {}, enabled: input.enabled ?? true, sortOrder: max + 1 })
    .returning({ id: s.searchProfiles.id })
    .get().id;
  refreshDerivedData(db);
  return id;
}

export function updateProfileMeta(db: AppDb, id: number, patch: { name?: string; description?: string | null; enabled?: boolean }): void {
  const set: Partial<typeof s.searchProfiles.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new ValidationError("Profile name is required.");
    set.name = patch.name.trim();
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  db.update(s.searchProfiles).set(set).where(eq(s.searchProfiles.id, id)).run();
  refreshDerivedData(db);
}

/** Set an explicit override for one field (the profile stops inheriting it). */
export function setProfileOverride<K extends OverridableField>(db: AppDb, id: number, field: K, value: ProfileOverrides[K]): void {
  const overrides = { ...getOverrides(db, id), [field]: value };
  saveOverrides(db, id, overrides);
}

export function setProfileSizeOverride(db: AppDb, id: number, categoryId: number, prefs: SizePrefs): void {
  const current = getOverrides(db, id);
  saveOverrides(db, id, { ...current, sizes: { ...(current.sizes ?? {}), [String(categoryId)]: prefs } });
}

/** Remove an override so the field inherits the personal default again. */
export function resetProfileOverride(db: AppDb, id: number, field: keyof ProfileOverrides, categoryId?: number): void {
  saveOverrides(db, id, resetOverride(getOverrides(db, id), field, categoryId));
}

export function duplicateProfile(db: AppDb, id: number): number {
  const row = db.select().from(s.searchProfiles).where(eq(s.searchProfiles.id, id)).get();
  if (!row) throw new ValidationError("Search profile not found.");
  return createProfile(db, {
    name: `${row.name} (copy)`,
    description: row.description,
    overrides: structuredClone(row.overrides ?? {}),
    enabled: false,
  });
}

export function deleteProfile(db: AppDb, id: number): void {
  db.delete(s.searchProfiles).where(eq(s.searchProfiles.id, id)).run();
  refreshDerivedData(db);
}
