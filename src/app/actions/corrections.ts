"use server";

import { getDb } from "@/server/db/client";
import { int, str, type ActionResult } from "@/server/form";
import {
  addBrandAlias,
  addBrandExcludePhrase,
  addCategoryExcludeKeyword,
  addCategorySize,
  removeCategorySize,
} from "@/server/services/corrections";
import { ValidationError } from "@/server/services/preferences";
import { run } from "./_run";

/** Apply one suggested rule fix from the listing detail view. */
export async function applyCorrectionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const db = getDb();
    const need = (key: string) => {
      const v = int(fd, key);
      if (!v) throw new ValidationError("Please choose an option first.");
      return v;
    };
    switch (str(fd, "kind")) {
      case "brand_alias":
        return addBrandAlias(db, need("brandId"), str(fd, "alias"));
      case "brand_exclude":
        return addBrandExcludePhrase(db, need("brandId"), str(fd, "phrase"));
      case "size_accept":
        return addCategorySize(db, need("categoryId"), str(fd, "size"), str(fd, "list") === "review" ? "review" : "accepted");
      case "size_remove":
        return removeCategorySize(db, need("categoryId"), str(fd, "size"));
      case "category_exclude":
        return addCategoryExcludeKeyword(db, need("categoryId"), str(fd, "keyword"));
      default:
        throw new ValidationError("Unknown fix.");
    }
  });
}
