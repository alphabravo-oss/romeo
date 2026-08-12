// Assistants ship OFF, and with them off the run path withholds the entire assembled system
// prompt — identity, personalization and memory alike — so no request carries a system turn. A
// test that asserts what lands IN that prompt has to state the precondition itself rather than
// inherit a default that says the opposite.

interface TestApi {
  request(path: string, init?: RequestInit): Response | Promise<Response>;
}

/** Turn assistants on for the caller's org through the admin chat-experience route. */
export async function enableAssistants(api: TestApi): Promise<void> {
  const currentResponse = await api.request("/api/v1/chat-experience");
  const current = await currentResponse.json();
  const response = await api.request("/api/v1/admin/chat-experience", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...current.data, assistantsEnabled: true }),
  });
  if (response.status !== 200) {
    throw new Error(
      `failed to enable assistants: ${response.status} ${await response.text()}`,
    );
  }
}
