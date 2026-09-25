import { z } from 'zod';

export const identifierSchema = z.string().trim().min(1);
