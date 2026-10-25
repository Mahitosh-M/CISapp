import { auth } from "../firebase";
export const dispatchEndpoint =
  import.meta.env.VITE_DISPATCH_BRIDGE_URL ||
  "https://asia-south1-cisapp-236ab.cloudfunctions.net/dispatchBridge";
export async function dispatchRequest<T = Record<string, unknown>>(
  action: string,
  payload: unknown = {},
): Promise<T> {
  const url = new URL(dispatchEndpoint);
  if (
    url.href !==
      "https://asia-south1-cisapp-236ab.cloudfunctions.net/dispatchBridge" &&
    !(import.meta.env.DEV && ["127.0.0.1", "localhost"].includes(url.hostname))
  )
    throw new Error("Unapproved Dispatch backend");
  if (!auth.currentUser)
    throw new Error("Sign in to CISapp before connecting Dispatch.");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      "x-dispatch-issuer": "cisapp-236ab",
    },
    body: JSON.stringify({ action, payload }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error)
    throw new Error(
      data.error ||
        "Dispatch backend unavailable. This development feature must be deployed after approval.",
    );
  return data.result as T;
}
