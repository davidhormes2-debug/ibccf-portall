import { z } from "zod";

export const emailSchema = z.string().email("Please enter a valid email address");

export const phoneSchema = z.string().regex(
  /^[\d\s\-+()]+$/,
  "Please enter a valid phone number"
).optional().or(z.literal(""));

export const amountSchema = z.string().regex(
  /^[\d,]+(\.\d{1,2})?\s*[A-Za-z]*$/,
  "Please enter a valid amount"
);

export const accessCodeSchema = z.string()
  .min(6, "Access code must be at least 6 characters")
  .max(20, "Access code must be at most 20 characters")
  .regex(/^[A-Za-z0-9]+$/, "Access code must contain only letters and numbers");

export const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .max(100, "Password must be at most 100 characters");

export const strongPasswordSchema = passwordSchema
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const usernameSchema = z.string()
  .min(3, "Username must be at least 3 characters")
  .max(50, "Username must be at most 50 characters")
  .regex(/^[A-Za-z0-9_\-]+$/, "Username can only contain letters, numbers, underscores, and hyphens");

export const walletAddressSchema = z.string()
  .min(10, "Please enter a valid wallet address")
  .max(100, "Wallet address is too long");

export const urlSchema = z.string().url("Please enter a valid URL").optional().or(z.literal(""));

export const nonEmptyStringSchema = z.string().min(1, "This field is required");

export const requiredTextSchema = (fieldName: string) => 
  z.string().min(1, `${fieldName} is required`);

export const maxLengthTextSchema = (maxLength: number, fieldName: string) =>
  z.string().max(maxLength, `${fieldName} must be at most ${maxLength} characters`);

export const textAreaSchema = (fieldName: string, maxLength = 5000) =>
  z.string()
    .min(1, `${fieldName} is required`)
    .max(maxLength, `${fieldName} must be at most ${maxLength} characters`);

export const optionalTextSchema = z.string().optional().or(z.literal(""));

export const positiveNumberSchema = z.number().positive("Must be a positive number");

export const integerSchema = z.number().int("Must be a whole number");

export const positiveIntegerSchema = z.number().int().positive("Must be a positive whole number");

export const percentageSchema = z.number().min(0, "Must be at least 0").max(100, "Must be at most 100");

export const ratingSchema = z.number().min(1, "Rating must be at least 1").max(5, "Rating must be at most 5");

export const categorySchema = z.enum(["urgent", "processing", "resolved"]);

export const statusSchema = z.enum(["pending", "approved", "rejected", "cancelled"]);

export const loginFormSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const accessCodeFormSchema = z.object({
  accessCode: accessCodeSchema,
});

export const feedbackFormSchema = z.object({
  rating: ratingSchema,
  comment: optionalTextSchema,
});

export const messageFormSchema = z.object({
  message: nonEmptyStringSchema,
});

export const caseNoteFormSchema = z.object({
  content: nonEmptyStringSchema,
  isPinned: z.boolean().optional(),
});

export const adminMessageFormSchema = z.object({
  category: categorySchema,
  title: nonEmptyStringSchema,
  body: nonEmptyStringSchema,
});

export type LoginFormData = z.infer<typeof loginFormSchema>;
export type AccessCodeFormData = z.infer<typeof accessCodeFormSchema>;
export type FeedbackFormData = z.infer<typeof feedbackFormSchema>;
export type MessageFormData = z.infer<typeof messageFormSchema>;
export type CaseNoteFormData = z.infer<typeof caseNoteFormSchema>;
export type AdminMessageFormData = z.infer<typeof adminMessageFormSchema>;

export function validateField<T>(schema: z.ZodType<T>, value: unknown): { success: boolean; error?: string; data?: T } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.errors[0]?.message };
}

export function validateForm<T>(schema: z.ZodType<T>, data: unknown): { success: boolean; errors?: Record<string, string>; data?: T } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errors: Record<string, string> = {};
  for (const error of result.error.errors) {
    const path = error.path.join(".");
    if (!errors[path]) {
      errors[path] = error.message;
    }
  }
  return { success: false, errors };
}

export function getFirstError(errors: Record<string, string> | undefined): string | undefined {
  if (!errors) return undefined;
  const keys = Object.keys(errors);
  return keys.length > 0 ? errors[keys[0]] : undefined;
}

export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, "")
    .trim();
}

export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
