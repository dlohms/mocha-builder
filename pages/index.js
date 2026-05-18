// ============================================================
// MOCHA BUILDER — Main UI v3
// Fixes applied vs v2:
// - System prompt removed from client (now server-side only)
// - Robust SSE parser matching new server format
// - Context window: only last 2 HTML turns kept client-side
// - iframe error boundary with blank-render detection
// - "Open in new tab" button
// - Smart download filename from prompt text
// - "Try an example" always visible after first build
// - Mobile responsive layout (stacked panels under 768px)
// - Setup screen if API key missing
// - Char counter on prompt input
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react'

// ── Version history helpers ──────────────────────────────────
const HISTORY_KEY = 'mochaVersionHistory'
const MAX_HISTORY = 20

function loadHistory() {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') }
  catch { return [] }
}

function saveVersion(prompt, html) {
  try {
    const history = loadHistory()
    const version = {
      id: Date.now(),
      prompt: prompt.slice(0, 120),
      html,
      timestamp: new Date().toISOString(),
    }
    const updated = [version, ...history].slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
    return updated
  } catch { return [] }
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Slugify prompt into a filename: "A to-do list app" → "a-to-do-list-app.html"
function promptToFilename(prompt) {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '')
  return slug ? `${slug}.html` : 'app.html'
}

// Keep only last N assistant turns in history sent to API
// Prevents context window blowout (20k+ tokens after 4-5 iterations)
function trimHistoryForAPI(history, maxAssistantTurns = 2) {
  let assistantSeen = 0
  const result = []
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg.role === 'assistant') {
      assistantSeen++
      if (assistantSeen <= maxAssistantTurns) result.unshift(msg)
    } else {
      result.unshift(msg)
    }
  }
  return result
}

// ── Constants ────────────────────────────────────────────────
const DEVICES = {
  desktop: { width: '100%',  icon: '🖥',  label: 'Desktop' },
  tablet:  { width: '768px', icon: '📱',  label: 'Tablet'  },
  mobile:  { width: '390px', icon: '📲',  label: 'Mobile'  },
}

const SUGGESTIONS = [
  'A to-do list with priorities and due dates',
  'A tip calculator with bill splitting',
  'A personal finance expense tracker',
  'A Pomodoro timer with session history',
  'A landing page for a staffing firm',
  'A password strength checker tool',
  'A BMI and calorie tracker',
  'A daily habit tracker with streaks',
]

const MAX_PROMPT_CHARS = 1000

// ── Component ────────────────────────────────────────────────
export default function Home() {
  const [messages, setMessages]               = useState([])
  const [convHistory, setConvHistory]         = useState([])  // full history for context
  const [currentHtml, setCurrentHtml]         = useState('')
  const [prompt, setPrompt]                   = useState('')
  const [loading, setLoading]                 = useState(false)
  const [activeTab, setActiveTab]             = useState('preview')
  const [copied, setCopied]                   = useState(false)
  const [device, setDevice]                   = useState('desktop')
  const [showHistory, setShowHistory]         = useState(false)
  const [showExamples, setShowExamples]       = useState(false)
  const [versionHistory, setVersionHistory]   = useState([])
  const [remainingBuilds, setRemainingBuilds] = useState(null)
  const [liveHtml, setLiveHtml]               = useState('')
  const [setupRequired, setSetupRequired]     = useState(false)
  const [isMobile, setIsMobile]               = useState(false)
  const [mobileTab, setMobileTab]             = useState('chat') // 'chat' | 'preview'

  const chatRef  = useRef(null)
  const iframeRef = useRef(null)
  const abortRef  = useRef(null)

  // ── Init ──────────────────────────────────────────────────
  useEffect(() => {
    setVersionHistory(loadHistory())
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, loading])

  // ── Preview helpers ───────────────────────────────────────
  const updatePreview = useCallback((html) => {
    if (!iframeRef.current || !html) return
    try {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document
      if (!doc) return
      doc.open()
      doc.write(html)
      doc.close()

      // Blank-render detection: if body is empty 2s after write, show error
      setTimeout(() => {
        try {
          const body = iframeRef.current?.contentDocument?.body
          if (body && body.innerHTML.trim().length < 10) {
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last?.role === 'iframeError') return prev
              return [...prev, {
                role: 'iframeError',
                text: '⚠️ The preview rendered blank. The generated HTML may have an error. Try rephrasing your request or ask me to "fix the app".'
              }]
            })
          }
        } catch { }
      }, 2000)
    } catch (err) {
      console.error('iframe write error:', err)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'preview') {
      setTimeout(() => updatePreview(liveHtml || currentHtml), 30)
    }
  }, [activeTab])

  // ── Build ─────────────────────────────────────────────────
  const handleBuild = async () => {
    if (!prompt.trim() || loading) return

    const userPrompt = prompt.trim()
    setPrompt('')
    setLoading(true)
    setLiveHtml('')
    setActiveTab('preview')
    setShowExamples(false)
    if (isMobile) setMobileTab('preview')

    setMessages(prev => [...prev, { role: 'user', text: userPrompt }])

    const newHistory = [...convHistory, { role: 'user', content: userPrompt }]
    setConvHistory(newHistory)

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          messages: trimHistoryForAPI(newHistory),
        }),
      })

      // Handle non-streaming error responses
      if (!res.ok) {
        let errData
        try { errData = await res.json() } catch { errData = { error: 'Unknown error' } }

        if (errData.setupRequired) {
          setSetupRequired(true)
        }
        setMessages(prev => [...prev, { role: 'error', text: errData.error || 'Request failed' }])
        setConvHistory(prev => prev.slice(0, -1))
        setLoading(false)
        return
      }

      const remaining = res.headers.get('X-Remaining-Builds')
      if (remaining !== null) setRemainingBuilds(parseInt(remaining, 10))

      // ── Robust SSE reader ────────────────────────────────
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullHtml = ''
      let sseBuffer = ''
      let previewThrottle = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        sseBuffer += decoder.decode(value, { stream: true })

        // Only process complete lines
        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)

            // Handle error events mid-stream
            if (parsed.error) {
              const errMsg = typeof parsed.error === 'string' 
                ? parsed.error 
                : parsed.error?.message || 'Unknown error'
              setMessages(prev => [...prev, { role: 'error', text: errMsg }])
              break
            }

            // ONLY process delta.text — ignore all other fields (model, id, type, usage, etc.)
            // This prevents internal Anthropic fields from ever leaking into the UI
            const delta = parsed?.delta?.text ?? ''
            if (delta && typeof delta === 'string') {
              fullHtml += delta
              previewThrottle += delta.length

              // Update preview every ~600 chars for smooth streaming
              if (previewThrottle >= 600) {
                previewThrottle = 0
                setLiveHtml(fullHtml)
                updatePreview(fullHtml)
              }
            }
          } catch {
            // Silently skip malformed JSON chunks
          }
        }
      }

      // Final render
      if (fullHtml && fullHtml.length > 50) {
        setCurrentHtml(fullHtml)
        setLiveHtml(fullHtml)
        updatePreview(fullHtml)
        const updated = saveVersion(userPrompt, fullHtml)
        setVersionHistory(updated)
        setConvHistory([...newHistory, { role: 'assistant', content: fullHtml }])
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: '✓ Done! Describe a change to refine it, or try a new app.'
        }])
      } else if (!fullHtml) {
        throw new Error('No output received from API')
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', text: 'Build cancelled.' }])
        setConvHistory(prev => prev.slice(0, -1))
      } else {
        setMessages(prev => [...prev, {
          role: 'error',
          text: `Error: ${err.message}. Please try again.`
        }])
        setConvHistory(prev => prev.slice(0, -1))
      }
    }

    setLoading(false)
    setLiveHtml('')
  }

  const handleCancel = () => {
    if (abortRef.current) abortRef.current.abort()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleBuild()
  }

  // ── Actions ───────────────────────────────────────────────
  const handleCopyCode = () => {
    if (!currentHtml) return
    navigator.clipboard.writeText(currentHtml)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    if (!currentHtml) return
    const blob = new Blob([currentHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    // Use last user message to generate smart filename
    const lastPrompt = [...convHistory].reverse().find(m => m.role === 'user')?.content || ''
    a.href = url
    a.download = promptToFilename(lastPrompt)
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleOpenNewTab = () => {
    if (!currentHtml) return
    const blob = new Blob([currentHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    // Revoke after a delay to allow tab to load
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const handleRestoreVersion = (version) => {
    setCurrentHtml(version.html)
    updatePreview(version.html)
    setActiveTab('preview')
    setShowHistory(false)
    if (isMobile) setMobileTab('preview')
    setMessages(prev => [...prev, {
      role: 'assistant',
      text: `↩ Restored: "${version.prompt.slice(0, 60)}${version.prompt.length > 60 ? '…' : ''}"`
    }])
  }

  const handleNewApp = () => {
    setMessages([])
    setConvHistory([])
    setCurrentHtml('')
    setLiveHtml('')
    setActiveTab('preview')
    setShowHistory(false)
    setShowExamples(false)
    setSetupRequired(false)
    if (iframeRef.current) {
      try {
        const doc = iframeRef.current.contentDocument
        doc.open(); doc.write(''); doc.close()
      } catch { }
    }
  }

  const displayHtml = liveHtml || currentHtml
  const charCount = prompt.length
  const charWarning = charCount > MAX_PROMPT_CHARS * 0.8

  // ── Setup screen ──────────────────────────────────────────
  if (setupRequired) {
    return (
      <div style={s.setupRoot}>
        <div style={s.setupCard}>
          <div style={s.setupIcon}>☕</div>
          <h1 style={s.setupTitle}>API Key Required</h1>
          <p style={s.setupText}>
            Mocha Builder needs your Anthropic API key to work.
            Add it to your Vercel project to continue.
          </p>
          <ol style={s.setupSteps}>
            <li>Go to <strong>console.anthropic.com</strong> → API Keys → create a key</li>
            <li>Open your project on <strong>vercel.com</strong></li>
            <li>Settings → Environment Variables</li>
            <li>Add: <code style={s.setupCode}>ANTHROPIC_API_KEY</code> = your key</li>
            <li>Redeploy the project</li>
          </ol>
          <button onClick={() => setSetupRequired(false)} style={s.setupBtn}>
            Try again
          </button>
        </div>
        <style>{`* { box-sizing: border-box; } body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f0f0f; }`}</style>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div style={s.root}>
      {/* ── Topbar ── */}
      <div style={s.topbar}>
        <div style={s.topbarLeft}>
          <span style={s.logo}>☕ Mocha Builder</span>
          <span style={s.badge}>Claude-powered</span>
          {remainingBuilds !== null && (
            <span style={s.quota}>{remainingBuilds} builds left this hour</span>
          )}
        </div>
        <div style={s.topbarRight}>
          {versionHistory.length > 0 && (
            <button
              onClick={() => { setShowHistory(!showHistory); setShowExamples(false) }}
              style={{ ...s.actionBtn, ...(showHistory ? s.actionBtnOn : {}) }}
            >
              ⏱ History ({versionHistory.length})
            </button>
          )}
          {currentHtml && (
            <>
              <button onClick={handleOpenNewTab} style={s.actionBtn} title="Open in new tab">↗ Open</button>
              <button onClick={handleDownload} style={s.actionBtn}>↓ Download</button>
            </>
          )}
          {(currentHtml || messages.length > 0) && (
            <button onClick={handleNewApp} style={s.actionBtn}>+ New</button>
          )}
        </div>
      </div>

      {/* ── Mobile tab bar ── */}
      {isMobile && (
        <div style={s.mobileTabBar}>
          <button
            style={{ ...s.mobileTabBtn, ...(mobileTab === 'chat' ? s.mobileTabBtnOn : {}) }}
            onClick={() => setMobileTab('chat')}
          >
            💬 Chat
          </button>
          <button
            style={{ ...s.mobileTabBtn, ...(mobileTab === 'preview' ? s.mobileTabBtnOn : {}) }}
            onClick={() => { setMobileTab('preview'); setActiveTab('preview') }}
          >
            👁 Preview {loading && '(building…)'}
          </button>
        </div>
      )}

      {/* ── Main layout ── */}
      <div style={s.main}>

        {/* ── Left / Chat panel ── */}
        {(!isMobile || mobileTab === 'chat') && (
          <div style={{ ...s.left, ...(isMobile ? s.leftMobile : {}) }}>
            <div ref={chatRef} style={s.chat}>

              {/* Empty state */}
              {messages.length === 0 && !showHistory && !showExamples && (
                <div style={s.emptyState}>
                  <div style={s.emptyTitle}>What do you want to build?</div>
                  <div style={s.emptySub}>Describe any app or website in plain English.</div>
                  <div style={s.suggList}>
                    {SUGGESTIONS.slice(0, 5).map((sug, i) => (
                      <button key={i} style={s.suggBtn} onClick={() => setPrompt(sug)}>
                        {sug}
                      </button>
                    ))}
                    <button style={{ ...s.suggBtn, color: '#6aabee' }} onClick={() => setShowExamples(true)}>
                      See more examples →
                    </button>
                  </div>
                </div>
              )}

              {/* All examples overlay */}
              {showExamples && (
                <div style={s.examplesPanel}>
                  <div style={s.examplesHeader}>
                    <span style={s.examplesTitle}>All examples</span>
                    <button onClick={() => setShowExamples(false)} style={s.closeBtn}>✕</button>
                  </div>
                  {SUGGESTIONS.map((sug, i) => (
                    <button key={i} style={s.suggBtn} onClick={() => { setPrompt(sug); setShowExamples(false) }}>
                      {sug}
                    </button>
                  ))}
                </div>
              )}

              {/* Version history */}
              {showHistory && (
                <div style={s.histPanel}>
                  <div style={s.histHeader}>
                    <span style={s.histTitle}>Version history</span>
                    <button onClick={() => setShowHistory(false)} style={s.closeBtn}>✕</button>
                  </div>
                  {versionHistory.length === 0
                    ? <div style={s.histEmpty}>No versions yet</div>
                    : versionHistory.map((v, i) => (
                      <div key={v.id} style={s.vCard}>
                        <div style={s.vPrompt}>"{v.prompt}{v.prompt.length >= 120 ? '…' : ''}"</div>
                        <div style={s.vMeta}>
                          <span style={s.vTime}>{timeAgo(v.timestamp)}</span>
                          {i === 0 && <span style={s.vCurrent}>current</span>}
                        </div>
                        {i !== 0 && (
                          <button onClick={() => handleRestoreVersion(v)} style={s.restoreBtn}>
                            ↩ Restore this version
                          </button>
                        )}
                      </div>
                    ))
                  }
                </div>
              )}

              {/* Messages */}
              {!showHistory && !showExamples && messages.map((msg, i) => (
                <div key={i} style={{
                  ...s.msg,
                  ...(msg.role === 'user' ? s.msgU : {}),
                  ...(msg.role === 'assistant' ? s.msgA : {}),
                  ...(msg.role === 'error' || msg.role === 'iframeError' ? s.msgE : {}),
                }}>
                  {msg.text}
                </div>
              ))}

              {/* "Try an example" button — always visible after first build */}
              {messages.length > 0 && !showHistory && !showExamples && !loading && (
                <button
                  style={s.tryExampleBtn}
                  onClick={() => setShowExamples(true)}
                >
                  💡 Try an example
                </button>
              )}

              {/* Building indicator */}
              {loading && !showHistory && !showExamples && (
                <div style={{ ...s.msg, ...s.msgA }}>
                  Building
                  <span style={s.d1}>.</span>
                  <span style={s.d2}>.</span>
                  <span style={s.d3}>.</span>
                </div>
              )}
            </div>

            {/* ── Input area ── */}
            <div style={s.inputArea}>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value.slice(0, MAX_PROMPT_CHARS))}
                onKeyDown={handleKeyDown}
                disabled={loading}
                placeholder="Describe your app… (Cmd+Enter to build)"
                style={s.textarea}
                rows={3}
              />
              <div style={s.inputRow}>
                <span style={{ ...s.charCount, ...(charWarning ? s.charCountWarn : {}) }}>
                  {charCount}/{MAX_PROMPT_CHARS}
                </span>
                {loading
                  ? <button onClick={handleCancel} style={s.cancelBtn}>✕ Cancel</button>
                  : (
                    <button
                      onClick={handleBuild}
                      disabled={!prompt.trim()}
                      style={{ ...s.buildBtn, opacity: !prompt.trim() ? 0.4 : 1, cursor: !prompt.trim() ? 'not-allowed' : 'pointer' }}
                    >
                      ⚡ Build it
                    </button>
                  )
                }
                {!loading && <span style={s.hint}>⌘↵</span>}
              </div>
            </div>
          </div>
        )}

        {/* ── Right / Preview panel ── */}
        {(!isMobile || mobileTab === 'preview') && (
          <div style={{ ...s.right, ...(isMobile ? s.rightMobile : {}) }}>
            <div style={s.previewBar}>
              <div style={s.tabGroup}>
                {['preview', 'code'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{ ...s.tab, ...(activeTab === tab ? s.tabOn : {}) }}
                  >
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {activeTab === 'preview' && (
                <div style={s.deviceGroup}>
                  {Object.entries(DEVICES).map(([key, val]) => (
                    <button
                      key={key}
                      title={val.label}
                      onClick={() => setDevice(key)}
                      style={{ ...s.deviceBtn, ...(device === key ? s.deviceBtnOn : {}) }}
                    >
                      {val.icon}
                    </button>
                  ))}
                </div>
              )}

              {activeTab === 'code' && currentHtml && (
                <button onClick={handleCopyCode} style={s.copyBtn}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              )}
            </div>

            {/* Preview */}
            {activeTab === 'preview' && (
              <div style={s.previewOuter}>
                {displayHtml ? (
                  <div style={{ ...s.previewInner, width: DEVICES[device].width }}>
                    {loading && (
                      <div style={s.streamBadge}>
                        <span style={s.streamDot} /> Streaming…
                      </div>
                    )}
                    <iframe
                      ref={iframeRef}
                      sandbox="allow-scripts allow-same-origin allow-forms"
                      style={s.iframe}
                      title="App preview"
                    />
                  </div>
                ) : (
                  <div style={s.previewEmpty}>
                    <div style={s.peIcon}>☕</div>
                    <div style={s.peText}>Your app will appear here</div>
                    <div style={s.peSub}>Describe it in the chat panel</div>
                  </div>
                )}
              </div>
            )}

            {/* Code view */}
            {activeTab === 'code' && (
              <div style={s.codeView}>
                {currentHtml
                  ? currentHtml
                  : <span style={{ color: '#bbb' }}>No code yet — build an app first.</span>
                }
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #__next { height: 100%; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f0f; color: #e8e8e8; }
        textarea::placeholder { color: #555; }
        textarea:focus { outline: none; border-color: #333 !important; }
        button { font-family: inherit; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #252525; border-radius: 3px; }
        @keyframes d0 { 0%,80%,100%{opacity:0} 40%{opacity:1} }
        @keyframes d1 { 0%,100%{opacity:0} 20%,60%{opacity:1} }
        @keyframes d2 { 0%,40%,100%{opacity:0} 60%,80%{opacity:1} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────
const s = {
  // Layout
  root: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f0f0f' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', borderBottom: '1px solid #1a1a1a', background: '#111', flexShrink: 0 },
  topbarLeft: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 },
  topbarRight: { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 },
  logo: { fontSize: '14px', fontWeight: '600', color: '#e8e8e8', letterSpacing: '-0.3px', whiteSpace: 'nowrap' },
  badge: { fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#1a2a3a', color: '#6aabee', border: '1px solid #1e3a5a', whiteSpace: 'nowrap' },
  quota: { fontSize: '11px', color: '#555', whiteSpace: 'nowrap' },
  actionBtn: { fontSize: '12px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #252525', background: 'transparent', color: '#777', cursor: 'pointer', whiteSpace: 'nowrap' },
  actionBtnOn: { color: '#ccc', borderColor: '#333', background: '#1a1a1a' },

  // Mobile tab bar
  mobileTabBar: { display: 'flex', borderBottom: '1px solid #1a1a1a', background: '#111', flexShrink: 0 },
  mobileTabBtn: { flex: 1, padding: '10px', fontSize: '13px', background: 'transparent', border: 'none', color: '#666', cursor: 'pointer' },
  mobileTabBtnOn: { color: '#e8e8e8', borderBottom: '2px solid #4a8af4' },

  // Main
  main: { display: 'flex', flex: 1, overflow: 'hidden' },

  // Left panel
  left: { width: '300px', minWidth: '300px', display: 'flex', flexDirection: 'column', borderRight: '1px solid #1a1a1a', background: '#0d0d0d' },
  leftMobile: { width: '100%', minWidth: '100%', borderRight: 'none' },
  chat: { flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' },

  // Empty state
  emptyState: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0' },
  emptyTitle: { fontSize: '14px', fontWeight: '500', color: '#ddd' },
  emptySub: { fontSize: '12px', color: '#555', lineHeight: '1.5' },
  suggList: { display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px' },
  suggBtn: { fontSize: '12px', padding: '8px 10px', borderRadius: '7px', border: '1px solid #1e1e1e', background: '#141414', color: '#777', cursor: 'pointer', textAlign: 'left', lineHeight: '1.4' },

  // Examples panel
  examplesPanel: { display: 'flex', flexDirection: 'column', gap: '6px' },
  examplesHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' },
  examplesTitle: { fontSize: '13px', fontWeight: '500', color: '#ccc' },
  closeBtn: { fontSize: '12px', color: '#666', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' },

  // Try example button
  tryExampleBtn: { fontSize: '11px', color: '#6aabee', background: 'none', border: '1px solid #1e3a5a', borderRadius: '6px', cursor: 'pointer', padding: '5px 10px', alignSelf: 'flex-start', marginTop: '4px' },

  // History
  histPanel: { display: 'flex', flexDirection: 'column', gap: '8px' },
  histHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' },
  histTitle: { fontSize: '13px', fontWeight: '500', color: '#ccc' },
  histEmpty: { fontSize: '12px', color: '#555', textAlign: 'center', padding: '20px 0' },
  vCard: { background: '#141414', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' },
  vPrompt: { fontSize: '12px', color: '#999', lineHeight: '1.4', fontStyle: 'italic' },
  vMeta: { display: 'flex', alignItems: 'center', gap: '8px' },
  vTime: { fontSize: '11px', color: '#555' },
  vCurrent: { fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: '#1a2a1a', color: '#5a9a5a', border: '1px solid #2a3a2a' },
  restoreBtn: { fontSize: '11px', color: '#6aabee', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '2px 0' },

  // Messages
  msg: { padding: '8px 11px', borderRadius: '9px', fontSize: '13px', lineHeight: '1.5', maxWidth: '96%' },
  msgU: { background: '#1a2a3a', color: '#cde', alignSelf: 'flex-end', border: '1px solid #1e3a5a' },
  msgA: { background: '#161616', color: '#777', alignSelf: 'flex-start', border: '1px solid #1e1e1e' },
  msgE: { background: '#2a1515', color: '#f88', alignSelf: 'flex-start', border: '1px solid #3a1e1e' },
  d1: { animation: 'd0 1.4s ease-in-out infinite' },
  d2: { animation: 'd1 1.4s ease-in-out infinite' },
  d3: { animation: 'd2 1.4s ease-in-out infinite' },

  // Input
  inputArea: { padding: '10px', borderTop: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', gap: '7px' },
  textarea: { width: '100%', resize: 'none', fontSize: '13px', borderRadius: '8px', border: '1px solid #222', padding: '9px 11px', fontFamily: 'inherit', background: '#141414', color: '#e0e0e0', lineHeight: '1.5' },
  inputRow: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' },
  charCount: { fontSize: '11px', color: '#555', marginRight: 'auto' },
  charCountWarn: { color: '#c97a3a' },
  buildBtn: { fontSize: '13px', fontWeight: '500', padding: '7px 16px', borderRadius: '7px', border: 'none', background: '#4a8af4', color: '#fff' },
  cancelBtn: { fontSize: '12px', padding: '6px 12px', borderRadius: '7px', border: '1px solid #3a2020', background: '#2a1515', color: '#f88', cursor: 'pointer' },
  hint: { fontSize: '11px', color: '#444' },

  // Right panel
  right: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' },
  rightMobile: { width: '100%' },
  previewBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px', borderBottom: '1px solid #eee', background: '#fafafa', flexShrink: 0, gap: '8px' },
  tabGroup: { display: 'flex', gap: '2px' },
  tab: { fontSize: '12px', padding: '4px 10px', borderRadius: '5px', border: '1px solid transparent', cursor: 'pointer', color: '#bbb', background: 'transparent', fontFamily: 'inherit' },
  tabOn: { background: '#fff', borderColor: '#ddd', color: '#222' },
  deviceGroup: { display: 'flex', gap: '2px' },
  deviceBtn: { fontSize: '14px', padding: '3px 7px', borderRadius: '5px', border: '1px solid transparent', cursor: 'pointer', background: 'transparent', lineHeight: 1 },
  deviceBtnOn: { background: '#fff', borderColor: '#ddd' },
  copyBtn: { fontSize: '11px', padding: '3px 10px', borderRadius: '5px', border: '1px solid #ddd', background: 'transparent', color: '#888', cursor: 'pointer', fontFamily: 'inherit' },

  // Preview
  previewOuter: { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', background: '#ebebeb' },
  previewInner: { position: 'relative', height: '100%', background: '#fff', flexShrink: 0, transition: 'width 0.2s ease' },
  streamBadge: { position: 'absolute', top: '8px', right: '8px', zIndex: 10, display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#888', background: 'rgba(255,255,255,0.92)', padding: '3px 9px', borderRadius: '20px', border: '1px solid #e0e0e0', pointerEvents: 'none' },
  streamDot: { width: '6px', height: '6px', borderRadius: '50%', background: '#4a8af4', display: 'inline-block', animation: 'pulse 1s ease-in-out infinite' },
  iframe: { width: '100%', height: '100%', border: 'none', display: 'block' },
  previewEmpty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#f8f8f8', width: '100%' },
  peIcon: { fontSize: '36px', opacity: 0.2 },
  peText: { fontSize: '14px', color: '#bbb', fontWeight: '500' },
  peSub: { fontSize: '12px', color: '#ccc' },
  codeView: { flex: 1, overflow: 'auto', padding: '16px', fontFamily: '"SF Mono","Fira Code",Menlo,monospace', fontSize: '11px', lineHeight: '1.7', color: '#555', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#fafafa' },

  // Setup screen
  setupRoot: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' },
  setupCard: { background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '40px', maxWidth: '480px', width: '100%', textAlign: 'center' },
  setupIcon: { fontSize: '48px', marginBottom: '16px' },
  setupTitle: { fontSize: '20px', fontWeight: '600', color: '#e8e8e8', marginBottom: '12px' },
  setupText: { fontSize: '14px', color: '#888', lineHeight: '1.6', marginBottom: '24px' },
  setupSteps: { textAlign: 'left', fontSize: '13px', color: '#aaa', lineHeight: '2', marginBottom: '24px', paddingLeft: '20px' },
  setupCode: { background: '#1e1e1e', border: '1px solid #333', borderRadius: '4px', padding: '1px 6px', fontFamily: 'monospace', fontSize: '12px', color: '#6aabee' },
  setupBtn: { fontSize: '14px', padding: '10px 24px', borderRadius: '8px', border: 'none', background: '#4a8af4', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' },
}
