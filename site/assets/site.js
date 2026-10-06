// Progressive enhancement: appearance, copy, lightbox, offline search, mobile menu.
(function () {
  'use strict'
  var root = document.documentElement
  var base = root.getAttribute('data-root') || ''

  var appearanceRoot = document.querySelector('.appearance')
  var appearanceButton = document.querySelector('[data-appearance]')
  var appearancePanel = document.querySelector('[data-appearance-panel]')

  function syncAppearance() {
    if (!appearancePanel) return
    var palette = root.dataset.palette || 'A'
    var theme = root.dataset.theme || ''
    appearancePanel.querySelectorAll('[data-palette]').forEach(function (option) {
      option.setAttribute('aria-checked', String(option.getAttribute('data-palette') === palette))
    })
    appearancePanel.querySelectorAll('[data-theme-option]').forEach(function (option) {
      option.setAttribute('aria-checked', String(option.getAttribute('data-theme-option') === theme))
    })
  }
  function setAppearance(open) {
    if (!appearancePanel || !appearanceButton) return
    appearancePanel.hidden = !open
    appearanceButton.setAttribute('aria-expanded', String(open))
  }
  if (appearanceRoot && appearanceButton && appearancePanel) {
    appearancePanel.querySelector('.swatches').addEventListener('click', function (event) {
      var choice = event.target.closest('[data-palette]')
      if (!choice) return
      root.dataset.palette = choice.getAttribute('data-palette')
      try { localStorage.setItem('scriptor-palette', root.dataset.palette) } catch (e) { /* private mode */ }
      syncAppearance()
    })
    appearancePanel.querySelectorAll('[data-theme-option]').forEach(function (option) {
      option.addEventListener('click', function () {
        var value = option.getAttribute('data-theme-option')
        if (value === 'light' || value === 'dark') root.dataset.theme = value
        else delete root.dataset.theme
        try {
          if (value === 'light' || value === 'dark') localStorage.setItem('scriptor-theme', value)
          else localStorage.removeItem('scriptor-theme')
        } catch (e) { /* private mode */ }
        syncAppearance()
      })
    })
    appearancePanel.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      var current = event.target.closest('[role="radio"]')
      if (!current) return
      var options = Array.prototype.slice.call(current.parentElement.querySelectorAll('[role="radio"]'))
      var index = options.indexOf(current)
      var delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
      var next = options[(index + delta + options.length) % options.length]
      event.preventDefault()
      next.click()
      next.focus()
    })
    appearanceButton.addEventListener('click', function () { setAppearance(appearancePanel.hidden) })
    document.addEventListener('click', function (event) {
      if (!appearanceRoot.contains(event.target)) setAppearance(false)
    })
    appearanceRoot.addEventListener('focusout', function (event) {
      if (!appearanceRoot.contains(event.relatedTarget)) setAppearance(false)
    })
    syncAppearance()
  }

  function flash(button, label) {
    button.textContent = '已复制'
    button.classList.add('copied')
    setTimeout(function () { button.textContent = label; button.classList.remove('copied') }, 1600)
  }
  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      navigator.clipboard.writeText(button.getAttribute('data-copy')).then(function () { flash(button, '复制') })
    })
  })
  document.querySelectorAll('[data-copy-code]').forEach(function (button) {
    button.addEventListener('click', function () {
      var code = button.parentElement.querySelector('code')
      navigator.clipboard.writeText(code ? code.textContent : '').then(function () { flash(button, '复制') })
    })
  })
  document.querySelectorAll('[data-copy-prompt]').forEach(function (button) {
    button.addEventListener('click', function () {
      var quote = button.parentElement.querySelector('blockquote')
      navigator.clipboard.writeText(quote ? quote.innerText : '').then(function () { flash(button, '复制') })
    })
  })

  var lightbox = document.querySelector('.lightbox')
  var lightboxTrigger = null
  function openLightbox(source) {
    if (!lightbox) return
    var image = lightbox.querySelector('img')
    var caption = lightbox.querySelector('figcaption')
    var sourceCaption = source.closest('figure')
    sourceCaption = sourceCaption ? sourceCaption.querySelector('figcaption') : null
    lightboxTrigger = source
    image.src = source.currentSrc || source.src
    image.alt = source.alt || ''
    caption.textContent = sourceCaption ? sourceCaption.textContent : ''
    caption.hidden = !caption.textContent
    lightbox.showModal()
  }
  document.querySelectorAll('.prose figure.shot img').forEach(function (img) {
    img.addEventListener('click', function () { openLightbox(img) })
    img.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLightbox(img) }
    })
  })
  if (lightbox) {
    lightbox.addEventListener('click', function (event) { if (event.target === lightbox) lightbox.close() })
    lightbox.addEventListener('close', function () { if (lightboxTrigger) lightboxTrigger.focus() })
  }

  var gallery = document.querySelector('[data-gallery]')
  if (gallery) {
    var tabs = Array.prototype.slice.call(gallery.querySelectorAll('[role="tab"]'))
    var panels = Array.prototype.slice.call(gallery.querySelectorAll('[role="tabpanel"]'))
    function selectTab(id) {
      tabs.forEach(function (tab) {
        var on = tab.getAttribute('data-tab') === id
        tab.setAttribute('aria-selected', on ? 'true' : 'false')
        tab.tabIndex = on ? 0 : -1
      })
      panels.forEach(function (panel) { panel.hidden = panel.getAttribute('data-tab') !== id })
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { selectTab(tab.getAttribute('data-tab')) })
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        var next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
        next.focus()
        selectTab(next.getAttribute('data-tab'))
      })
    })
    if (tabs.length) selectTab(tabs[0].getAttribute('data-tab'))
  }

  var menuButton = document.querySelector('[data-menu]')
  function setMenu(open) {
    document.body.classList.toggle('menu-open', open)
    if (menuButton) menuButton.setAttribute('aria-expanded', String(open))
  }
  if (menuButton) menuButton.addEventListener('click', function () { setMenu(!document.body.classList.contains('menu-open')) })
  document.querySelectorAll('[data-menu-close]').forEach(function (el) { el.addEventListener('click', function () { setMenu(false) }) })
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return
    if (lightbox && lightbox.open) { lightbox.close(); return }
    if (appearancePanel && !appearancePanel.hidden) { setAppearance(false); appearanceButton.focus(); return }
    setMenu(false)
  })

  var toc = document.querySelector('.toc')
  if (toc && 'IntersectionObserver' in window) {
    var links = new Map()
    toc.querySelectorAll('a[href^="#"]').forEach(function (link) { links.set(link.getAttribute('href').slice(1), link) })
    var visible = new Set()
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) visible.add(entry.target.id)
        else visible.delete(entry.target.id)
      })
      links.forEach(function (link) { link.classList.remove('active') })
      var first = Array.from(visible).sort(function (a, b) {
        return document.getElementById(a).compareDocumentPosition(document.getElementById(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      })[0]
      if (first && links.has(first)) links.get(first).classList.add('active')
    }, { rootMargin: '-70px 0px -65% 0px' })
    links.forEach(function (link, id) { var target = document.getElementById(id); if (target) observer.observe(target) })
  }

  var input = document.getElementById('search-input')
  var results = document.getElementById('search-results')
  var index = null
  function loadIndex() {
    if (index) return index
    var data = window.__SCRIPTOR_SEARCH__
    if (data) {
      index = data.map(function (page) {
        return {
          title: page.title, url: page.url,
          sections: page.sections.map(function (section) {
            return { heading: section.heading, id: section.id, text: section.text, hay: (page.title + ' ' + section.heading + ' ' + section.text).toLowerCase() }
          }),
        }
      })
    }
    return index
  }
  function escapeHtml(value) {
    return value.replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] })
  }
  function highlight(text, terms) {
    var out = escapeHtml(text.slice(0, 120))
    terms.forEach(function (term) {
      if (!term) return
      var escaped = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out = out.replace(new RegExp('(' + escaped + ')', 'ig'), '<em>$1</em>')
    })
    return out
  }
  function search(query) {
    var data = loadIndex()
    if (!data || !query.trim()) return []
    var terms = query.trim().toLowerCase().split(/\s+/)
    var hits = []
    data.forEach(function (page) {
      page.sections.forEach(function (section) {
        if (!terms.every(function (term) { return section.hay.indexOf(term) >= 0 })) return
        var score = 1
        if (page.title.toLowerCase().indexOf(terms[0]) >= 0) score += 4
        if (section.heading.toLowerCase().indexOf(terms[0]) >= 0) score += 3
        hits.push({ page: page, section: section, score: score })
      })
    })
    return hits.sort(function (a, b) { return b.score - a.score }).slice(0, 12)
  }
  function renderResults(query) {
    var hits = search(query)
    if (!query.trim()) { results.hidden = true; return }
    if (!hits.length) {
      results.innerHTML = '<div class="result-empty">没有找到与「' + escapeHtml(query.trim()) + '」相关的内容</div>'
      results.hidden = false
      return
    }
    var terms = query.trim().toLowerCase().split(/\s+/)
    results.innerHTML = hits.map(function (hit, i) {
      var url = base + hit.page.url + (hit.section.id ? '#' + encodeURIComponent(hit.section.id) : '')
      return '<a href="' + url + '" role="option" data-index="' + i + '">' +
        '<div class="result-heading">' + highlight(hit.page.title + ' › ' + hit.section.heading, terms) + '</div>' +
        '<div class="result-text">' + highlight(hit.section.text, terms) + '</div></a>'
    }).join('')
    results.hidden = false
  }
  if (input && results) {
    var debounce
    input.addEventListener('input', function () {
      clearTimeout(debounce)
      debounce = setTimeout(function () { renderResults(input.value) }, 120)
    })
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { results.hidden = true; input.blur() }
      if (event.key === 'ArrowDown') { event.preventDefault(); var first = results.querySelector('a'); if (first) first.focus() }
    })
    results.addEventListener('keydown', function (event) {
      var current = document.activeElement
      if (event.key === 'ArrowDown' && current.nextElementSibling) { event.preventDefault(); current.nextElementSibling.focus() }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (current.previousElementSibling) current.previousElementSibling.focus()
        else input.focus()
      }
    })
    document.addEventListener('keydown', function (event) {
      if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        event.preventDefault()
        input.focus()
      }
    })
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.search')) results.hidden = true
    })
    results.addEventListener('click', function () { results.hidden = true; input.value = '' })
  }
})()
