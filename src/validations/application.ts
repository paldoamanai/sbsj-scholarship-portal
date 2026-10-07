import { z } from "zod";

export const submitApplicationSchema = z.object({
  scholarship_id: z.string().uuid("Choose a scholarship program"),
  certified: z.literal(true, { errorMap: () => ({ message: "You must certify that your information is true" }) }),
});
