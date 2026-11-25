const WHATSAPP_LIMIT = 4000;

export function splitWhatsAppText(text: string, limit = WHATSAPP_LIMIT): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return ['...'];
  if (clean.length <= limit) return [clean];

  const parts: string[] = [];
  let rest = clean;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;
    const piece = rest.slice(0, cut).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}
