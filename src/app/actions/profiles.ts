"use server";

import { redirect } from "next/navigation";
import type { UnknownMaterialPolicy } from "@/lib/domain/types";
import type { OverridableField, ProfileOverrides } from "@/lib/profiles/resolve";
import { getDb } from "@/server/db/client";
import { ids, int, list, money, optStr, str, values, type ActionResult } from "@/server/form";
import { ValidationError } from "@/server/services/preferences";
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  resetProfileOverride,
  setProfileOverride,
  setProfileSizeOverride,
  updateProfileMeta,
} from "@/server/services/profiles";
import { run } from "./_run";

const requireId = (fd: FormData) => {
  const id = int(fd, "profileId");
  if (!id) throw new ValidationError("Missing profile.");
  return id;
};

export async function createProfileAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = 0;
  const result = run(() => {
    id = createProfile(getDb(), { name: str(fd, "name"), description: optStr(fd, "description") });
  });
  if (result.ok) redirect(`/profiles/${id}`);
  return result;
}

export async function updateProfileMetaAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => updateProfileMeta(getDb(), requireId(fd), { name: str(fd, "name"), description: optStr(fd, "description") }), "Profile saved.");
}

export async function toggleProfileAction(id: number, enabled: boolean): Promise<ActionResult> {
  return run(() => updateProfileMeta(getDb(), id, { enabled }));
}

export async function duplicateProfileAction(id: number): Promise<ActionResult> {
  return run(() => {
    const copy = duplicateProfile(getDb(), id);
    return `Duplicated as a disabled copy (#${copy}).`;
  });
}

export async function deleteProfileAction(id: number): Promise<ActionResult> {
  return run(() => deleteProfile(getDb(), id), "Profile deleted.");
}

export async function resetOverrideAction(id: number, field: keyof ProfileOverrides, categoryId?: number): Promise<ActionResult> {
  return run(() => resetProfileOverride(getDb(), id, field, categoryId), "Now inheriting the personal default.");
}

/** Save an explicit override for one field from a form. */
export async function setOverrideAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const id = requireId(fd);
    const field = str(fd, "field") as OverridableField;
    const db = getDb();
    switch (field) {
      case "brandScope":
        setProfileOverride(db, id, "brandScope", { groupIds: ids(fd, "groupIds"), brandIds: ids(fd, "brandIds") });
        break;
      case "categoryIds":
        setProfileOverride(db, id, "categoryIds", ids(fd, "categoryIds"));
        break;
      case "conditionKeys":
        setProfileOverride(db, id, "conditionKeys", values(fd, "conditionKeys"));
        break;
      case "requiredMaterialKeys":
        setProfileOverride(db, id, "requiredMaterialKeys", values(fd, "requiredMaterialKeys"));
        break;
      case "excludedMaterialKeys":
        setProfileOverride(db, id, "excludedMaterialKeys", values(fd, "excludedMaterialKeys"));
        break;
      case "unknownMaterialPolicy":
        setProfileOverride(db, id, "unknownMaterialPolicy", (str(fd, "unknownMaterialPolicy") || "review") as UnknownMaterialPolicy);
        break;
      case "excludeKeywords":
        setProfileOverride(db, id, "excludeKeywords", list(fd, "excludeKeywords"));
        break;
      case "priceMinMinor":
        setProfileOverride(db, id, "priceMinMinor", str(fd, "value") === "" ? null : money(fd, "value"));
        break;
      case "priceMaxMinor":
        setProfileOverride(db, id, "priceMaxMinor", str(fd, "value") === "" ? null : money(fd, "value"));
        break;
      default:
        throw new ValidationError("Unknown setting.");
    }
  }, "Override saved. Listings re-evaluated.");
}

export async function setSizeOverrideAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const id = requireId(fd);
    const categoryId = int(fd, "categoryId");
    if (!categoryId) throw new ValidationError("Missing category.");
    setProfileSizeOverride(getDb(), id, categoryId, {
      accepted: list(fd, "accepted"),
      review: list(fd, "review"),
      neck: list(fd, "neck"),
      sleeve: list(fd, "sleeve"),
    });
  }, "Size override saved.");
}
