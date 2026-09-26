import type { AxiosInstance } from 'axios';
import { z } from 'zod';

const authCheckResponseSchema = z.object({ userId: z.string().min(1) });

export type GatewayAuthResult = 'authenticated' | 'rejected' | 'unavailable' | 'unreachable';

export async function checkGatewayAuth(client: AxiosInstance): Promise<GatewayAuthResult> {
  try {
    const response = await client.get('/v1/auth-check', { validateStatus: () => true });

    switch (response.status) {
      case 200:
        return authCheckResponseSchema.safeParse(response.data).success
          ? 'authenticated'
          : 'unavailable';
      case 401:
        return 'rejected';
      case 503:
        return 'unavailable';
      default:
        return 'unavailable';
    }
  } catch {
    return 'unreachable';
  }
}
