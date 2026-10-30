import { redirect } from "react-router";
import { getAuth } from "~/.server/auth";
import type { Route } from "./+types/logout";

export async function action({ request }: Route.ActionArgs) {
  try {
    const { headers } = await getAuth().api.signOut({
      headers: request.headers,
      returnHeaders: true,
    });
    return redirect("/", { headers });
  } catch {
    return redirect("/");
  }
}

export function loader() {
  return redirect("/");
}
