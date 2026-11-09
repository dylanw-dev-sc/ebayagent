"use client";

import { Wrench } from "lucide-react";
import { applyCorrectionAction } from "@/app/actions/corrections";
import type { Suggestion } from "@/server/services/corrections";
import { ActionForm, SubmitButton } from "../forms";

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <p className="mb-2 text-[13px] font-medium text-ink">{title}</p>
      {children}
    </div>
  );
}

/** Suggested rule fixes for a listing whose decision looks wrong. Each fix edits Preferences. */
export function CorrectionPanel({ suggestions, brands }: { suggestions: Suggestion[]; brands: Array<{ id: number; name: string }> }) {
  if (!suggestions.length) return null;
  return (
    <details className="card group p-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[15px] font-semibold text-ink">
        <Wrench className="size-4 text-ink-3" /> Wrong decision? Fix the rule
      </summary>
      <p className="mt-1 text-[12.5px] text-ink-3">
        Each fix changes your Preferences and re-checks every stored listing. Size fixes change your category defaults; profiles that override sizes keep their own.
      </p>
      <div className="mt-4">
        {suggestions.map((sg, i) => {
          switch (sg.kind) {
            case "brand_alias":
              return (
                <Row key={i} title="Is this one of your brands under another spelling?">
                  <ActionForm action={applyCorrectionAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="kind" value="brand_alias" />
                    <label className="min-w-40 flex-1">
                      <span className="label">Alias</span>
                      <input name="alias" defaultValue={sg.alias} className="field" />
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="label">Brand</span>
                      <select name="brandId" defaultValue={sg.brandId ?? ""} className="field">
                        <option value="">Choose…</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <SubmitButton variant="secondary">Add alias</SubmitButton>
                  </ActionForm>
                </Row>
              );
            case "brand_exclude":
              return (
                <Row key={i} title={`Not really ${sg.brandName}?`}>
                  <ActionForm action={applyCorrectionAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="kind" value="brand_exclude" />
                    <input type="hidden" name="brandId" value={sg.brandId} />
                    <label className="min-w-56 flex-1">
                      <span className="label">Never match {sg.brandName} when a listing contains</span>
                      <input name="phrase" defaultValue={sg.phrase} className="field" />
                    </label>
                    <SubmitButton variant="secondary">Add never-match phrase</SubmitButton>
                  </ActionForm>
                </Row>
              );
            case "size_accept":
              return (
                <Row key={i} title={sg.list === "accepted" ? `Does ${sg.size} fit you in ${sg.categoryName}?` : `Might ${sg.size} fit you in ${sg.categoryName}?`}>
                  <ActionForm action={applyCorrectionAction}>
                    <input type="hidden" name="kind" value="size_accept" />
                    <input type="hidden" name="categoryId" value={sg.categoryId} />
                    <input type="hidden" name="size" value={sg.size} />
                    <input type="hidden" name="list" value={sg.list} />
                    <SubmitButton variant="secondary">{sg.list === "accepted" ? `Accept ${sg.size}` : `Send ${sg.size} to Needs review`}</SubmitButton>
                  </ActionForm>
                </Row>
              );
            case "size_remove":
              return (
                <Row key={i} title={`${sg.size} doesn't actually fit you in ${sg.categoryName}?`}>
                  <ActionForm action={applyCorrectionAction}>
                    <input type="hidden" name="kind" value="size_remove" />
                    <input type="hidden" name="categoryId" value={sg.categoryId} />
                    <input type="hidden" name="size" value={sg.size} />
                    <SubmitButton variant="secondary">Stop accepting {sg.size}</SubmitButton>
                  </ActionForm>
                </Row>
              );
            case "category_exclude":
              return (
                <Row key={i} title={`Not something you want in ${sg.categoryName}?`}>
                  <ActionForm action={applyCorrectionAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="kind" value="category_exclude" />
                    <input type="hidden" name="categoryId" value={sg.categoryId} />
                    <label className="min-w-56 flex-1">
                      <span className="label">Exclude titles containing</span>
                      <input name="keyword" defaultValue={sg.keyword} className="field" />
                    </label>
                    <SubmitButton variant="secondary">Exclude from {sg.categoryName}</SubmitButton>
                  </ActionForm>
                </Row>
              );
          }
        })}
      </div>
    </details>
  );
}
