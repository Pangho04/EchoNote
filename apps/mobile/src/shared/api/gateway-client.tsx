import axios, { type AxiosInstance } from 'axios';
import { createContext, type ReactNode, useContext } from 'react';

export function createGatewayClient(
  baseURL: string,
  getAccessToken: () => Promise<string | null>,
): AxiosInstance {
  const client = axios.create({ baseURL, timeout: 10_000 });

  client.interceptors.request.use(async (config) => {
    const token = await getAccessToken();

    if (token) config.headers.Authorization = `Bearer ${token}`;

    return config;
  });

  return client;
}

const GatewayClientContext = createContext<AxiosInstance | null>(null);

export interface GatewayClientProviderProps {
  client: AxiosInstance;
  children: ReactNode;
}

export function GatewayClientProvider({ client, children }: GatewayClientProviderProps) {
  return <GatewayClientContext.Provider value={client}>{children}</GatewayClientContext.Provider>;
}

export function useGatewayClient(): AxiosInstance {
  const value = useContext(GatewayClientContext);

  if (!value) throw new Error('useGatewayClient must be used inside GatewayClientProvider');

  return value;
}
