import { z } from "zod";

export const submitApplicationSchema = z.object({
  scholarship_id: z.string().uuid("Choose a scholarship program"),
  // Optional here: the database requires it for programs whose office asks for a letter (migration 071).
  letter_of_intent_path: z.string().regex(/^[0-9a-f-]{36}\/letters\/[^/]+$/, "Attach a photo of your letter of intent").nullish(),
  certified: z.literal(true, { errorMap: () => ({ message: "You must certify that your information is true" }) }),
});
