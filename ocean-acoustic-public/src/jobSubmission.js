// Reuse the receipt key after an ambiguous network failure. Only an accepted
// response clears it; a second click while the request is pending is ignored.
export async function submitJobOnce(receipt, plan, submit) {
  if (receipt.pending) return null;
  const body = JSON.stringify(plan);
  if (receipt.body !== body || !receipt.key) {
    receipt.body = body;
    receipt.key = crypto.randomUUID();
  }
  receipt.pending = true;
  try {
    const result = await submit(body, receipt.key);
    receipt.key = null;
    return result;
  } finally {
    receipt.pending = false;
  }
}
