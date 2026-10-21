import { z } from "zod";

export const submitApplicationSchema = z.object({
  scholarship_id: z.string().uuid("Choose a scholarship program"),
  letter_of_intent_path: z.string().regex(/^[0-9a-f-]{36}\/letters\/[^/]+$/, "Attach a photo of your letter of intent"),
  certified: z.literal(true, { errorMap: () => ({ message: "You must certify that your information is true" }) }),
});
