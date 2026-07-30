#!/usr/bin/env python3
"""Replace old pchatInit IIFE (lines 2552-2628) with new full-featured version."""

JS_PATH = '/home/z/my-project/personal-portfolio/script.js'

with open(JS_PATH, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# The old IIFE spans lines 2552-2628 (1-indexed). In 0-indexed: 2551-2627 inclusive.
OLD_START = 2551  # 0-indexed
OLD_END = 2628    # exclusive (line 2628 is the blank line after })();

print(f"Old section lines {OLD_START+1}-{OLD_END} (0-indexed {OLD_START}-{OLD_END-1})")
print(f"Old start line: {repr(lines[OLD_START][:60])}")
print(f"Old end-1 line: {repr(lines[OLD_END-1][:60])}")
print(f"Old end line:   {repr(lines[OLD_END][:60])}")

new_code = r'''  /* ============================================================
     57. "ASK MY PORTFOLIO" AI CHATBOT (RAG over profile + AMA)
     ============================================================ */
  (function portfolioChat() {
    const fab = $('pchat-fab'), panel = $('pchat-panel'), closeBtn = $('pchat-close');
    const log = $('pchat-log'), form = $('pchat-form'), inputEl = $('pchat-input'), sendBtn = $('pchat-send');
    const clearBtn = $('pchat-clear');
    const badge = $('pchat-fab-badge');
    const scrollBtn = $('pchat-scroll-btn');
    const charCount = $('pchat-char-count');
    const suggestionsEl = $('pchat-suggestions');
    if (!fab || !panel || !form) return;

    const history = [];
    let busy = false, greeted = false, unreadCount = 0;

    /* --- Helpers --- */
    function timeNow() {
      var d = new Date();
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function linkify(text) {
      return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    }

    function formatText(text) {
      var html = linkify(text);
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\n/g, '<br>');
      return html;
    }

    function playBlip() {
      try { if (window.sfx && !window.sfx.isMuted()) window.sfx.play(660, 0.05, 'square'); } catch (e) {}
    }

    /* --- Character counter --- */
    function updateCharCount() {
      var len = inputEl.value.length;
      var max = parseInt(inputEl.getAttribute('maxlength')) || 1000;
      charCount.textContent = len + '/' + max;
      charCount.classList.remove('warn', 'limit');
      if (len >= max) charCount.classList.add('limit');
      else if (len >= max * 0.8) charCount.classList.add('warn');
      charCount.classList.toggle('visible', len > 0);
    }
    inputEl.addEventListener('input', updateCharCount);
    updateCharCount();

    /* --- Scroll-to-bottom button --- */
    function checkScroll() {
      var atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
      scrollBtn.hidden = atBottom;
    }
    log.addEventListener('scroll', checkScroll);
    scrollBtn.addEventListener('click', function () { log.scrollTop = log.scrollHeight; });

    /* --- User message --- */
    function addUserBubble(text) {
      var el = document.createElement('div');
      el.className = 'pchat-msg pchat-user';
      el.innerHTML = formatText(text);
      var meta = document.createElement('div');
      meta.className = 'pchat-msg-meta';
      meta.innerHTML = '<span class="pchat-msg-time">' + timeNow() + '</span>';
      el.appendChild(meta);
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      checkScroll();
    }

    /* --- Bot message (avatar + timestamp + copy) --- */
    function addBotBubble(text, isError) {
      var wrap = document.createElement('div');
      wrap.className = 'pchat-bot-wrap' + (isError ? ' pchat-msg-error' : '');

      var avatar = document.createElement('div');
      avatar.className = 'pchat-bot-avatar';
      avatar.innerHTML = '<span class="material-symbols-outlined">smart_toy</span>';
      wrap.appendChild(avatar);

      var bubble = document.createElement('div');
      bubble.className = 'pchat-bot-bubble';
      bubble.innerHTML = formatText(text);
      wrap.appendChild(bubble);

      var meta = document.createElement('div');
      meta.className = 'pchat-msg-meta';
      meta.innerHTML = '<span class="pchat-msg-time">' + timeNow() + '</span>' +
        '<button class="pchat-copy-btn" title="Copy" aria-label="Copy message"><span class="material-symbols-outlined">content_copy</span></button>';
      wrap.appendChild(meta);

      meta.querySelector('.pchat-copy-btn').addEventListener('click', function () {
        var btn = this;
        navigator.clipboard.writeText(text).then(function () {
          btn.querySelector('.material-symbols-outlined').textContent = 'check';
          setTimeout(function () { btn.querySelector('.material-symbols-outlined').textContent = 'content_copy'; }, 1500);
        }).catch(function () {});
      });

      if (isError) {
        var retryBtn = document.createElement('button');
        retryBtn.className = 'pchat-retry-btn';
        retryBtn.innerHTML = '<span class="material-symbols-outlined">refresh</span> Retry';
        retryBtn.addEventListener('click', function () { wrap.remove(); ask(text, true); });
        bubble.appendChild(retryBtn);
      }

      log.appendChild(wrap);
      log.scrollTop = log.scrollHeight;
      checkScroll();
    }

    /* --- Typing indicator --- */
    function addTypingBubble() {
      var wrap = document.createElement('div');
      wrap.className = 'pchat-typing-wrap';

      var avatar = document.createElement('div');
      avatar.className = 'pchat-bot-avatar';
      avatar.innerHTML = '<span class="material-symbols-outlined">smart_toy</span>';
      wrap.appendChild(avatar);

      var bubble = document.createElement('div');
      bubble.className = 'pchat-typing-bubble';
      bubble.innerHTML = '<span class="pchat-typing-text">Thinking</span><span class="pchat-typing-dots"><span></span><span></span><span></span></span>';
      wrap.appendChild(bubble);

      log.appendChild(wrap);
      log.scrollTop = log.scrollHeight;
      checkScroll();
      return wrap;
    }

    /* --- Open / Close --- */
    function open() {
      panel.hidden = false;
      requestAnimationFrame(function () { panel.classList.add('open'); });
      fab.classList.add('hidden');
      unreadCount = 0;
      badge.hidden = true;
      badge.textContent = '';
      if (!greeted) {
        greeted = true;
        addBotBubble('Hi! I can answer questions about Yatin \u2014 his projects, skills, and background. What would you like to know?', false);
      }
      setTimeout(function () { inputEl.focus(); }, 120);
    }
    function close() {
      panel.classList.remove('open');
      fab.classList.remove('hidden');
      setTimeout(function () { panel.hidden = true; }, 220);
    }
    fab.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) close(); });

    /* --- Clear chat --- */
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        var msgs = log.querySelectorAll('.pchat-msg, .pchat-bot-wrap, .pchat-typing-wrap');
        msgs.forEach(function (m) { m.remove(); });
        history.length = 0;
        greeted = false;
        if (suggestionsEl) suggestionsEl.hidden = false;
        addBotBubble('Chat cleared! Ask me anything about Yatin.', false);
      });
    }

    /* --- Suggestion chips --- */
    if (suggestionsEl) {
      suggestionsEl.querySelectorAll('.pchat-suggest-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          var q = this.getAttribute('data-q') || this.textContent.trim();
          inputEl.value = q;
          updateCharCount();
          suggestionsEl.hidden = true;
          form.dispatchEvent(new Event('submit'));
        });
      });
    }

    function hideSuggestions() {
      if (suggestionsEl) suggestionsEl.hidden = true;
    }

    /* --- Unread badge --- */
    function addUnread() {
      if (!panel.hidden) return;
      unreadCount++;
      badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      badge.hidden = false;
    }

    /* --- Ask AI --- */
    async function ask(message, isRetry) {
      if (busy) return;
      busy = true; sendBtn.disabled = true;
      hideSuggestions();

      if (!isRetry) {
        addUserBubble(message);
        history.push({ role: 'user', content: message });
      }

      var typing = addTypingBubble();
      try {
        var res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message, history: history.slice(0, -1), ama: window.__amaContext || [] })
        });
        var data = await res.json().catch(function () { return {}; });
        typing.remove();
        var reply = (data && data.reply) || "Sorry, I couldn't answer that right now.";
        addBotBubble(reply, false);
        history.push({ role: 'assistant', content: reply });
        playBlip();
        addUnread();
      } catch (e) {
        typing.remove();
        addBotBubble("Couldn't reach the assistant. Please try again in a moment.", true);
        addUnread();
      } finally {
        busy = false; sendBtn.disabled = false; inputEl.focus();
        charCount.textContent = '0/' + (parseInt(inputEl.getAttribute('maxlength')) || 1000);
        charCount.classList.remove('visible', 'warn', 'limit');
      }
    }

    /* --- Form submit --- */
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = inputEl.value.trim();
      if (!msg || busy) return;
      inputEl.value = '';
      updateCharCount();
      ask(msg);
    });

    /* --- Achievement --- */
    if (window.unlockAchievement) fab.addEventListener('click', function () { window.unlockAchievement('askbot', 'Curious', 'Opened the portfolio assistant.'); }, { once: true });
  })();'''

new_lines = [line + '\n' for line in new_code.split('\n')]

result = lines[:OLD_START] + new_lines + lines[OLD_END:]

with open(JS_PATH, 'w', encoding='utf-8') as f:
    f.writelines(result)

print(f"Replaced lines {OLD_START+1}-{OLD_END} with {len(new_lines)} new lines")
print("Done!")
