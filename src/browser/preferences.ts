import {z} from 'zod';

// Applied when the owned browser context is created, before its first navigation.
export const browserPreferencesSchema = z
    .object({
        locale: z.string().min(1).optional(),
        colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
    })
    .strict();

export type BrowserPreferences = z.infer<typeof browserPreferencesSchema>;
