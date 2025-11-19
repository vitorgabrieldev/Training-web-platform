export default async function handler(req, res) {
  const result = await fetch("https://api.mistral.ai/v1/conversations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": process.env.MISTRAL_KEY
    },
    body: JSON.stringify(req.body)
  });

  const json = await result.json();
  res.status(result.status).json(json);
}
