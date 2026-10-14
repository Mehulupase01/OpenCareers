import { createHash } from "node:crypto";
import { DomainError } from "../../contracts/src/index.js";
import {
  type LetterVariantRecipe,
  letterVariantRecipeSchema,
} from "../../contracts/src/letter-variant.js";

export type LetterVariantRecipeItem = Readonly<
  LetterVariantRecipe & { label: string; instruction: string }
>;

const publicRecipes = [
  {
    id: "role_focus",
    version: 1,
    label: "Role focus",
    instruction:
      "Emphasize interest in the role's matched requirements in the motivation, using one exact supplied requirement quote. Change only style and motivation emphasis. Never rewrite the fixed opening or approved factual claims, introduce candidate facts, or change supplied contribution text.",
  },
  {
    id: "concise",
    version: 1,
    label: "Concise",
    instruction:
      "Keep motivation brief and direct, using one exact supplied requirement quote and avoiding repetition. Change only style and motivation emphasis. Never rewrite the fixed opening or approved factual claims, introduce candidate facts, or change supplied contribution text.",
  },
] as const;

// Canonical public data: JSON object keys in this fixed order, UTF-8, no whitespace.
const catalog: readonly LetterVariantRecipeItem[] = Object.freeze(
  publicRecipes.map(({ id, version, label, instruction }) =>
    Object.freeze({
      id,
      version,
      sha256: createHash("sha256")
        .update(JSON.stringify({ id, version, label, instruction }), "utf8")
        .digest("hex"),
      label,
      instruction,
    }),
  ),
);

export function letterVariantRecipes(): LetterVariantRecipeItem[] {
  return [...catalog];
}

export function assertLetterVariantRecipe(raw: unknown): LetterVariantRecipeItem {
  const binding = letterVariantRecipeSchema.parse(raw);
  const recipe = catalog.find(
    (item) =>
      item.id === binding.id && item.version === binding.version && item.sha256 === binding.sha256,
  );
  if (!recipe)
    throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Letter variant recipe is not in the catalog.");
  return recipe;
}
