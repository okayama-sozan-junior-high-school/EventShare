import {
  type RouteConfig,
  index,
  layout,
  prefix,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  // Events
  route("events", "routes/events.tsx"),
  route("events/new", "routes/events.new.tsx"),
  route("events/:id", "routes/events.$id.tsx"),
  route("events/:id/edit", "routes/events.$id.edit.tsx"),
  route("events/:id/calendar.ics", "routes/events.$id.ics.ts"),
  route("calendar", "routes/calendar.tsx"),
  route("chat", "routes/chat.tsx"),

  // Activity reports
  route("activities", "routes/activities.tsx"),
  route("activities/new", "routes/activities.new.tsx"),
  route("activities/:id", "routes/activities.$id.tsx"),
  route("activities/:id/edit", "routes/activities.$id.edit.tsx"),

  // Users
  route("users/:id", "routes/users.$id.tsx"),
  route("me", "routes/me.tsx"),
  route("settings", "routes/settings.tsx"),
  route("notifications", "routes/notifications.tsx"),

  // Auth
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.ts"),

  // Static pages
  route("guidelines", "routes/guidelines.tsx"),
  route("ai-connect", "routes/ai-connect.tsx"),

  // Resource routes
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("api/chat", "routes/api.chat.ts"),
  route("api/report", "routes/api.report.ts"),
  route("media/:id", "routes/media.$id.ts"),

  // Admin
  ...prefix("admin", [
    layout("routes/admin/layout.tsx", [
      index("routes/admin/dashboard.tsx"),
      route("reports", "routes/admin/reports.tsx"),
      route("events", "routes/admin/events.tsx"),
      route("merge", "routes/admin/merge.tsx"),
      route("users", "routes/admin/users.tsx"),
      route("comments", "routes/admin/comments.tsx"),
      route("categories", "routes/admin/categories.tsx"),
      route("history", "routes/admin/history.tsx"),
      route("settings", "routes/admin/settings.tsx"),
    ]),
  ]),

  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
