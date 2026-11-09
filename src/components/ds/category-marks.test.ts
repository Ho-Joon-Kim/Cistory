import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES } from "@/modules/spending/categories";
import { CATEGORY_MARK_PATHS, categoryColor, categoryTint } from "./category-marks";

describe("category marks", () => {
  it("has a pictogram for every spending category plus uncategorized", () => {
    expect(Object.keys(CATEGORY_MARK_PATHS).sort()).toEqual(
      [...EXPENSE_CATEGORIES, "uncategorized"].sort()
    );
  });

  it("maps categories onto the theme palette variables", () => {
    expect(categoryColor("food")).toBe("var(--cat-food)");
    expect(categoryTint("uncategorized")).toBe("var(--cat-uncategorized-tint)");
  });
});
