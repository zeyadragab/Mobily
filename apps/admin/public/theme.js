try {
  if (localStorage.getItem('theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
  var a = localStorage.getItem('accent')
  if (/^#[0-9a-f]{6}$/i.test(a || '')) document.documentElement.style.setProperty('--accent', a)
} catch (e) {}
