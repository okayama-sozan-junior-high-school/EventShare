import { createRequestHandler, RouterContextProvider } from "react-router";
import { requestInfoContext } from "../app/.server/context";
import { runScheduledJobs } from "../app/.server/services/scheduled";
import {
  applySecurityHeaders,
  createNonce,
  isCrossSiteMutation,
} from "../app/.server/security";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, _env, ctx) {
    const nonce = createNonce();
    const production = import.meta.env.PROD;

    if (isCrossSiteMutation(request)) {
      return applySecurityHeaders(
        new Response("Cross-site request rejected", { status: 403 }),
        { nonce, production },
      );
    }

    const context = new RouterContextProvider();
    context.set(requestInfoContext, {
      nonce,
      clientIp: request.headers.get("cf-connecting-ip") ?? "unknown",
      waitUntil: (p) => ctx.waitUntil(p),
    });

    const response = await requestHandler(request, context);
    return applySecurityHeaders(response, { nonce, production });
  },

  async scheduled(controller, _env, ctx) {
    ctx.waitUntil(runScheduledJobs(new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
