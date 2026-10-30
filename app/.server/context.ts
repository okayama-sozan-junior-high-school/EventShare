import { createContext } from "react-router";
import type { AuthSession } from "./auth";

export type RequestInfo = {
  /** CSP nonce for inline scripts emitted by React Router. */
  nonce: string;
  clientIp: string;
  waitUntil: (promise: Promise<unknown>) => void;
};

export const requestInfoContext = createContext<RequestInfo>({
  nonce: "",
  clientIp: "unknown",
  waitUntil: () => {},
});

export const sessionContext = createContext<AuthSession | null>(null);
