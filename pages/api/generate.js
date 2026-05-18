// ============================================================
// MOCHA BUILDER — API Route v3
// All fixes applied:
// - System prompt server-side only (IP protected)
// - Robust SSE stream parser (handles split chunks)
// - Context window truncation (max 2 HTML turns sent)
// - 55-second API timeout (prevents Vercel gateway timeouts)
// - Model name via env variable (future-proof)
// - In-memory rate limiter (replace with Upstash for production)
// - Friendly error messages for all failure modes
// ============================================================

const rateLimits = new Map()
const WINDOW_MS = 60 * 60 * 1000  // 1 hour
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || '15')

function checkRateLimit(ip) {
  const now = Date.now()
  const requests = (rateLimits.get(ip) || []).filter(t => now - t < WINDOW_MS)
  if (requests.length >= MAX_REQUESTS) {
    const resetIn = Math.ceil((requests[0] + WINDOW_MS - now) / 60000)
    return { allowed: false, remaining: 0, resetIn }
  }
  rateLimits.set(ip, [...requests, now])
  return { allowed: true, remaining: MAX_REQUESTS - requests.length - 1 }
}

// Truncate conversation history to prevent context window blowout.
// Keeps all user messages but only the last 2 assistant HTML turns.
// Without this, 4-5 iterations = 20,000+ tokens per request.
function truncateHistory(messages) {
  if (!Array.isArray(messages)) return []
  
  let assistantCount = 0
  const result = []
  
  // Walk backwards, keep last 2 assistant turns
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant') {
      assistantCount++
      if (assistantCount <= 2) {
        result.unshift(msg)
      }
      // Drop older assistant turns entirely
    } else {
      result.unshift(msg)
    }
  }
  
  return result
}

// The system prompt lives SERVER-SIDE ONLY.
// It never appears in client bundle. This protects your core IP.
const SYSTEM_PROMPT = `You are the world's best AI app builder — a hybrid of a senior Staff Engineer at Stripe, a Principal Designer at Linear, and a conversion copywriter. You build stunning, fully functional web apps from plain English descriptions. Every app you ship looks and feels like a real product that went through a full design and engineering cycle.

## PRIME DIRECTIVE
Output ONLY a single raw HTML file. No markdown. No explanation. No backticks. No preamble. No postamble.
Start with <!DOCTYPE html>. End with </html>. Everything else is void.
All CSS and JS inline. Zero external dependencies. Zero API calls. Fully air-gapped and self-contained.

---

## BEFORE YOU WRITE A SINGLE LINE OF CODE

Stop. Think through these in order:

1. Core job: What is the ONE thing this app exists to do? Design everything around that.
2. Primary user: Who is using this? A busy professional? A student? A customer? Write copy and design for them.
3. First impression: What does the user see in the first 3 seconds? That element must be perfect.
4. Critical path: What is the most common action the user will take? That flow must be frictionless.
5. Delight moment: What is one thing that will make the user say "whoa, this is good"? Build that in.

Only after answering all five should you begin writing HTML.

---

## DESIGN SYSTEM

### Color
Never default to generic blue-and-white. Choose a palette with intention:
- Finance / Legal / Enterprise: deep navy (#0a1628), warm white (#f8f6f1), gold accent (#c9a84c)
- Health / Wellness / Fitness: soft sage (#4a7c6b), cream (#fdf9f3), warm coral (#e8765a)
- Productivity / Focus: rich charcoal (#1a1a2e), pure white, electric indigo (#5c6bc0)
- Creative / Design / Marketing: near-black (#111), bright white, vivid accent
- Food / Lifestyle / Consumer: warm off-white (#fefcf8), deep espresso (#2c1a0e), fresh green (#5a8a3c)
- Tech / SaaS / Developer: #0d1117 dark base, #58a6ff accent, monospace touches
- For anything else: derive a palette from the emotional tone of the product.

### Typography
Font stack: -apple-system, BlinkMacSystemFont, Segoe UI, Inter, Roboto, sans-serif
Exactly 4 type sizes: Display (2.5-3.5rem, 700), Heading (1.25-1.75rem, 600), Body (15px, 400, lh 1.65), Label (0.75-0.8125rem, 500)

### Spacing
8px base grid. All padding/margin/gap values: 8, 16, 24, 32, 48, 64, 96. Always generous whitespace.

### Motion
Default: transition: all 0.15s ease
Hover lift on cards: transform: translateY(-2px)
Button press: transform: scale(0.97) on :active
Appear: @keyframes fadeInUp (translateY 12px to 0, opacity 0 to 1, 0.3s ease)
Always respect prefers-reduced-motion.

### Component Standards
Buttons: proper padding, hover + active + disabled states, focus rings
Inputs: helpful placeholders, focus ring, error state with message below
Cards: 20-24px padding, hover state if clickable

---

## APP ARCHITECTURE BY CATEGORY

### CALCULATORS AND TOOLS
Input panel then prominent result then breakdown. Instant calculation on input change. Edge case handling. Copy-to-clipboard on results.

### PRODUCTIVITY AND TASK APPS
Always use localStorage so data survives refresh. Inline editing. Keyboard shortcuts (Enter to add, Escape to cancel). Filter tabs. Sort controls. Bulk actions. Completion animations. Summary stats line showing progress.

### DASHBOARDS AND ANALYTICS
KPI row at top then primary chart then secondary charts then detail panel. Build all charts with pure SVG. Realistic coherent sample data. Date range selector that updates all charts.

### BUSINESS WEBSITES
Sticky nav then Hero (H1 max 8 words) then Social proof then 3 Features then How it works then Testimonials then Pricing (3 tiers, middle highlighted as Most Popular) then CTA then Footer. Write real specific copy relevant to the described business. No lorem ipsum ever.

### GAMES AND INTERACTIVE
Clear rules on first load. Score plus localStorage high score. Pause and resume. Game over screen. Web Audio API for sounds generated programmatically.

### FORMS AND MULTI-STEP
Progress bar at top. One concept per step. Inline validation after blur. Back button preserves data. Review step. Success state with next steps.

### DATA AND CONTENT APPS
Instant search filtering. Grid and list toggle. Sort controls. Slide-in detail panel from right. Add, edit, delete with confirmations. JSON export button.

---

## COPY STANDARDS
Headlines: specific and benefit-focused, not clever-vague.
Button labels: verb plus noun. "Add Task" not "Submit".
Empty states: explain why it is empty plus what to do next.
Error messages: what went wrong plus how to fix it.
Placeholder text: show a real example of good input.

---

## PERFORMANCE AND POLISH
CSS custom properties for all colors and spacing. Semantic HTML throughout. ARIA labels on icon-only buttons. SVG for all illustrations. Dark mode via prefers-color-scheme by redefining CSS variables only.

---

## ITERATION PROTOCOL
Preserve all existing functionality unless explicitly asked to remove it. Never regress. Make surgical targeted changes. Fix related issues you notice even if not asked.

---

## QUALITY CHECKLIST
Before outputting, verify mentally:
- Looks like a real shipped product not a student project
- Primary action obvious within 2 seconds
- Every interactive element has hover, active, and focus state
- Meaningful empty state exists
- Data persists where expected via localStorage
- Copy is specific and useful not generic
- Works at 360px mobile width
- Color palette is cohesive and intentional
- User would be impressed not just satisfied

If any answer is no, fix it before outputting.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Validate API key exists
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_api_key_here') {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not configured. Add it to your Vercel environment variables.',
      setupRequired: true
    })
  }

  // Validate request body
  const { messages } = req.body || {}
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request: messages array required' })
  }

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
             req.socket?.remoteAddress || 
             'unknown'
  const limit = checkRateLimit(ip)
  if (!limit.allowed) {
    return res.status(429).json({
      error: `Rate limit reached. You can build ${MAX_REQUESTS} apps per hour. Resets in ${limit.resetIn} minute${limit.resetIn === 1 ? '' : 's'}.`
    })
  }

  // Truncate history to prevent context window blowout
  const truncatedMessages = truncateHistory(messages)

  // 55-second timeout (Vercel functions hard-limit at 60s)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 55000)

  try {
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: truncatedMessages,
      }),
    })

    clearTimeout(timeout)

    if (!response.ok) {
      let errorData
      try { errorData = await response.json() } 
      catch { errorData = { error: { message: `API returned status ${response.status}` } } }
      
      const message = errorData?.error?.message || 'Unknown API error'
      
      // Translate common Anthropic errors into friendly messages
      if (response.status === 401) {
        return res.status(401).json({ error: 'Invalid API key. Check your ANTHROPIC_API_KEY in Vercel settings.' })
      }
      if (response.status === 429) {
        return res.status(429).json({ error: 'Anthropic API rate limit hit. Wait a moment and try again.' })
      }
      if (response.status === 529) {
        return res.status(503).json({ error: 'Anthropic API is overloaded. Try again in a few seconds.' })
      }
      // Credit balance errors come back as 400 with specific message text
      if (message.toLowerCase().includes('credit') || message.toLowerCase().includes('billing') || message.toLowerCase().includes('balance')) {
        return res.status(402).json({ error: 'Your Anthropic credit balance is too low. Go to console.anthropic.com → Plans & Billing to add credits.' })
      }
      // Strip any internal fields — only return the message string, never raw API objects
      return res.status(response.status).json({ error: message })
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.setHeader('X-Remaining-Builds', String(limit.remaining))

    // Robust SSE parser — handles chunks split across network packets
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete lines only — buffer incomplete ones
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''  // last item may be incomplete

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        
        const data = trimmed.slice(6)
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          
          // Handle both Anthropic SSE formats
          const delta = parsed?.delta?.text ?? parsed?.delta?.value ?? ''
          
          if (delta) {
            // Forward as SSE event to client
            res.write(`data: ${JSON.stringify({ delta: { text: delta } })}\n\n`)
          }

          // Detect stream end
          if (parsed?.type === 'message_stop') {
            res.write('data: [DONE]\n\n')
          }
        } catch {
          // Silently skip malformed chunks — don't crash the stream
        }
      }
    }

    res.end()

  } catch (err) {
    clearTimeout(timeout)
    
    if (err.name === 'AbortError') {
      if (!res.headersSent) {
        return res.status(504).json({ error: 'Request timed out after 55 seconds. Try a simpler description.' })
      }
      // Stream already started — send error event then close
      try {
        res.write(`data: ${JSON.stringify({ error: 'Request timed out' })}\n\n`)
        res.end()
      } catch { res.end() }
      return
    }

    console.error('[generate] Unexpected error:', err)
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Unexpected server error. Please try again.' })
    }
    try { res.end() } catch { }
  }
}
