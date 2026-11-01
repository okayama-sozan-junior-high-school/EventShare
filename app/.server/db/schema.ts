import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).default(now).notNull();
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .default(now)
    .$onUpdate(() => new Date())
    .notNull();

// ---------------------------------------------------------------------------
// Better Auth tables (user / session / account / verification)
// Columns follow the Better Auth core schema + admin plugin. App-specific
// profile columns are declared as `additionalFields` in auth.server.ts.
// ---------------------------------------------------------------------------

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .default(false)
      .notNull(),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // admin plugin
    role: text("role").default("user").notNull(),
    banned: integer("banned", { mode: "boolean" }).default(false),
    banReason: text("ban_reason"),
    banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
    // profile
    grade: text("grade"),
    bio: text("bio"),
    /** public = anyone / members = logged-in users only / private = only self */
    profileVisibility: text("profile_visibility", {
      enum: ["public", "members", "private"],
    })
      .default("members")
      .notNull(),
    /** Set when school affiliation has been confirmed (e.g. school email). */
    schoolVerifiedAt: integer("school_verified_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("user_role_idx").on(t.role)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const EVENT_FORMATS = ["offline", "online", "hybrid", "unknown"] as const;
export const FEE_TYPES = ["free", "paid", "unknown"] as const;
export const EVENT_STATUSES = ["published", "hidden", "merged"] as const;

/**
 * A recurring event ("高校生AIハッカソン"). Every event row is one edition of a
 * series; one-off events are series with a single edition.
 */
export const eventSeries = sqliteTable(
  "event_series",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    /** `normalizeForMatch(stripEditionMarkers(title))` for candidate lookup. */
    matchKey: text("match_key").notNull(),
    description: text("description"),
    watchCount: integer("watch_count").default(0).notNull(),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("event_series_match_key_idx").on(t.matchKey)],
);

/** "Notify me when the next edition is posted." */
export const seriesWatches = sqliteTable(
  "series_watches",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    seriesId: text("series_id")
      .notNull()
      .references(() => eventSeries.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.seriesId] }),
    index("series_watches_series_idx").on(t.seriesId),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    startAt: integer("start_at", { mode: "timestamp_ms" }),
    endAt: integer("end_at", { mode: "timestamp_ms" }),
    location: text("location"),
    format: text("format", { enum: EVENT_FORMATS }).default("unknown").notNull(),
    organizer: text("organizer"),
    targetAudience: text("target_audience"),
    feeType: text("fee_type", { enum: FEE_TYPES }).default("unknown").notNull(),
    feeDetail: text("fee_detail"),
    applicationDeadline: integer("application_deadline", {
      mode: "timestamp_ms",
    }),
    officialUrl: text("official_url"),
    applicationUrl: text("application_url"),
    imageMediaId: text("image_media_id"),
    status: text("status", { enum: EVENT_STATUSES })
      .default("published")
      .notNull(),
    mergedIntoId: text("merged_into_id"),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Normalized title / URL for duplicate detection. */
    normalizedTitle: text("normalized_title").notNull(),
    normalizedOfficialUrl: text("normalized_official_url"),
    likeCount: integer("like_count").default(0).notNull(),
    bookmarkCount: integer("bookmark_count").default(0).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),
    /**
     * Nullable in the DB only because SQLite cannot add a NOT NULL column to
     * a populated table. The app always sets it; null means broken data.
     */
    seriesId: text("series_id").references(() => eventSeries.id, {
      onDelete: "set null",
    }),
    /** Display label of this edition, e.g. `2025` / `第4回` (max 30 chars). */
    editionLabel: text("edition_label"),
    /** Month (1-12) of `start_at` in APP_TIMEZONE, computed on write. */
    startMonth: integer("start_month"),
    endorsementCount: integer("endorsement_count").default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("events_status_start_idx").on(t.status, t.startAt),
    index("events_status_deadline_idx").on(t.status, t.applicationDeadline),
    index("events_status_created_idx").on(t.status, t.createdAt),
    index("events_status_like_idx").on(t.status, t.likeCount),
    index("events_normalized_url_idx").on(t.normalizedOfficialUrl),
    index("events_created_by_idx").on(t.createdById),
    index("events_series_start_idx").on(t.seriesId, t.startAt),
    index("events_status_start_month_idx").on(t.status, t.startMonth),
    index("events_status_endorsement_idx").on(t.status, t.endorsementCount),
  ],
);

export const eventCategories = sqliteTable(
  "event_categories",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.categoryId] }),
    index("event_categories_category_idx").on(t.categoryId),
  ],
);

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const TAG_FACET_VALUES = [
  "audience",
  "participation",
  "schedule",
  "outcome",
  "other",
] as const;
export const TAG_STATUSES = ["active", "hidden"] as const;

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** `normalizeTagName(name)`. Unique key and URL segment. */
  slug: text("slug").notNull().unique(),
  facet: text("facet", { enum: TAG_FACET_VALUES }).default("other").notNull(),
  status: text("status", { enum: TAG_STATUSES }).default("active").notNull(),
  useCount: integer("use_count").default(0).notNull(),
  createdById: text("created_by_id").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
});

export const eventTags = sqliteTable(
  "event_tags",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    addedById: text("added_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.tagId] }),
    index("event_tags_tag_idx").on(t.tagId),
  ],
);

/** URLs that information about an event was taken from. */
export const eventSources = sqliteTable(
  "event_sources",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    kind: text("kind", { enum: ["official", "application", "reference"] })
      .default("reference")
      .notNull(),
    addedById: text("added_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("event_sources_event_url_uq").on(t.eventId, t.normalizedUrl),
    index("event_sources_normalized_url_idx").on(t.normalizedUrl),
  ],
);

export const CONTRIBUTION_TYPES = [
  "create",
  "add_info",
  "edit",
  "merge",
  "moderate",
] as const;

/**
 * Who contributed what to an event. Doubles as the edit history: `changes`
 * stores a JSON object of `{ field: { from, to } }`.
 */
export const eventContributions = sqliteTable(
  "event_contributions",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    type: text("type", { enum: CONTRIBUTION_TYPES }).notNull(),
    note: text("note"),
    changes: text("changes", { mode: "json" }).$type<
      Record<string, { from: unknown; to: unknown }>
    >(),
    createdAt: createdAt(),
  },
  (t) => [
    index("event_contributions_event_idx").on(t.eventId, t.createdAt),
    index("event_contributions_user_idx").on(t.userId, t.createdAt),
  ],
);

export const eventLikes = sqliteTable(
  "event_likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.eventId] }),
    index("event_likes_event_idx").on(t.eventId),
  ],
);

export const eventBookmarks = sqliteTable(
  "event_bookmarks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.eventId] }),
    index("event_bookmarks_event_idx").on(t.eventId),
  ],
);

export const eventParticipations = sqliteTable(
  "event_participations",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.eventId] }),
    index("event_participations_event_idx").on(t.eventId),
  ],
);

export const CONTENT_STATUSES = ["visible", "hidden", "deleted"] as const;

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    status: text("status", { enum: CONTENT_STATUSES })
      .default("visible")
      .notNull(),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("comments_event_idx").on(t.eventId, t.createdAt),
    index("comments_user_idx").on(t.userId),
    index("comments_status_idx").on(t.status, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Activity reports
// ---------------------------------------------------------------------------

export const activityReports = sqliteTable(
  "activity_reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    motivation: text("motivation"),
    activity: text("activity").notNull(),
    reflection: text("reflection"),
    relatedUrl: text("related_url"),
    status: text("status", { enum: CONTENT_STATUSES })
      .default("visible")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("activity_reports_event_idx").on(t.eventId, t.createdAt),
    index("activity_reports_user_idx").on(t.userId, t.createdAt),
    index("activity_reports_status_idx").on(t.status, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Endorsements (おすすめ) — left by participants for future students
// ---------------------------------------------------------------------------

export const ENDORSEMENT_AUDIENCES = ["beginner_ok", "experienced", "anyone"] as const;

export const eventEndorsements = sqliteTable(
  "event_endorsements",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    audience: text("audience", { enum: ENDORSEMENT_AUDIENCES }).notNull(),
    /** Max 200 chars. */
    comment: text("comment"),
    activityReportId: text("activity_report_id").references(
      () => activityReports.id,
      { onDelete: "set null" },
    ),
    status: text("status", { enum: ["visible", "hidden"] })
      .default("visible")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("event_endorsements_user_event_uq").on(t.userId, t.eventId),
    index("event_endorsements_event_idx").on(t.eventId, t.createdAt),
  ],
);

/** Files stored in R2. Every object served from /media/* must have a row. */
export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: ["image", "video"] }).notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    activityReportId: text("activity_report_id").references(
      () => activityReports.id,
      { onDelete: "cascade" },
    ),
    status: text("status", { enum: CONTENT_STATUSES })
      .default("visible")
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("media_assets_report_idx").on(t.activityReportId)],
);

// ---------------------------------------------------------------------------
// Moderation reports (通報)
// ---------------------------------------------------------------------------

export const REPORT_TARGETS = [
  "event",
  "comment",
  "activity_report",
  "user",
  "endorsement",
] as const;
export const REPORT_REASONS = [
  "inappropriate",
  "personal_info",
  "spam",
  "incorrect",
  "duplicate",
  "other",
] as const;

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id").references(() => user.id, {
      onDelete: "set null",
    }),
    targetType: text("target_type", { enum: REPORT_TARGETS }).notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason", { enum: REPORT_REASONS }).notNull(),
    detail: text("detail"),
    duplicateOfEventId: text("duplicate_of_event_id").references(
      () => events.id,
      { onDelete: "set null" },
    ),
    status: text("status", { enum: ["open", "resolved", "dismissed"] })
      .default("open")
      .notNull(),
    resolvedById: text("resolved_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolutionNote: text("resolution_note"),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("reports_status_idx").on(t.status, t.createdAt),
    index("reports_target_idx").on(t.targetType, t.targetId),
    uniqueIndex("reports_reporter_target_uq").on(
      t.reporterId,
      t.targetType,
      t.targetId,
      t.reason,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  "new_event",
  "deadline_soon",
  "event_soon",
  "comment",
  "reaction",
  "new_edition",
  "system",
] as const;

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    eventId: text("event_id").references(() => events.id, {
      onDelete: "cascade",
    }),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Prevents duplicated reminders (e.g. `deadline:<event>:<user>`). */
    dedupeKey: text("dedupe_key").unique(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const notificationSettings = sqliteTable("notification_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  newEvent: integer("new_event", { mode: "boolean" }).default(true).notNull(),
  deadlineSoon: integer("deadline_soon", { mode: "boolean" })
    .default(true)
    .notNull(),
  eventSoon: integer("event_soon", { mode: "boolean" }).default(true).notNull(),
  comment: integer("comment", { mode: "boolean" }).default(true).notNull(),
  reaction: integer("reaction", { mode: "boolean" }).default(true).notNull(),
  newEdition: integer("new_edition", { mode: "boolean" })
    .default(true)
    .notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Interests & AI chat
// ---------------------------------------------------------------------------

export const userInterests = sqliteTable(
  "user_interests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    source: text("source", { enum: ["manual", "ai_chat"] })
      .default("manual")
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_interests_user_label_uq").on(t.userId, t.label)],
);

export const chatSessions = sqliteTable(
  "chat_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    state: text("state", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("chat_sessions_user_idx").on(t.userId, t.updatedAt)],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    /** Recommended events: `[{ eventId, reason, reasonSource }]` */
    recommendations: text("recommendations", { mode: "json" }).$type<
      { eventId: string; reason: string; reasonSource: "ai" | "rule" }[]
    >(),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_session_idx").on(t.sessionId, t.createdAt)],
);

/** Tunable application settings (e.g. duplicate-detection weights). */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedById: text("updated_by_id").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Relations (used by Better Auth joins and relational queries)
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export type User = typeof user.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type ActivityReport = typeof activityReports.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type EventSeries = typeof eventSeries.$inferSelect;
export type NewEventSeries = typeof eventSeries.$inferInsert;
export type SeriesWatch = typeof seriesWatches.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type EventTag = typeof eventTags.$inferSelect;
export type EventEndorsement = typeof eventEndorsements.$inferSelect;
export type EventFormat = (typeof EVENT_FORMATS)[number];
export type FeeType = (typeof FEE_TYPES)[number];
export type TagFacet = (typeof TAG_FACET_VALUES)[number];
export type EndorsementAudience = (typeof ENDORSEMENT_AUDIENCES)[number];
