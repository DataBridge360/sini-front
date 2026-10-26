# Gesti module (front-only AI chat)

New `gesti` tab (`/gesti`) in the CRM shell: an insurance-oriented AI assistant chat, UI only, no backend.
Sidebar redesign, route, nav entry, brand assets and the `GestiView` mount are already done by the parent.

## Specs

- S1 (verbatim): "vamos a agregar un modulo llamado Gesti, que va a ser un chat de IA, de momento solo front con este estilo:" — the `AIAssistantInterface` reference below (centered hero with logo, welcome message, input card with toggle chips + send, file upload, command categories that expand suggestion lists with animation).
- S2 (verbatim): "Los archivos e imagenes quiero que aparezcan arriba y no abajo como pasa actualmente" — attachments (files and images) render ABOVE the text input inside the composer, never below it.
- S3 (verbatim): "y con este streamingtext:" — assistant replies use the `StreamingText` reference below: words fade in out of blur, inline citation chip, then action icons (copy, retry, thumbs up, thumbs down), an expandable "N fuentes" sources list, and follow-up prompts.
- S4 (verbatim): "Obviamente todo el diseño orientado a seguros, tambien puedes utilizar a Gesti que es como se va a llamar el asistente de IA, su diseño esta en @assets ... debe ser algo minimalista todo."
- S5 (verbatim): "Install NPM dependencies: lucide-react, framer-motion" — both are installed; use `framer-motion` for the animations.

## Decisions already taken by the parent (do not revisit)

- The project is NOT shadcn: no `components.json`, no `cn()`, Tailwind 4 CSS-first (no `tailwind.config.js`). The reference `globals.css` / tailwind config / DM Sans font are NOT applied: they would override the whole CRM design system. Styles go in `app/gesti.css` (already imported from `app/globals.css`), plain CSS with `gesti-` prefixed classes, following the codebase's `sp-*` class idiom. The reference's ink/inset/hover tokens are defined as CSS custom properties scoped under the `.gesti` root class.
- UI copy is Spanish with voseo, like the rest of the app (e.g. "Avisá", "trabajás"). Code comments in Spanish to match the codebase.
- Gesti assets: `/gesti/gesti-avatar.webp` (head, square, transparent, 192px) and `/gesti/gesti.webp` (full body thumbs-up, 480px, transparent). Brand blue `#0a72d1`. Use `next/image`.
- Front-only: replies are canned, chosen by keyword. They must NOT invent concrete client/policy data that a user could believe is real. Data questions get an answer that explains what Gesti will do once connected; procedural insurance questions (claim documentation, coverage differences, message drafts) can get real generic content. A visible "Vista previa" marker plus the disclaimer "Gesti puede equivocarse. Verificá los datos importantes." sit near the composer.
- No dead controls: drop the reference's mic button. Attachments are REAL local files (file input + drag & drop + paste images), images with thumbnail previews via object URLs (revoke them), files as chips with name and size, each removable.
- Toggle chips adapted to insurance: "Cartera" (use portfolio data) and "Razonar". Categories adapted to insurance (for example Cartera, Siniestros, Cobranzas, Redactar), each with 3 suggestions.
- Sources in replies are app sections (Avisos, Pólizas, Asegurados, Tareas…) rendered as buttons that call `onNavigate(tab)`, with lucide icons in tinted squares instead of the reference's data-URI images.

## Tasks

- T1 (S1-S5): create `components/ui/streaming-text.tsx`, `components/ui/ai-assistant-interface.tsx`, `components/views/gesti-view.tsx`, `app/gesti.css`. Route: gentle-ai-worker.

## Log

- L1: user request (relevant parts quoted in Specs; reference components below are verbatim).

### Reference: ai-assistant-interface.tsx (verbatim from the user, abridged only where marked)

```tsx
"use client";
import { useState, useRef } from "react";
import { Search, Mic, ArrowUp, Plus, FileText, Code, BookOpen, PenTool, BrainCircuit, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function AIAssistantInterface() {
  const [inputValue, setInputValue] = useState("");
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [reasonEnabled, setReasonEnabled] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [showUploadAnimation, setShowUploadAnimation] = useState(false);
  const [activeCommandCategory, setActiveCommandCategory] = useState<string | null>(null);
  // ...commandSuggestions { learn: [...], code: [...], write: [...] }
  // handleUploadFile: shows 3 staggered bouncing dots (motion variants, staggerChildren 0.1,
  //   repeat Infinity, repeatType "mirror") for 1.5s, then appends "Document.pdf".
  // handleCommandSelect: fills the input, closes the category, focuses the input.
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-6">
      <div className="w-full max-w-3xl mx-auto flex flex-col items-center">
        {/* Logo with animated gradient (80px blurred blue gradient ring, .animate-gradient rotate 8s) */}
        {/* Welcome: motion.div initial {opacity:0,y:10} animate {opacity:1,y:0} duration .3;
            h1 "Ready to assist you" text-3xl bold gradient from-blue-600 to-blue-400; p text-gray-500 */}
        <div className="w-full bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mb-4">
          <div className="p-4">{/* input "Ask me anything..." */}</div>
          {/* Uploaded files chips: bg-gray-50 border rounded-md, FileText icon, name, x button  <-- currently BELOW the input; S2 moves them ABOVE */}
          <div className="px-4 py-3 flex items-center justify-between">
            {/* left: pill toggles px-3 py-1.5 rounded-full text-sm; on: bg-blue-50 text-blue-600; off: bg-gray-100 text-gray-400 */}
            {/* right: mic, send 32px round: enabled bg-blue-600 text-white, disabled bg-gray-100 text-gray-400 */}
          </div>
          <div className="px-4 py-2 border-t border-gray-100">{/* "+ Upload Files" */}</div>
        </div>
        {/* grid grid-cols-3 gap-4 CommandButton: flex-col p-4 rounded-xl border; active bg-blue-50 border-blue-200 */}
        {/* AnimatePresence suggestions panel: initial {opacity:0,height:0} animate {opacity:1,height:"auto"};
            card with header "Learning suggestions"; li items stagger delay index*0.03, icon text-blue-600 */}
      </div>
    </div>
  );
}
```

### Reference: streaming-text.tsx (verbatim from the user, abridged only where marked)

```tsx
"use client";
import { useEffect, useState } from "react";
/* STREAMING TEXT — Words resolve out of blur, inline citations appear in
 * context, then actions and follow-up prompts become usable. */
const WORD_MS = 80;
const HOLD_MS = 3400;
type Token = { text: string; cite?: boolean };
// TOKENS = words of a sentence, a { text: "", cite: true } chip in the middle, more words.
// FOLLOW_UPS = 2 strings. SOURCES = 3 { name, domain, href, image }.
function SourceChip() {
  // <a> inline-flex h-4.5 translate-y-[-1px] items-center gap-1 rounded-[5px] bg-inset pr-1.5 pl-[3px]
  //   align-middle font-mono text-[10.5px] text-ink-2 shadow-hairline hover:bg-hover hover:text-ink
  //   style animation "pop-in 250ms cubic-bezier(0.23,1,0.32,1) both"; 12px image + domain
}
// ACTION_ICONS: copy, retry, thumbs up, thumbs down (15px stroke 1.8 svgs)
export default function StreamingText() {
  const [count, setCount] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const done = count >= TOKENS.length;
  useEffect(() => {
    const t = setTimeout(() => setCount((c) => (c >= TOKENS.length ? 0 : c + 1)), done ? HOLD_MS : WORD_MS);
    return () => clearTimeout(t);
  }, [count, done]);
  return (
    <div className="min-h-[13rem] w-full max-w-95">
      <p className="text-[13px] leading-relaxed text-ink">
        {/* tokens: span style animation "fade-in 250ms ease-out both"; cite -> <SourceChip/> */}
        {/* caret while streaming: ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-ink */}
      </p>
      {/* actions row mt-2 gap-0.5, opacity done?1:0 transition 400ms: 24px icon buttons text-ink-3 hover:bg-hover-2;
          then sources toggle: stacked 14px avatars (-space-x-1, ring 1.5px var(--canvas)) + "10 sources" text-[12px] text-ink-2 */}
      {/* sources panel: grid rows 0fr->1fr + opacity, 300ms cubic-bezier(0.23,1,0.32,1);
          inner rounded-control bg-inset p-1 shadow-hairline; rows: 16px image, name (animated-underline), mono domain ml-auto text-ink-3 */}
      {/* follow-ups mt-2.5: label "Follow-ups" text-[12px] font-medium text-ink-2; buttons border-b border-line
          py-1.5 text-[12.5px], reply-arrow 11px icon, animation `fade-up 350ms cubic-bezier(0.23,1,0.32,1) ${i*90}ms both` */}
    </div>
  );
}
```

Reference tokens and keyframes (verbatim):

```css
:root {
  --page: #fafafb; --canvas: #f1f2f3; --surface: #ffffff; --inset: #f7f8f9;
  --hover: #f4f5f6; --hover-2: #e7e9eb; --ink: #1f2124; --ink-2: #62656b; --ink-3: #9a9da3;
  --line: #ecedef; --line-strong: #e0e2e5; --radius-control: 8px;
  --ease-link: cubic-bezier(0.16, 1, 0.3, 1); --shadow-hairline: 0 0 0 1px var(--line);
}
@keyframes fade-in { 0% { opacity: 0; } to { opacity: 1; } }
@keyframes pop-in { 0% { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
@keyframes fade-up { 0% { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
```
