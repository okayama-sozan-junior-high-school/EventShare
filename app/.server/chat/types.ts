import { z } from "zod";

export const STYLES = ["create", "learn", "compete", "present", "volunteer", "any"] as const;
export const SLOTS = ["interest", "style", "format", "period"] as const;

export type Style = (typeof STYLES)[number];
export type Slot = (typeof SLOTS)[number];

/** Conversation state. Round-tripped through the client and re-validated. */
export const chatStateSchema = z.object({
  categories: z.array(z.string().max(50)).max(11).default([]),
  keywords: z.array(z.string().max(30)).max(10).default([]),
  style: z.enum(STYLES).nullable().default(null),
  format: z.enum(["online", "offline", "any"]).nullable().default(null),
  location: z.string().max(30).nullable().default(null),
  period: z.enum(["soon", "3months", "any"]).nullable().default(null),
  fee: z.enum(["free", "any"]).nullable().default(null),
  participation: z.enum(["solo", "team", "any"]).nullable().default(null),
  asked: z.array(z.enum(SLOTS)).max(10).default([]),
  /** Slot the last assistant message asked about (for "なんでもいい" answers). */
  pending: z.enum(SLOTS).nullable().default(null),
  searched: z.boolean().default(false),
});

export type ChatState = z.infer<typeof chatStateSchema>;

export const emptyState = (): ChatState => chatStateSchema.parse({});

/** What one user message contributes; null = not mentioned. */
export type Extracted = {
  categories: string[];
  keywords: string[];
  style: Style | null;
  format: "online" | "offline" | "any" | null;
  location: string | null;
  period: "soon" | "3months" | "any" | null;
  fee: "free" | "any" | null;
  participation: "solo" | "team" | "any" | null;
  noPreference: boolean;
  wantsResults: boolean;
  reset: boolean;
};

export type CategoryInfo = { id: number; slug: string; name: string };

export type Recommendation = {
  eventId: string;
  reason: string;
  reasonSource: "ai" | "rule";
};

export type QuickReply = { label: string; message: string };
