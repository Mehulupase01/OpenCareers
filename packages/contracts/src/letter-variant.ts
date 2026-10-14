import { z } from "zod";

export const letterVariantRecipeSchema = z
  .object({
    id: z.enum(["role_focus", "concise"]),
    version: z.literal(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type LetterVariantRecipe = z.infer<typeof letterVariantRecipeSchema>;
