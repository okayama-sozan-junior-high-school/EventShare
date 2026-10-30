import { data } from "react-router";
import { getConfig } from "~/.server/config";
import { createDb } from "~/.server/db";
import { getEvent } from "~/.server/services/events";
import type { Route } from "./+types/events.$id.ics";

function icsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding (75 octets). */
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const event = await getEvent(createDb(), params.id);
  if (!event || event.status !== "published" || !event.startAt) {
    throw data("Not found", { status: 404 });
  }
  const origin = new URL(getConfig().baseUrl || request.url).origin;
  const end = event.endAt ?? new Date(event.startAt.getTime() + 60 * 60 * 1000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Event Share//JA",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}@event-share`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(event.startAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    event.location ? `LOCATION:${escapeIcs(event.location)}` : null,
    `DESCRIPTION:${escapeIcs(`${(event.description ?? "").slice(0, 500)}\n\n${origin}/events/${event.id}`)}`,
    `URL:${origin}/events/${event.id}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);

  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="event-${event.id.slice(0, 8)}.ics"`,
    },
  });
}
