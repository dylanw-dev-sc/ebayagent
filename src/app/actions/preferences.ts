"use server";

import type { MaterialPriority, SizeSystem, UnknownMaterialPolicy } from "@/lib/domain/types";
import { getDb } from "@/server/db/client";
import { bool, ids, int, list, money, optStr, str, type ActionResult } from "@/server/form";
import {
  createBrand,
  createCategory,
  createCondition,
  createGroup,
  createMaterial,
  deleteBrand,
  deleteCategory,
  deleteGroup,
  deleteMaterial,
  updateBrand,
  updateCategory,
  updateCondition,
  updateDefaults,
  updateGroup,
  updateMaterial,
  updateScanSettings,
  ValidationError,
} from "@/server/services/preferences";
import { run } from "./_run";

const requireId = (fd: FormData, key = "id") => {
  const id = int(fd, key);
  if (!id) throw new ValidationError("Missing id.");
  return id;
};

// --- Brands --------------------------------------------------------------------------

export async function createBrandAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const name = str(fd, "name");
    createBrand(getDb(), {
      name,
      searchQuery: str(fd, "searchQuery"),
      aliases: list(fd, "aliases"),
      excludePhrases: list(fd, "excludePhrases"),
      groupIds: ids(fd, "groupIds"),
      notes: optStr(fd, "notes"),
    });
    return `Added ${name}.`;
  });
}

export async function updateBrandAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    updateBrand(getDb(), requireId(fd), {
      name: str(fd, "name"),
      searchQuery: str(fd, "searchQuery"),
      aliases: list(fd, "aliases"),
      excludePhrases: list(fd, "excludePhrases"),
      groupIds: ids(fd, "groupIds"),
      notes: optStr(fd, "notes"),
    });
  }, "Brand saved. Listings re-evaluated.");
}

export async function toggleBrandAction(id: number, enabled: boolean): Promise<ActionResult> {
  return run(() => updateBrand(getDb(), id, { enabled }));
}

export async function deleteBrandAction(id: number): Promise<ActionResult> {
  return run(() => deleteBrand(getDb(), id), "Brand deleted.");
}

// --- Groups ----------------------------------------------------------------------------

export async function createGroupAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    createGroup(getDb(), { name: str(fd, "name"), description: optStr(fd, "description") });
  }, "Group added.");
}

export async function updateGroupAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => updateGroup(getDb(), requireId(fd), { name: str(fd, "name"), description: optStr(fd, "description") }), "Group saved.");
}

export async function deleteGroupAction(id: number): Promise<ActionResult> {
  return run(() => deleteGroup(getDb(), id), "Group deleted.");
}

// --- Categories ---------------------------------------------------------------------------

function categoryFields(fd: FormData) {
  return {
    name: str(fd, "name"),
    noun: str(fd, "noun"),
    description: optStr(fd, "description"),
    sizeSystem: (str(fd, "sizeSystem") || "alpha") as SizeSystem,
    acceptedSizes: list(fd, "acceptedSizes"),
    reviewSizes: list(fd, "reviewSizes"),
    neckSizes: list(fd, "neckSizes"),
    sleeveLengths: list(fd, "sleeveLengths"),
    ebayCategoryIds: list(fd, "ebayCategoryIds"),
    titleKeywords: list(fd, "titleKeywords"),
    excludeKeywords: list(fd, "excludeKeywords"),
  };
}

export async function createCategoryAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    createCategory(getDb(), categoryFields(fd));
  }, "Category added.");
}

export async function updateCategoryAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => updateCategory(getDb(), requireId(fd), categoryFields(fd)), "Category saved. Listings re-evaluated.");
}

export async function toggleCategoryAction(id: number, enabled: boolean): Promise<ActionResult> {
  return run(() => updateCategory(getDb(), id, { enabled }));
}

export async function deleteCategoryAction(id: number): Promise<ActionResult> {
  return run(() => deleteCategory(getDb(), id), "Category deleted.");
}

// --- Materials ----------------------------------------------------------------------------

export async function setMaterialPriorityAction(id: number, priority: MaterialPriority): Promise<ActionResult> {
  return run(() => updateMaterial(getDb(), id, { priority }));
}

export async function updateMaterialAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const threshold = str(fd, "heavyThresholdPct");
    updateMaterial(getDb(), requireId(fd), {
      name: str(fd, "name"),
      keywords: fd.has("keywords") ? list(fd, "keywords") : undefined,
      components: fd.has("components") ? list(fd, "components") : undefined,
      heavyThresholdPct: threshold === "" ? null : Number(threshold),
    });
  }, "Material saved.");
}

export async function createMaterialAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const kind = str(fd, "kind") === "blend" ? "blend" : "fiber";
    const threshold = str(fd, "heavyThresholdPct");
    createMaterial(getDb(), {
      name: str(fd, "name"),
      kind,
      priority: (str(fd, "priority") || "neutral") as MaterialPriority,
      keywords: list(fd, "keywords"),
      components: list(fd, "components"),
      heavyThresholdPct: threshold === "" ? null : Number(threshold),
    });
  }, "Material added.");
}

export async function deleteMaterialAction(id: number): Promise<ActionResult> {
  return run(() => deleteMaterial(getDb(), id), "Material deleted.");
}

// --- Conditions ------------------------------------------------------------------------------

export async function toggleConditionAction(id: number, accepted: boolean): Promise<ActionResult> {
  return run(() => updateCondition(getDb(), id, { accepted }));
}

export async function createConditionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    createCondition(getDb(), { name: str(fd, "name"), ebayConditionIds: list(fd, "ebayConditionIds"), matchTerms: list(fd, "matchTerms") });
  }, "Condition added.");
}

// --- Defaults & scan settings -------------------------------------------------------------------

export async function updateDefaultsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const min = str(fd, "priceMin");
    const max = str(fd, "priceMax");
    updateDefaults(getDb(), {
      unknownMaterialPolicy: (str(fd, "unknownMaterialPolicy") || "review") as UnknownMaterialPolicy,
      excludeKeywords: list(fd, "excludeKeywords"),
      priceMinMinor: min === "" ? null : money(fd, "priceMin"),
      priceMaxMinor: max === "" ? null : money(fd, "priceMax"),
    });
  }, "Defaults saved. Profiles that inherit them were updated.");
}

export async function updateScanSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const n = (k: string) => {
      const v = int(fd, k);
      if (v === null) throw new ValidationError(`Enter a whole number for ${k}.`);
      return v;
    };
    updateScanSettings(getDb(), {
      maxListingAgeDays: n("maxListingAgeDays"),
      pageSize: n("pageSize"),
      maxPagesPerQuery: n("maxPagesPerQuery"),
      lookbackHours: n("lookbackHours"),
      detailFetchLimit: n("detailFetchLimit"),
      dailyCallBudget: n("dailyCallBudget"),
      requestIntervalMs: n("requestIntervalMs"),
      retentionDays: n("retentionDays"),
      staleAfterHours: n("staleAfterHours"),
      includeAuctions: bool(fd, "includeAuctions"),
      deliveryCountry: str(fd, "deliveryCountry").toUpperCase(),
    });
  }, "Scan settings saved.");
}
