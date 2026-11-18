try {
  var d = document.documentElement
  if (localStorage.getItem('theme') === 'dark') d.setAttribute('data-theme', 'dark')
  if (localStorage.getItem('solid') === '1') d.classList.add('is-solid')
  var a = localStorage.getItem('accent')
  if (/^#[0-9a-f]{6}$/i.test(a || '')) d.style.setProperty('--accent', a)
} catch (e) {}
