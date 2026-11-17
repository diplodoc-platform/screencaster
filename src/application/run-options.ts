import {z} from 'zod';

import {browserPreferencesSchema} from '../browser/preferences.js';

export const browserRunSchema = browserPreferencesSchema
    .extend({
        url: z.string().url(),
        video: z.boolean().optional(),
        headless: z.boolean().optional(),
        viewport: z
            .object({width: z.number().int().positive(), height: z.number().int().positive()})
            .strict()
            .optional(),
        deviceScaleFactor: z.number().positive().optional(),
    })
    .strict();

export type BrowserRunDefaults = Partial<z.infer<typeof browserRunSchema>>;
