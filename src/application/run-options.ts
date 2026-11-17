import {z} from 'zod';

export const browserRunSchema = z
    .object({
        url: z.string().url(),
        video: z.boolean().optional(),
        headless: z.boolean().optional(),
        locale: z.string().optional(),
        viewport: z
            .object({width: z.number().int().positive(), height: z.number().int().positive()})
            .strict()
            .optional(),
        deviceScaleFactor: z.number().positive().optional(),
    })
    .strict();

export type BrowserRunDefaults = Partial<z.infer<typeof browserRunSchema>>;
