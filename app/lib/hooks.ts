import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "~/root";
import { DEFAULT_TIME_ZONE } from "./datetime";

export function useRootData() {
  return useRouteLoaderData<typeof rootLoader>("root");
}

export function useTimeZone() {
  return useRootData()?.timeZone ?? DEFAULT_TIME_ZONE;
}

export function useCurrentUser() {
  return useRootData()?.user ?? null;
}
