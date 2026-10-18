
Deno.serve(() => {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "NMAMIT CONNECT",
      function: "health-check",
      version: "1.0.0",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
});
