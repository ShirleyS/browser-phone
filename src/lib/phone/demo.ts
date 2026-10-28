// Offline demo engine: pure, deterministic, never touches the network.
import type { Lang, ChatLink } from "./types";

export function demoReply(text: string, lang: Lang): { text: string; link?: ChatLink } {
  const s = text.toLowerCase();
  const es = lang === "es";
  if (/(receipt|recibo|ticket)/.test(s))
    return { text: es ? "Aquí está tu recibo de ejemplo." : "Here is your sample receipt.", link: { label: es ? "Ver recibo (simulado)" : "View receipt (simulated)", url: "https://example.com/receipt/demo-1042", simulated: true } };
  if (/(pay|pago|pagar)/.test(s))
    return { text: es ? "Puedes pagar con este enlace de ejemplo." : "You can pay with this example link.", link: { label: es ? "Pagar $249.00 MXN (simulado)" : "Pay $249.00 MXN (simulated)", url: "https://example.com/pay/demo-1042", simulated: true } };
  if (/(order|pedido|orden|status|estado)/.test(s))
    return { text: es ? "Tu pedido #1042 está en preparación. Llega en ~25 min." : "Your order #1042 is being prepared. Arrives in ~25 min." };
  if (/(hi|hello|hola|buenas)/.test(s))
    return { text: es ? "¡Hola! Soy la demo de Ring Orden. Pregunta por tu pedido, recibo o pago." : "Hi! This is the Ring Orden demo. Ask about your order, receipt or payment." };
  return { text: es ? `Recibido: “${text.slice(0, 80)}”. (Respuesta demo local)` : `Got it: “${text.slice(0, 80)}”. (Local demo reply)` };
}

export const DEMO_PRESET = { name: "Ring Orden", number: "+52 55 91100000" };

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
